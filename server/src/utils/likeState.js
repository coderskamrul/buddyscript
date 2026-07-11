import { Like } from '../models/Like.js';

/**
 * Resolves "has the viewer liked this?" for a whole page of targets in ONE query.
 *
 * The naive alternative — asking per post, then per comment, then per reply — is
 * the classic N+1: a 10-post page with 5 comments each becomes 60+ round trips.
 * Here it is always exactly one indexed query per target type, regardless of
 * page size.
 */
export async function likedTargetIds(userId, targetType, ids) {
  if (!userId || !ids.length) return new Set();

  const likes = await Like.find({
    user: userId,
    targetType,
    target: { $in: ids },
  })
    .select('target')
    .lean();

  return new Set(likes.map((like) => String(like.target)));
}

/**
 * The handful of faces shown stacked on a post's reaction row.
 *
 * Done as ONE aggregation for the whole page rather than a query per post.
 * `$topN` caps the work at `limit` likers per target inside the group stage, so
 * a post with a million likes still only carries five users out of the database —
 * a plain `$push` would materialize the entire liker array just to throw it away.
 */
export async function likePreviews(targetType, ids, limit = 5) {
  if (!ids.length) return new Map();

  const rows = await Like.aggregate([
    { $match: { targetType, target: { $in: ids } } },
    {
      $group: {
        _id: '$target',
        // Newest likers first, matching the "who liked this" list's order.
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

export const AUTHOR_FIELDS = 'firstName lastName avatar';

export const shapeAuthor = (author) =>
  author
    ? {
        id: author._id,
        firstName: author.firstName,
        lastName: author.lastName,
        fullName: `${author.firstName} ${author.lastName}`,
        avatar: author.avatar,
      }
    : null;
