import { ApiError } from '../utils/ApiError.js';
import { buildPage } from '../utils/pagination.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import * as postRepo from '../repositories/post.repository.js';
import * as commentRepo from '../repositories/comment.repository.js';
import * as likeRepo from '../repositories/like.repository.js';
import { TARGET_TYPE } from '../models/Like.js';
import { VISIBILITY } from '../models/Post.js';
import * as cache from './cache.service.js';
import { sharedPost, withViewer } from './presenter.js';
import { destroyPostImage, uploadPostImage } from './postImage.service.js';
import { enqueueFanoutRetract, enqueueMediaDerive, enqueuePostFanout } from '../queues/producers.js';

/**
 * THE SERVICE LAYER — business rules, caching, and orchestration.
 *
 * It sits between the controller (which knows about HTTP and nothing else) and
 * the repositories (which know about Mongo and nothing else). The visibility
 * rules, the cache invalidation, and the decision to enqueue rather than do the
 * work inline all live here, which means they are enforced identically no matter
 * who calls — an HTTP route today, a GraphQL resolver or a worker tomorrow.
 */

/**
 * Turns a list of post ids into a list of shared post objects, using the cache
 * for the ones it has and ONE Mongo query for the rest.
 *
 * This is the read primitive the whole feed is built on, and the reason feed
 * pages cache IDs rather than bodies. Two properties fall out of it:
 *
 *   • A post that appears on ten thousand different feed pages is stored ONCE,
 *     under `post:{id}`. Cache it inside each page instead and it is stored ten
 *     thousand times, and an edit has to find all of them.
 *   • A partial cache hit is still a win: 8 of 10 posts cached means one Mongo
 *     query for 2 documents, not 10.
 */
async function hydratePosts(ids) {
  if (!ids.length) return [];

  const cacheKeys = ids.map((id) => cache.keys.post(id));
  const cached = await cache.mget(cacheKeys);

  const missing = ids.filter((id) => !cached.has(cache.keys.post(id)));

  let fetched = new Map();
  if (missing.length) {
    // ONE query for every miss on the page — never one query per post.
    const posts = await postRepo.findPostsByIds(missing);
    fetched = new Map(posts.map((post) => [String(post._id), post]));

    // Like previews for the misses, also in one aggregation.
    const previews = await likeRepo.likePreviews(
      TARGET_TYPE.POST,
      posts.map((post) => post._id)
    );

    const toCache = posts.map((post) => [
      cache.keys.post(post._id),
      sharedPost(post, previews.get(String(post._id)) ?? []),
    ]);
    cache.mset(toCache, env.cache.postTtl);

    fetched = new Map(toCache.map(([, shaped]) => [String(shaped.id), shaped]));
  }

  // Re-assemble in the ORDER THE CALLER ASKED FOR. Neither Redis MGET nor Mongo
  // `$in` preserves it, and the order IS the feed.
  return ids
    .map((id) => cached.get(cache.keys.post(id)) ?? fetched.get(String(id)))
    .filter(Boolean);
}

export { hydratePosts };

/**
 * Attaches the per-viewer fields to a page of shared posts.
 * ONE indexed query for the whole page — see likeRepo.likedTargetIds.
 */
export async function personalize(posts, viewerId) {
  const likedIds = await likeRepo.likedTargetIds(
    viewerId,
    TARGET_TYPE.POST,
    posts.map((post) => post.id)
  );
  return posts.map((post) => withViewer(post, { likedIds, viewerId }));
}

/**
 * The DISCOVERY feed (`GET /api/posts`) — everything public, newest first.
 * This is the endpoint the existing client already uses; its contract is unchanged.
 *
 * CACHING. The page cache holds only the ORDERED IDS of the page, plus its cursor.
 * The bodies come from `hydratePosts` above.
 *
 * The TTL is not one number, and the reason is a property of keyset pagination:
 *
 *   Under `sort({_id: -1})` with `_id < cursor`, a page BELOW THE HEAD is a
 *   STABLE WINDOW. Every post it can ever contain already exists — a new post has
 *   a higher `_id`, so it lands on the head page and cannot enter a lower one.
 *   The composition of page 40 is therefore immutable, and can be cached for
 *   minutes with no risk of being wrong.
 *
 *   The head page (`cursor == null`) is exactly where new posts DO land, so it
 *   gets seconds instead.
 *
 * That asymmetry is worth a lot: deep scrolling — the expensive part, where an
 * offset-based feed would be scanning and discarding hundreds of thousands of
 * documents — is the part that caches best.
 *
 * (`scope=mine` is keyed per user; the public scope is keyed once and shared by
 * everybody, because the query is identical for all of them.)
 */
