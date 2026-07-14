import { Like, TARGET_TYPE } from '../models/Like.js';
import { AUTHOR_FIELDS } from './projections.js';
import { cursorFilter } from '../utils/pagination.js';

export { TARGET_TYPE };

export const create = (data) => Like.create(data);

export const deleteOne = (filter) => Like.deleteOne(filter);

export const deleteForTargets = (targetType, targetIds) =>
  Like.deleteMany({ targetType, target: { $in: targetIds } });

/**
 * "Which of these targets has the viewer liked?" — for a WHOLE PAGE, in ONE query.
 *
 * The naive version asks once per post, then once per comment, then once per
 * reply: a 10-post page with 5 comments each becomes 60+ round trips, and the
 * feed's latency becomes a function of how chatty the page is. Here it is always
 * exactly one indexed query per target type, whatever the page holds — served by
 * the `{ user: 1, targetType: 1, target: 1 }` index, which covers the query
 * outright (every field it needs is IN the index, so Mongo never touches a
 * document).
 */
export async function likedTargetIds(userId, targetType, ids) {
  if (!userId || !ids.length) return new Set();

  const likes = await Like.find({ user: userId, targetType, target: { $in: ids } })
    .select('target')
    .lean();

  return new Set(likes.map((like) => String(like.target)));
}

/**
 * The handful of faces stacked on each post's reaction row — again for the whole
 * page in ONE aggregation, not a query per post.
 *
 * `$topN` caps the work at `limit` likers per target INSIDE the group stage, so
 * a post with a million likes still carries exactly five users out of the
 * database. A plain `$push` would materialize the entire million-element liker
 * array in memory purely to throw all but five of them away — and would blow the
 * 100MB aggregation memory limit long before that.
 */
export async function likePreviews(targetType, ids, limit = 5) {
  if (!ids.length) return new Map();

  const rows = await Like.aggregate([
    { $match: { targetType, target: { $in: ids } } },
    {
      $group: {
        _id: '$target',
        users: { $topN: { n: limit, sortBy: { _id: -1 }, output: '$user' } },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'users',
        foreignField: '_id',
        as: 'users',
        pipeline: [{ $project: { firstName: 1, lastName: 1, avatar: 1 } }],
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      row.users.map((user) => ({
        id: user._id,
        fullName: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
      })),
    ])
  );
}

/** "Who liked this" — paginated, because a viral post's liker list is unbounded. */
export function findLikers({ targetType, targetId, cursor, limit }) {
  return Like.find({ targetType, target: targetId, ...cursorFilter(cursor) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('user', AUTHOR_FIELDS)
    .lean();
}
