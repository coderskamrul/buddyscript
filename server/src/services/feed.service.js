import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import * as followRepo from '../repositories/follow.repository.js';
import * as postRepo from '../repositories/post.repository.js';
import * as timelineRepo from '../repositories/timeline.repository.js';
import * as cache from './cache.service.js';
import { hydratePosts, personalize } from './post.service.js';
import { getFeed as getDiscoveryFeed } from './post.service.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HOME TIMELINE — the read half of the hybrid fan-out.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FAN-OUT ON WRITE (push). When you post, your post id is copied into each of
 * your followers' Redis timelines by the fan-out worker. Reading a timeline is
 * then an O(1) list read: the work was done once, at write time, by a background
 * worker nobody was waiting on.
 *
 *   Good: reads are trivially fast, and reads outnumber writes ~100:1 in a social
 *         feed. Paying at write time is paying at the cheaper end.
 *   Bad:  the cost of one write scales with the author's follower count. At a
 *         million followers it is a million writes for a single tap.
 *
 * FAN-OUT ON READ (pull). Nothing is copied. When you open the app, we query the
 * posts of everyone you follow and merge them.
 *
 *   Good: writes are O(1), whatever your follower count.
 *   Bad:  every read is a scatter-gather across everyone you follow, and it is
 *         paid again on every refresh by every user.
 *
 * NEITHER IS CORRECT ON ITS OWN, and the reason is that follower counts are not
 * normally distributed — they are a power law. The median user has a handful of
 * followers, where push is nearly free. A tiny number have millions, where push
 * is ruinous. A single strategy has to be wrong for one end of that distribution.
 *
 * SO THIS IS A HYBRID, and it is what Twitter/Instagram actually do:
 *
 *   • Author below `celebrityThreshold` (10k) → PUSH. Their fan-out is bounded
 *     and cheap, and it makes their followers' reads free.
 *   • Author above it → PULL. We never write a single timeline entry for them.
 *     Their posts are fetched at read time, by one indexed query, only for the
 *     people who actually opened the app.
 *
 * A read is therefore: the materialized timeline (everyone normal) MERGED with a
 * live query (the few celebrities you follow). The merge is one extra Mongo query
 * against `{ author, visibility, _id }` — and it turns the worst case of push
 * (a million wasted writes) and the worst case of pull (a scatter-gather over
 * everyone you follow) into neither.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Which of the people you follow are celebrities (pull) and which are not (push).
 * Cached: it is read on every timeline request and changes only when you follow
 * somebody.
 */
async function getFollowSplit(viewerId) {
  return cache.remember(cache.keys.followSplit(viewerId), env.cache.followingTtl, async () => {
    const split = await followRepo.splitFollowingByReach(viewerId, env.feed.celebrityThreshold);
    return {
      celebrities: split.celebrities.map(String),
      regular: split.regular.map(String),
    };
  });
}

export const invalidateFollowSplit = (viewerId) => cache.del(cache.keys.followSplit(viewerId));

/**
 * Rebuilds a viewer's timeline from Mongo — the COLD START path.
 *
 * Timelines expire (a user who has not opened the app for 30 days), get evicted
 * under memory pressure, or simply never existed (a brand-new account, or a
 * Redis that was flushed). None of those may show the user an empty feed, so a
 * missing timeline means "ask Mongo", not "there is nothing here".
 *
 * This is also what makes the Redis timeline safely DISPOSABLE. It holds no
 * information that is not reconstructible from the posts collection, so flushing
 * Redis costs latency and not data — which is the only acceptable relationship to
 * have with a cache.
 */
async function rebuildFromSource(viewerId, authorIds, limit) {
  const docs = await postRepo.findPostsByAuthors({
    authorIds,
    cursor: null,
    limit: env.feed.timelineMaxLength,
  });

  const ids = docs.map((doc) => String(doc._id));
  await timelineRepo.rebuildTimeline(viewerId, ids);

  log().info({ viewerId, posts: ids.length }, 'timeline rebuilt from mongo (cold start)');
  return ids.slice(0, limit + 1);
}

/**
 * `GET /api/feed` — the home timeline.
 */
export async function getHomeTimeline({ viewerId, cursor, limit }) {
  const { celebrities, regular } = await getFollowSplit(viewerId);

  /**
   * A user who follows nobody has no timeline to read, and an empty screen is a
   * terrible first impression. Fall back to the discovery feed — which is exactly
   * what the existing client already renders, so a brand-new account sees a full
   * app rather than a blank one.
   */
  if (!celebrities.length && !regular.length) {
    const feed = await getDiscoveryFeed({ viewerId, cursor, limit, scope: 'all' });
    return { ...feed, source: 'discovery' };
  }

  // ── 1. The PUSHED half: read the materialized timeline. O(1). ───────────────
  let pushedIds = await timelineRepo.readTimeline(viewerId, { cursor, limit });

  // `null` (not `[]`) means the timeline is cold/evicted — rebuild it rather than
  // reporting an empty feed.
  if (pushedIds === null) {
    if (regular.length) {
      const rebuilt = await rebuildFromSource(viewerId, regular, limit);
      pushedIds = cursor ? rebuilt.filter((id) => id < String(cursor)) : rebuilt;
    } else {
      pushedIds = [];
    }
  }

  // ── 2. The PULLED half: celebrities, queried live. ──────────────────────────
  // One indexed query, served by `{ author: 1, visibility: 1, _id: -1 }`. This is
  // the entire read-side cost of never having fanned them out.
  const celebrityDocs = await postRepo.findPostsByAuthors({
    authorIds: celebrities,
    cursor,
    limit,
  });
  const pulledIds = celebrityDocs.map((doc) => String(doc._id));

  // ── 3. MERGE. ──────────────────────────────────────────────────────────────
  // An ObjectId's hex string sorts lexicographically in exactly the order its
  // bytes do (the leading 4 bytes are a big-endian timestamp), so sorting the
  // strings descending IS sorting by newest-first — the same order Mongo would
  // have produced. The Set collapses the case where a post arrives from both
  // halves (an author who crossed the threshold between the push and this read).
  const merged = [...new Set([...pushedIds, ...pulledIds])]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, limit + 1);

  const hasMore = merged.length > limit;
  const ids = hasMore ? merged.slice(0, limit) : merged;

  // Bodies from the SHARED post cache — the same `post:{id}` entries the
  // discovery feed reads. A post on a hundred thousand timelines is cached once.
  const posts = await hydratePosts(ids);

  return {
    posts: await personalize(posts, viewerId),
    nextCursor: hasMore && ids.length ? ids[ids.length - 1] : null,
    hasMore,
    source: 'timeline',
  };
}