export async function getFeed({ viewerId, cursor, limit, scope = 'all' }) {
  const key = cache.keys.feedPage(scope, viewerId, cursor, limit);
  const ttl = cursor ? env.cache.feedPageTtl : env.cache.feedHeadTtl;

  const page = await cache.remember(key, ttl, async () => {
    const docs = await postRepo.findFeedPage({ viewerId, cursor, limit, scope });
    const { items, nextCursor, hasMore } = buildPage(docs, limit);

    // Populate the body cache on the way past — the ids we are about to return
    // are the ids the client is about to render.
    const previews = await likeRepo.likePreviews(
      TARGET_TYPE.POST,
      items.map((item) => item._id)
    );
    cache.mset(
      items.map((item) => [
        cache.keys.post(item._id),
        sharedPost(item, previews.get(String(item._id)) ?? []),
      ]),
      env.cache.postTtl
    );

    return { ids: items.map((item) => String(item._id)), nextCursor, hasMore };
  });

  const posts = await hydratePosts(page.ids);

  return {
    posts: await personalize(posts, viewerId),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

export async function getPost({ postId, viewerId }) {
  // The visibility check runs against MONGO, never against the cache — a cached
  // post body carries no permission with it, and authorization that can be served
  // from a cache is authorization that can be served stale.
  const visible = await postRepo.findVisibleById(postId, viewerId);
  // Someone else's private post is reported as "not found", not "forbidden": a
  // 403 would confirm that a post with that id exists.
  if (!visible) throw ApiError.notFound('This post is unavailable.');

  const [post] = await hydratePosts([postId]);
  if (!post) throw ApiError.notFound('This post is unavailable.');

  const [personalized] = await personalize([post], viewerId);
  return personalized;
}

export async function createPost({ authorId, content = '', visibility = VISIBILITY.PUBLIC, file }) {
  // Checked BEFORE the upload, not after: a post with neither text nor an image
  // is going to be rejected either way, and this way we neither pay to push 5MB
  // to Cloudinary nor have to clean it up again.
  if (!content.trim() && !file) {
    throw ApiError.badRequest('Write something or add an image before posting.');
  }

  const image = file ? await uploadPostImage(file) : null;

  let created;
  try {
    created = await postRepo.create({
      content: content.trim(),
      image,
      visibility,
      // The author is ALWAYS the authenticated user, never read from the request
      // body — so a client cannot post as somebody else.
      author: authorId,
    });
  } catch (error) {
    // The image is already in Cloudinary. Without the row that points at it,
    // nothing can ever reference it or clean it up — so undo the upload.
    await destroyPostImage(image);
    throw error;
  }

  /**
   * THE RESPONSE IS NOT WAITING FOR ANY OF THIS.
   *
   * Fan-out to followers and image variant generation are both consequences of
   * the write, and neither changes what we are about to return. Doing them inline
   * would make "post a photo" slower for the users who have the most followers —
   * the exact inversion of what you want. Enqueue, and return in ~50ms whether
   * the author has 3 followers or 3 million.
   */
  if (visibility === VISIBILITY.PUBLIC) {
    await enqueuePostFanout({ postId: created._id, authorId });
  }
  if (image) {
    await enqueueMediaDerive({ postId: created._id, image });
  }

  invalidateFeedHead();

  const post = await postRepo.findById(created._id);
  const [personalized] = await personalize([sharedPost(post, [])], authorId);
  return personalized;
}

export async function updatePost({ postId, viewerId, content, visibility, removeImage, file }) {
  const post = await postRepo.findForUpdate(postId);
  if (!post) throw ApiError.notFound('This post no longer exists.');
  assertOwnership(post, viewerId);

  const previousImage = post.image;

  // Resolve the post's FINAL state and validate that, so an edit which would
  // leave the post empty is rejected before the upload rather than after it.
  const nextContent = content !== undefined ? content.trim() : post.content;
  const willHaveImage = file ? true : !(removeImage || !post.image);

  if (!nextContent && !willHaveImage) {
    throw ApiError.badRequest('A post needs either text or an image.');
  }

  post.content = nextContent;
  if (visibility !== undefined) post.visibility = visibility;
  if (file) post.image = await uploadPostImage(file);
  else if (removeImage) post.image = null;

  try {
    await post.save();
  } catch (error) {
    if (post.image !== previousImage) await destroyPostImage(post.image);
    throw error;
  }

  // Only once the row no longer points at it — otherwise a failed save would
  // leave a post referencing an image that had already been deleted.
  if (previousImage !== post.image) await destroyPostImage(previousImage);

  if (post.image && post.image !== previousImage) {
    await enqueueMediaDerive({ postId: post._id, image: post.image });
  }

  /**
   * ONE key. This is the dividend of caching bodies separately from feed pages:
   * an edited post is invalidated in a single DEL, and every feed page that
   * references it — there may be thousands — picks the new body up on its next
   * hydrate. Had the bodies been cached inside the pages, this line would have to
   * find and rewrite every page the post appears on, which is not a thing you can
   * do without either a reverse index or a SCAN over the keyspace.
   */
  cache.del(cache.keys.post(post._id));
  invalidateFeedHead();

  const updated = await postRepo.findById(post._id);
  const previews = await likeRepo.likePreviews(TARGET_TYPE.POST, [post._id]);
  const [personalized] = await personalize(
    [sharedPost(updated, previews.get(String(post._id)) ?? [])],
    viewerId
  );
  return personalized;
}

export async function deletePost({ postId, viewerId }) {
  const post = await postRepo.findForUpdate(postId);
  if (!post) throw ApiError.notFound('This post no longer exists.');
  assertOwnership(post, viewerId);

  const commentIds = (await commentRepo.findIdsForPost(post._id)).map((c) => c._id);

  // Delete the post's dependents too. Otherwise likes and comments outlive their
  // parent, and every count derived from them drifts.
  await Promise.all([
    postRepo.deleteById(post._id),
    commentRepo.deleteForPost(post._id),
    likeRepo.deleteForTargets(TARGET_TYPE.POST, [post._id]),
    likeRepo.deleteForTargets(TARGET_TYPE.COMMENT, commentIds),
  ]);

  // Pull the id back out of the timelines it was pushed into. Reads tolerate a
  // dangling id already (hydrate drops it), so this is hygiene rather than a
  // correctness fix — which is exactly why it belongs on a queue.
  await enqueueFanoutRetract({ postId: post._id, authorId: post.author });

  cache.del(cache.keys.post(post._id));
  invalidateFeedHead();

  await destroyPostImage(post.image);
}

/**
 * Authorization. Ownership is checked against the RESOURCE, never against an id
 * supplied by the client — the caller can only ever act as themselves.
 */
export function assertOwnership(resource, userId) {
  const ownerId = resource.author?._id ?? resource.author;
  if (String(ownerId) !== String(userId)) {
    throw ApiError.forbidden('You can only modify your own content.');
  }
}

/**
 * Invalidating the feed HEAD is deliberately a no-op.
 *
 * It looks like an omission, so it is worth being explicit: the head page has a
 * ~20 second TTL and every write would otherwise DEL it. On a busy site that
 * means the head page is evicted several times a second, is therefore never
 * warm, and every reader who lands on it — which is MOST readers — goes to Mongo.
 * The cache would be doing no work at all while still costing a round trip.
 *
 * A ~20 second window in which the discovery feed does not yet show a
 * five-second-old post is not a bug; it is what "eventually consistent" buys.
 * The author still sees their own post instantly, because the client splices it
 * onto page 1 locally (client/src/hooks/useFeed.js) — so the one person who would
 * notice, doesn't.
 *
 * Kept as a named function because the intent is the point, and because the day
 * this becomes wrong (a feed that must be strictly fresh) this is the one place
 * that changes.
 */
function invalidateFeedHead() {
  log().debug('feed head left to expire naturally (TTL-based invalidation)');
}
