import { ApiError } from '../utils/ApiError.js';
import { buildPage } from '../utils/pagination.js';
import { TARGET_TYPE } from '../models/Like.js';
import { NOTIFICATION_TYPE } from '../models/Notification.js';
import * as likeRepo from '../repositories/like.repository.js';
import * as postRepo from '../repositories/post.repository.js';
import * as commentRepo from '../repositories/comment.repository.js';
import * as cache from './cache.service.js';
import { shapeAuthor } from './presenter.js';
import { enqueueNotification } from '../queues/producers.js';

/**
 * Resolves a like target and enforces that the viewer can actually SEE it.
 *
 * Without this, a user could like — and thereby confirm the existence and the id
 * of — someone else's private post simply by POSTing its id. Note it queries
 * Mongo, not the cache: a permission check served from a cache is a permission
 * check that can be served stale.
 */
async function loadVisibleTarget(targetType, targetId, viewerId) {
  if (targetType === TARGET_TYPE.POST) {
    const post = await postRepo.findVisibleById(targetId, viewerId);
    if (!post) throw ApiError.notFound('This post is unavailable.');
    return { id: post._id, ownerId: post.author, postId: post._id };
  }

  const comment = await commentRepo.findById(targetId);
  if (!comment) throw ApiError.notFound('This comment is unavailable.');

  // A comment is only reachable if its post is.
  const post = await postRepo.findVisibleById(comment.post, viewerId);
  if (!post) throw ApiError.notFound('This comment is unavailable.');

  return { id: comment._id, ownerId: comment.author, postId: comment.post };
}

const counterRepo = (targetType) => (targetType === TARGET_TYPE.POST ? postRepo : commentRepo);

/**
 * Toggle like/unlike.
 *
 * The unique index on `(targetType, target, user)` is the SOURCE OF TRUTH, not an
 * application-level check-then-write. Check-then-write has a race that two
 * concurrent clicks both pass — both read "not liked", both insert, and the count
 * goes up by two. Here we attempt the insert and let the DATABASE arbitrate: a
 * duplicate-key error IS the signal that it was already liked. A rapid
 * double-click therefore settles deterministically instead of racing.
 */
export async function toggleLike({ targetType, targetId, viewerId }) {
  const target = await loadVisibleTarget(targetType, targetId, viewerId);
  const repo = counterRepo(targetType);

  let liked;
  try {
    await likeRepo.create({ user: viewerId, targetType, target: targetId });
    await repo.incrementLikeCount(targetId, 1);
    liked = true;
  } catch (error) {
    if (error.code !== 11000) throw error;

    // Already liked => this is an unlike. Only decrement if WE were the ones who
    // removed the row, so a double-unlike cannot drive the count below zero.
    const { deletedCount } = await likeRepo.deleteOne({
      user: viewerId,
      targetType,
      target: targetId,
    });
    if (deletedCount) await repo.incrementLikeCount(targetId, -1);
    liked = false;
  }

  // The like count and the like preview both live in the cached post body, and
  // both just changed. One DEL; every feed page referencing this post picks the
  // new body up on its next read.
  if (targetType === TARGET_TYPE.POST) {
    cache.del(cache.keys.post(targetId));
  }

  // Off the critical path. The user gets their answer; the author gets told by a
  // worker a moment later. (Only on like, never on unlike — nobody needs to be
  // notified that they have been un-liked.)
  if (liked) {
    await enqueueNotification({
      recipientId: target.ownerId,
      actorId: viewerId,
      type: NOTIFICATION_TYPE.LIKE,
      entityType: targetType,
      entityId: targetId,
    });
  }

  const fresh =
    targetType === TARGET_TYPE.POST
      ? await postRepo.findById(targetId)
      : await commentRepo.findPopulated(targetId);

  return { liked, likeCount: fresh?.likeCount ?? 0, targetType, targetId };
}

/** "Who liked this" — paginated, because a viral post's liker list is unbounded. */
export async function listLikers({ targetType, targetId, viewerId, cursor, limit }) {
  await loadVisibleTarget(targetType, targetId, viewerId);

  const docs = await likeRepo.findLikers({ targetType, targetId, cursor, limit });
  const { items, nextCursor, hasMore } = buildPage(docs, limit);

  return {
    likers: items
      // A like whose user has since deleted their account.
      .filter((like) => like.user)
      .map((like) => ({
        ...shapeAuthor(like.user),
        isMe: String(like.user._id) === String(viewerId),
        likedAt: like.createdAt,
      })),
    nextCursor,
    hasMore,
  };
}
