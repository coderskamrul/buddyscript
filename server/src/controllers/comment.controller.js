import { Comment } from '../models/Comment.js';
import { Post, VISIBILITY } from '../models/Post.js';
import { Like, TARGET_TYPE } from '../models/Like.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildPage, cursorFilter, parseLimit } from '../utils/pagination.js';
import { AUTHOR_FIELDS, likedTargetIds, shapeAuthor } from '../utils/likeState.js';

const shapeComment = (comment, likedIds, viewerId, postAuthorId) => ({
  id: comment._id,
  postId: comment.post,
  parentId: comment.parent,
  content: comment.content,
  author: shapeAuthor(comment.author),
  likeCount: comment.likeCount,
  replyCount: comment.replyCount,
  likedByMe: likedIds.has(String(comment._id)),
  // The comment's author, or the post's author acting as moderator on their own
  // post, may delete it.
  canDelete:
    String(comment.author?._id ?? comment.author) === String(viewerId) ||
    String(postAuthorId) === String(viewerId),
  createdAt: comment.createdAt,
});

/**
 * Loads a post only if the viewer is allowed to see it. Every comment route
 * starts here, so a private post's comment thread is unreachable — including by
 * guessing the post id.
 */
async function loadVisiblePost(postId, viewerId) {
  const post = await Post.findOne({
    _id: postId,
    $or: [{ visibility: VISIBILITY.PUBLIC }, { author: viewerId }],
  })
    .select('_id author')
    .lean();

  if (!post) throw ApiError.notFound('This post is unavailable.');
  return post;
}

export const listComments = asyncHandler(async (req, res) => {
  const viewerId = req.user._id;
  const post = await loadVisiblePost(req.params.id, viewerId);

  const { cursor, limit: rawLimit } = req.validatedQuery ?? {};
  const limit = parseLimit(rawLimit);

  const docs = await Comment.find({
    post: post._id,
    parent: null, // top-level only; replies are loaded per comment on demand
    ...cursorFilter(cursor),
  })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    .lean();

  const { items, nextCursor, hasMore } = buildPage(docs, limit);
  const liked = await likedTargetIds(
    viewerId,
    TARGET_TYPE.COMMENT,
    items.map((item) => item._id)
  );

  res.json({
    success: true,
    data: {
      comments: items.map((comment) => shapeComment(comment, liked, viewerId, post.author)),
      nextCursor,
      hasMore,
    },
  });
});

/**
 * Replies are fetched per comment rather than embedded in the comment list.
 * Eager-loading every reply would make one popular thread dominate the payload
 * of an entire feed page; this way the cost is paid only when a user expands it.
 */
export const listReplies = asyncHandler(async (req, res) => {
  const viewerId = req.user._id;

  const parent = await Comment.findById(req.params.id).select('_id post').lean();
  if (!parent) throw ApiError.notFound('This comment no longer exists.');

  const post = await loadVisiblePost(parent.post, viewerId);

  const { cursor, limit: rawLimit } = req.validatedQuery ?? {};
  const limit = parseLimit(rawLimit, 20);

  const docs = await Comment.find({
    post: post._id,
    parent: parent._id,
    ...cursorFilter(cursor),
  })
    // Replies read as a conversation, so oldest-first is the natural order here.
    .sort({ _id: 1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    .lean();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const liked = await likedTargetIds(
    viewerId,
    TARGET_TYPE.COMMENT,
    items.map((item) => item._id)
  );

  res.json({
    success: true,
    data: {
      replies: items.map((reply) => shapeComment(reply, liked, viewerId, post.author)),
      nextCursor: hasMore && items.length ? items[items.length - 1]._id.toString() : null,
      hasMore,
    },
  });
});

export const createComment = asyncHandler(async (req, res) => {
  const viewerId = req.user._id;
  const post = await loadVisiblePost(req.params.id, viewerId);
  const { content, parentId } = req.body;

  let parent = null;
  if (parentId) {
    parent = await Comment.findById(parentId).select('_id post parent').lean();
    if (!parent) throw ApiError.notFound('The comment you replied to no longer exists.');

    // A reply must belong to the post it claims to, or a client could graft a
    // reply from one post onto another.
    if (String(parent.post) !== String(post._id)) {
      throw ApiError.badRequest('That comment belongs to a different post.');
    }

    // Threading is capped at one level: replying to a reply attaches to the same
    // top-level comment instead of nesting deeper. This matches the design and
    // keeps a thread readable at any depth.
    if (parent.parent) parent = { _id: parent.parent, post: parent.post };
  }

  const comment = await Comment.create({
    post: post._id,
    author: viewerId,
    parent: parent?._id ?? null,
    content,
  });

  await Promise.all([
    // commentCount counts every contribution to the thread, replies included.
    Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } }),
    parent ? Comment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } }) : null,
  ]);

  const populated = await Comment.findById(comment._id).populate('author', AUTHOR_FIELDS).lean();

  res.status(201).json({
    success: true,
    data: { comment: shapeComment(populated, new Set(), viewerId, post.author) },
  });
});

export const deleteComment = asyncHandler(async (req, res) => {
  const viewerId = req.user._id;

  const comment = await Comment.findById(req.params.id);
  if (!comment) throw ApiError.notFound('This comment no longer exists.');

  const post = await Post.findById(comment.post).select('_id author').lean();
  const isCommentAuthor = String(comment.author) === String(viewerId);
  const isPostAuthor = post && String(post.author) === String(viewerId);

  if (!isCommentAuthor && !isPostAuthor) {
    throw ApiError.forbidden('You can only delete your own comments.');
  }

  // Deleting a top-level comment takes its replies with it.
  const replies = comment.parent
    ? []
    : await Comment.find({ parent: comment._id }).select('_id').lean();
  const replyIds = replies.map((reply) => reply._id);
  const removedCount = 1 + replyIds.length;

  await Promise.all([
    Comment.deleteOne({ _id: comment._id }),
    replyIds.length ? Comment.deleteMany({ _id: { $in: replyIds } }) : null,
    Like.deleteMany({
      targetType: TARGET_TYPE.COMMENT,
      target: { $in: [comment._id, ...replyIds] },
    }),
    Post.updateOne({ _id: comment.post }, { $inc: { commentCount: -removedCount } }),
    comment.parent
      ? Comment.updateOne({ _id: comment.parent }, { $inc: { replyCount: -1 } })
      : null,
  ]);

  res.json({ success: true, message: 'Comment deleted.', data: { removedCount } });
});
