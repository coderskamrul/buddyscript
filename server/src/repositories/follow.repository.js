import { Follow } from '../models/Follow.js';
import { User } from '../models/User.js';
import { cursorFilter } from '../utils/pagination.js';

export const create = (follower, following) => Follow.create({ follower, following });

export const remove = (follower, following) => Follow.deleteOne({ follower, following });

export const exists = (follower, following) => Follow.exists({ follower, following });

/**
 * THE fan-out read.
 *
 * This is the only query in the codebase that will ever be asked to walk a
 * million rows, and it is deliberately shaped so that it never walks them all at
 * once. The worker calls it in a loop, handing back the last `_id` it saw, and
 * each call is a bounded seek into `{ following: 1, _id: 1 }` — so fanning out to
 * a million followers is a thousand cheap 1,000-row scans, not one query that
 * holds a cursor open for minutes and dies on a worker restart.
 *
 * Note it returns `_id` alongside the follower: the `_id` IS the cursor. Paging
 * this with skip/limit instead would make batch 1,000 scan and discard the
 * 999,000 rows before it — quadratic work, on the hottest write path we have.
 */
export async function findFollowerBatch({ userId, afterId, limit }) {
  const filter = { following: userId };
  if (afterId) filter._id = { $gt: afterId };

  const rows = await Follow.find(filter)
    .sort({ _id: 1 })
    .limit(limit)
    .select('_id follower')
    .lean();

  return {
    followerIds: rows.map((row) => row.follower),
    // null => the last batch; the fan-out loop stops here.
    nextId: rows.length === limit ? rows[rows.length - 1]._id : null,
  };
}

/** Everyone the viewer follows. Feeds the celebrity split on the read path. */
export async function findFollowingIds(userId) {
  const rows = await Follow.find({ follower: userId }).select('following').lean();
  return rows.map((row) => row.following);
}

/**
 * Splits the people a viewer follows into the two halves of the hybrid feed:
 * the celebrities (whose posts must be PULLED at read time, because we never
 * pushed them) and everyone else (whose posts are already sitting in the
 * viewer's materialized timeline).
 *
 * One aggregation, not a fetch-then-N-lookups: the `$lookup` resolves every
 * followee's follower count in a single pass.
 */
export async function splitFollowingByReach(userId, threshold) {
  const rows = await Follow.aggregate([
    { $match: { follower: userId } },
    {
      $lookup: {
        from: 'users',
        localField: 'following',
        foreignField: '_id',
        as: 'user',
        pipeline: [{ $project: { followerCount: 1 } }],
      },
    },
    { $unwind: '$user' },
    {
      $group: {
        _id: null,
        celebrities: {
          $push: {
            $cond: [{ $gte: ['$user.followerCount', threshold] }, '$following', '$$REMOVE'],
          },
        },
        regular: {
          $push: {
            $cond: [{ $lt: ['$user.followerCount', threshold] }, '$following', '$$REMOVE'],
          },
        },
      },
    },
  ]);

  return {
    celebrities: rows[0]?.celebrities ?? [],
    regular: rows[0]?.regular ?? [],
  };
}

export function findFollowers({ userId, cursor, limit }) {
  return Follow.find({ following: userId, ...cursorFilter(cursor) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('follower', 'firstName lastName avatar')
    .lean();
}

/**
 * The counters that decide push-vs-pull. Kept on the User document precisely so
 * that this question — asked on the write path of EVERY post — is one indexed
 * document read rather than a count() across the edge collection.
 */
export const incrementCounts = (followerId, followingId, delta) =>
  Promise.all([
    User.updateOne({ _id: followerId }, [
      { $set: { followingCount: { $max: [0, { $add: ['$followingCount', delta] }] } } },
    ]),
    User.updateOne({ _id: followingId }, [
      { $set: { followerCount: { $max: [0, { $add: ['$followerCount', delta] }] } } },
    ]),
  ]);
