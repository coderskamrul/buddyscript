import { ApiError } from '../utils/ApiError.js';
import { buildPage } from '../utils/pagination.js';
import { TARGET_TYPE } from '../models/Like.js';
import { NOTIFICATION_TYPE } from '../models/Notification.js';
import * as commentRepo from '../repositories/comment.repository.js';
import * as postRepo from '../repositories/post.repository.js';
import * as likeRepo from '../repositories/like.repository.js';
import * as cache from './cache.service.js';
import { shapeComment } from './presenter.js';
import { enqueueNotification } from '../queues/producers.js';

/**
 * Loads a post only if the viewer is allowed to see it. EVERY comment path starts
 * here, so a private post's comment thread is unreachable — including by guessing
 * the post id.
 */
async function loadVisiblePost(postId, viewerId) {
  const post = await postRepo.findVisibleById(postId, viewerId);
  if (!post) throw ApiError.notFound('This post is unavailable.');
  return post;
}

export async function listComments({ postId, viewerId, cursor, limit }) {
  const post = await loadVisiblePost(postId, viewerId);

  const docs = await commentRepo.findTopLevel({ postId: post._id, cursor, limit });
  const { items, nextCursor, hasMore } = buildPage(docs, limit);

  // ONE query for the whole page's like state — not one per comment.
  const likedIds = await likeRepo.likedTargetIds(
    viewerId,
    TARGET_TYPE.COMMENT,
    items.map((item) => item._id)
  );

  return {
    comments: items.map((comment) =>
      shapeComment(comment, { likedIds, viewerId, postAuthorId: post.author })
    ),
    nextCursor,
    hasMore,
  };
}

/**
 * Replies are fetched PER COMMENT rather than embedded in the comment list.
 * Eager-loading every reply would let one popular thread dominate the payload of
 * an entire feed page; this way the cost is paid only when a user expands it.
 */
export async function listReplies({ commentId, viewerId, cursor, limit }) {
  const parent = await commentRepo.findById(commentId);
  if (!parent) throw ApiError.notFound('This comment no longer exists.');

  const post = await loadVisiblePost(parent.post, viewerId);

  const docs = await commentRepo.findReplies({
    postId: post._id,
    parentId: parent._id,
    cursor,
    limit,
  });

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;

  const likedIds = await likeRepo.likedTargetIds(
    viewerId,
    TARGET_TYPE.COMMENT,
    items.map((item) => item._id)
  );

  return {
    replies: items.map((reply) =>
      shapeComment(reply, { likedIds, viewerId, postAuthorId: post.author })
    ),
    // Replies run oldest-first, so the cursor walks FORWARD — it is the last id
    // on the page, and the next page is everything after it.
    nextCursor: hasMore && items.length ? String(items[items.length - 1]._id) : null,
    hasMore,
  };
}

export async function createComment({ postId, viewerId, content, parentId }) {
  const post = await loadVisiblePost(postId, viewerId);

  let parent = null;
  if (parentId) {
    parent = await commentRepo.findById(parentId);
    if (!parent) throw ApiError.notFound('The comment you replied to no longer exists.');

    // A reply must belong to the post it claims to, or a client could graft a
    // reply from one post onto another.
    if (String(parent.post) !== String(post._id)) {
      throw ApiError.badRequest('That comment belongs to a different post.');
    }

    // Threading is capped at one level: replying to a reply attaches to the same
    // top-level comment instead of nesting deeper. It keeps a thread readable at
    // any depth, and it keeps reads to two queries instead of a recursive walk.
    if (parent.parent) {
      parent = { _id: parent.parent, post: parent.post, author: parent.author };
    }
  }

  const comment = await commentRepo.create({
    post: post._id,
    author: viewerId,
    parent: parent?._id ?? null,
    content,
  });

  await Promise.all([
    // commentCount counts every contribution to the thread, replies included.
    postRepo.incrementCommentCount(post._id, 1),
    parent ? commentRepo.incrementReplyCount(parent._id, 1) : null,
  ]);

  // The post's cached body carries commentCount, which just changed.
  cache.del(cache.keys.post(post._id));

  // A reply notifies the comment's author; a top-level comment notifies the
  // post's. Both off the request path.
  await enqueueNotification({
    recipientId: parent ? parent.author : post.author,
    actorId: viewerId,
    type: parent ? NOTIFICATION_TYPE.REPLY : NOTIFICATION_TYPE.COMMENT,
    entityType: 'post',
    entityId: post._id,
  });

  const populated = await commentRepo.findPopulated(comment._id);
  return shapeComment(populated, {
    likedIds: new Set(),
    viewerId,
    postAuthorId: post.author,
  });
}

export async function deleteComment({ commentId, viewerId }) {
  const comment = await commentRepo.findById(commentId);
  if (!comment) throw ApiError.notFound('This comment no longer exists.');

  const post = await postRepo.findVisibleById(comment.post, viewerId);

  const isCommentAuthor = String(comment.author) === String(viewerId);
  const isPostAuthor = post && String(post.author) === String(viewerId);

  if (!isCommentAuthor && !isPostAuthor) {
    throw ApiError.forbidden('You can only delete your own comments.');
  }

  // Deleting a top-level comment takes its replies with it.
  const replies = comment.parent ? [] : await commentRepo.findReplyIds(comment._id);
  const replyIds = replies.map((reply) => reply._id);
  const doomed = [comment._id, ...replyIds];
  const removedCount = doomed.length;

  await Promise.all([
    commentRepo.deleteByIds(doomed),
    likeRepo.deleteForTargets(TARGET_TYPE.COMMENT, doomed),
    postRepo.incrementCommentCount(comment.post, -removedCount),
    comment.parent ? commentRepo.incrementReplyCount(comment.parent, -1) : null,
  ]);

  cache.del(cache.keys.post(comment.post));

  return { removedCount };
}
