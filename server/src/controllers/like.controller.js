import { Like, TARGET_TYPE } from '../models/Like.js';
import { Post, VISIBILITY } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildPage, cursorFilter, parseLimit } from '../utils/pagination.js';
import { shapeAuthor } from '../utils/likeState.js';

const modelFor = (targetType) => (targetType === TARGET_TYPE.POST ? Post : Comment);

/**
 * Resolves the like target and enforces that the viewer can actually see it.
 * Without this, a user could like — and thereby confirm the existence of —
 * another user's private post by posting its id.
 */
async function loadVisibleTarget(targetType, targetId, viewerId) {
  if (targetType === TARGET_TYPE.POST) {
    const post = await Post.findOne({
      _id: targetId,
      $or: [{ visibility: VISIBILITY.PUBLIC }, { author: viewerId }],
    })
      .select('_id')
      .lean();
    if (!post) throw ApiError.notFound('This post is unavailable.');
    return post;
  }

  const comment = await Comment.findById(targetId).select('_id post').lean();
  if (!comment) throw ApiError.notFound('This comment is unavailable.');

  // The comment is only reachable if its post is.
  const post = await Post.findOne({
    _id: comment.post,
    $or: [{ visibility: VISIBILITY.PUBLIC }, { author: viewerId }],
  })
    .select('_id')
    .lean();
  if (!post) throw ApiError.notFound('This comment is unavailable.');

  return comment;
}

// Clamped decrement. A plain `$inc: -1` can drift below zero if a duplicate
// unlike ever slips through; an aggregation-pipeline update lets the floor be
// enforced by the database itself.
const decrementLikeCount = (Model, id) =>
  Model.updateOne({ _id: id }, [
    { $set: { likeCount: { $max: [0, { $subtract: ['$likeCount', 1] }] } } },
  ]);

/**
 * Toggle like/unlike. The unique index on (targetType, target, user) is the
 * source of truth: rather than check-then-write (which two concurrent clicks can
 * both pass, producing a double like), we attempt the insert and let the
 * database arbitrate. A duplicate-key error *is* the signal that it was already
 * liked, so a rapid double-click settles deterministically instead of racing.
 */
export const toggleLike = asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.body;
  const viewerId = req.user._id;

  await loadVisibleTarget(targetType, targetId, viewerId);
  const Model = modelFor(targetType);

  let liked;
  try {
    await Like.create({ user: viewerId, targetType, target: targetId });
    await Model.updateOne({ _id: targetId }, { $inc: { likeCount: 1 } });
    liked = true;
  } catch (err) {
    if (err.code !== 11000) throw err;

    const { deletedCount } = await Like.deleteOne({
      user: viewerId,
      targetType,
      target: targetId,
    });
    if (deletedCount) await decrementLikeCount(Model, targetId);
    liked = false;
  }

  const target = await Model.findById(targetId).select('likeCount').lean();

  res.json({
    success: true,
    data: { liked, likeCount: target?.likeCount ?? 0, targetType, targetId },
  });
});

/**
 * "Who liked this" — paginated, because a popular post's liker list is not a
 * bounded thing you can ship in one response.
 */
export const listLikers = asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.validatedQuery ?? {};
  const viewerId = req.user._id;

  await loadVisibleTarget(targetType, targetId, viewerId);

  const limit = parseLimit(req.validatedQuery?.limit, 20);

  const docs = await Like.find({
    targetType,
    target: targetId,
    ...cursorFilter(req.validatedQuery?.cursor),
  })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('user', 'firstName lastName avatar')
    .lean();

  const { items, nextCursor, hasMore } = buildPage(docs, limit);

  res.json({
    success: true,
    data: {
      likers: items
        .filter((like) => like.user)
        .map((like) => ({
          ...shapeAuthor(like.user),
          isMe: String(like.user._id) === String(viewerId),
          likedAt: like.createdAt,
        })),
      nextCursor,
      hasMore,
    },
  });
});
