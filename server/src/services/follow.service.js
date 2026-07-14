import { ApiError } from '../utils/ApiError.js';
import { buildPage } from '../utils/pagination.js';
import { NOTIFICATION_TYPE } from '../models/Notification.js';
import * as followRepo from '../repositories/follow.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import { shapeAuthor } from './presenter.js';
import { enqueueNotification } from '../queues/producers.js';
import { invalidateFollowSplit } from './feed.service.js';

export async function follow({ followerId, targetId }) {
  if (String(followerId) === String(targetId)) {
    throw ApiError.badRequest('You cannot follow yourself.');
  }

  const target = await userRepo.findById(targetId);
  if (!target) throw ApiError.notFound('That account does not exist.');

  try {
    await followRepo.create(followerId, targetId);
  } catch (error) {
    // The unique index arbitrates, exactly as it does for likes: a duplicate is
    // not an error, it just means the edge already existed. Following is
    // idempotent, so a double-tap settles rather than races.
    if (error.code === 11000) return { following: true, alreadyFollowing: true };
    throw error;
  }

  await followRepo.incrementCounts(followerId, targetId, 1);

  /**
   * The viewer's celebrity/regular split just changed, so the cached version of
   * it is wrong. This MUST be invalidated rather than left to expire: a stale
   * split means posts from the person you just followed appear in neither half of
   * your feed — not pushed (you were not a follower when they posted) and not
   * pulled (the cache does not yet know you follow them). You would follow someone
   * and see nothing from them for five minutes.
   */
  invalidateFollowSplit(followerId);

  await enqueueNotification({
    recipientId: targetId,
    actorId: followerId,
    type: NOTIFICATION_TYPE.FOLLOW,
  });

  /**
   * NOTE what does NOT happen here: we do not backfill the new follower's
   * timeline with the target's history. It would be a burst of writes on a user
   * action that is often idle curiosity, and it is unnecessary — the timeline
   * read already falls back to Mongo when it is cold (feed.service.js), so the
   * posts show up on the next read regardless. Backfill is an optimisation the
   * read path does not need.
   */
  return { following: true, alreadyFollowing: false };
}

export async function unfollow({ followerId, targetId }) {
  const { deletedCount } = await followRepo.remove(followerId, targetId);

  // Only adjust the counters if we actually removed an edge — otherwise a
  // repeated unfollow would drive them negative.
  if (deletedCount) {
    await followRepo.incrementCounts(followerId, targetId, -1);
    invalidateFollowSplit(followerId);
  }

  /**
   * The unfollowed author's posts are still sitting in this user's materialized
   * timeline, and they are deliberately NOT scrubbed out here.
   *
   * Scrubbing would mean scanning the timeline and removing every post by that
   * author — real work, on a user action, to correct a list that is about to age
   * out on its own. The posts fall off the end of the (bounded) timeline as new
   * ones arrive, and the alternative — a live filter on every read — would put a
   * "do I still follow this author" check on the hot path of every feed request
   * to fix something nobody notices.
   *
   * The trade is explicit: an unfollow takes effect immediately for NEW posts and
   * decays for old ones.
   */
  return { following: false };
}

export async function listFollowers({ userId, viewerId, cursor, limit }) {
  const docs = await followRepo.findFollowers({ userId, cursor, limit });
  const { items, nextCursor, hasMore } = buildPage(docs, limit);

  return {
    followers: items
      .filter((edge) => edge.follower)
      .map((edge) => ({
        ...shapeAuthor(edge.follower),
        isMe: String(edge.follower._id) === String(viewerId),
        followedAt: edge.createdAt,
      })),
    nextCursor,
    hasMore,
  };
}
