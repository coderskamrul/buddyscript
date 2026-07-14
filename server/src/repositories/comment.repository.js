import { Comment } from '../models/Comment.js';
import { AUTHOR_FIELDS } from './projections.js';
import { cursorFilter } from '../utils/pagination.js';

/** Top-level comments on a post, newest first. */
export function findTopLevel({ postId, cursor, limit }) {
  return Comment.find({ post: postId, parent: null, ...cursorFilter(cursor) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    .lean();
}

/**
 * Replies to one comment, OLDEST first — a reply thread reads as a conversation,
 * so it runs forwards even though everything else here runs backwards.
 */
export function findReplies({ postId, parentId, cursor, limit }) {
  const filter = { post: postId, parent: parentId };
  // The cursor runs the other way too: "after this one", not "before it".
  if (cursor) filter._id = { $gt: cursorFilter(cursor)._id.$lt };

  return Comment.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    .lean();
}

export const findById = (id) => Comment.findById(id).select('_id post parent author').lean();

export const findPopulated = (id) =>
  Comment.findById(id).populate('author', AUTHOR_FIELDS).lean();

export const findReplyIds = (parentId) => Comment.find({ parent: parentId }).select('_id').lean();

export const findIdsForPost = (postId) => Comment.find({ post: postId }).select('_id').lean();

export const create = (data) => Comment.create(data);

export const deleteByIds = (ids) => Comment.deleteMany({ _id: { $in: ids } });

export const deleteForPost = (postId) => Comment.deleteMany({ post: postId });

// Clamped at zero by the database itself — see post.repository.js.
export const incrementReplyCount = (id, delta) =>
  Comment.updateOne({ _id: id }, [
    { $set: { replyCount: { $max: [0, { $add: ['$replyCount', delta] }] } } },
  ]);

export const incrementLikeCount = (id, delta) =>
  Comment.updateOne({ _id: id }, [
    { $set: { likeCount: { $max: [0, { $add: ['$likeCount', delta] }] } } },
  ]);
