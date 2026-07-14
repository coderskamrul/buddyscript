import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit } from '../utils/pagination.js';
import * as commentService from '../services/comment.service.js';

export const listComments = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};

  const data = await commentService.listComments({
    postId: req.params.id,
    viewerId: req.user._id,
    cursor,
    limit: parseLimit(limit),
  });

  res.json({ success: true, data });
});

export const listReplies = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};

  const data = await commentService.listReplies({
    commentId: req.params.id,
    viewerId: req.user._id,
    cursor,
    limit: parseLimit(limit, 20),
  });

  res.json({ success: true, data });
});

export const createComment = asyncHandler(async (req, res) => {
  const comment = await commentService.createComment({
    postId: req.params.id,
    viewerId: req.user._id,
    content: req.body.content,
    parentId: req.body.parentId,
  });

  res.status(201).json({ success: true, data: { comment } });
});

export const deleteComment = asyncHandler(async (req, res) => {
  const { removedCount } = await commentService.deleteComment({
    commentId: req.params.id,
    viewerId: req.user._id,
  });

  res.json({ success: true, message: 'Comment deleted.', data: { removedCount } });
});
