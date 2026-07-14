/**
 * The REPOSITORY layer.
 *
 * Everything in this directory knows about Mongo and nothing else. It does not
 * know what an HTTP status code is, what the viewer is allowed to see, or what
 * shape the client wants — those are the service's and the controller's jobs
 * respectively.
 *
 * The payoff is that the storage decision stops leaking. Sharding the posts
 * collection, moving the like-state lookup to a read replica, or putting a
 * different database under the timeline touches these files and no others,
 * because no controller anywhere has a `Post.find()` in it to update.
 */
import { Post, VISIBILITY } from '../models/Post.js';
import { AUTHOR_FIELDS } from './projections.js';
import { cursorFilter } from '../utils/pagination.js';

/**
 * The visibility rule, in exactly one place: you see every public post, plus
 * your own private ones. It is expressed as a database filter rather than as a
 * post-fetch `.filter()`, which matters — a filter applied after the fact would
 * silently shrink pages (ask for 10, get 6) and, worse, would mean the rows had
 * already left the database.
 */
export const visibilityFilter = (viewerId) => ({
  $or: [{ visibility: VISIBILITY.PUBLIC }, { author: viewerId }],
});

/** One page of the discovery feed, newest first. Fetches limit+1 to detect `hasMore`. */
export function findFeedPage({ viewerId, cursor, limit, scope }) {
  const filter = {
    ...cursorFilter(cursor),
    ...(scope === 'mine' ? { author: viewerId } : visibilityFilter(viewerId)),
  };

  return (
    Post.find(filter)
      // `_id: -1` is newest-first AND the key the cursor walks, so Mongo returns
      // the page straight from the index — no in-memory sort, no skip.
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('author', AUTHOR_FIELDS)
      // lean(): plain objects, no Mongoose document wrappers. On a read path this
      // hot, that hydration is pure overhead — and these rows are about to be
      // JSON-serialized into a cache anyway.
      .lean()
  );
}

/**
 * Posts by a set of authors — the celebrity-pull half of the hybrid timeline.
 * Served by the `{ author: 1, visibility: 1, _id: -1 }` index.
 */
export function findPostsByAuthors({ authorIds, cursor, limit }) {
  if (!authorIds.length) return Promise.resolve([]);

  return Post.find({
    author: { $in: authorIds },
    visibility: VISIBILITY.PUBLIC,
    ...cursorFilter(cursor),
  })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    .lean();
}

/**
 * Hydrates a list of post ids IN ONE QUERY.
 *
 * This is the anti-N+1 primitive the whole feed rests on. A materialized
 * timeline is a list of ids; turning 800 ids into 800 `findById` calls would be
 * the exact problem the timeline was built to avoid. `$in` makes it one query
 * whose result we re-sort into the caller's order — Mongo returns `$in` matches
 * in index order, not in the order the ids were given.
 */
export async function findPostsByIds(ids) {
  if (!ids.length) return [];

  const posts = await Post.find({ _id: { $in: ids } })
    .populate('author', AUTHOR_FIELDS)
    .lean();

  const byId = new Map(posts.map((post) => [String(post._id), post]));
  // Ids whose post was deleted simply drop out — which is exactly the behaviour
  // we want from a timeline that holds ids of posts that may since have gone.
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

export const findById = (id) => Post.findById(id).populate('author', AUTHOR_FIELDS).lean();

/** Raw (non-populated, non-lean) — the caller intends to mutate and save it. */
export const findForUpdate = (id) => Post.findById(id);

export const findVisibleById = (id, viewerId) =>
  Post.findOne({ _id: id, ...visibilityFilter(viewerId) })
    .select('_id author')
    .lean();

export const create = (data) => Post.create(data);

export const deleteById = (id) => Post.deleteOne({ _id: id });

export const incrementCommentCount = (id, delta) =>
  Post.updateOne({ _id: id }, [
    // A clamped $inc. A plain `$inc: -1` can drift below zero if a delete is ever
    // replayed; an aggregation-pipeline update lets the DATABASE enforce the
    // floor, so no amount of retrying can produce a negative count.
    { $set: { commentCount: { $max: [0, { $add: ['$commentCount', delta] }] } } },
  ]);

export const incrementLikeCount = (id, delta) =>
  Post.updateOne({ _id: id }, [
    { $set: { likeCount: { $max: [0, { $add: ['$likeCount', delta] }] } } },
  ]);
