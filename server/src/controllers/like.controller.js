import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit } from '../utils/pagination.js';
import * as likeService from '../services/like.service.js';

export const toggleLike = asyncHandler(async (req, res) => {
  const data = await likeService.toggleLike({
    targetType: req.body.targetType,
    targetId: req.body.targetId,
    viewerId: req.user._id,
  });

  res.json({ success: true, data });
});

export const listLikers = asyncHandler(async (req, res) => {
  const { targetType, targetId, cursor, limit } = req.validatedQuery ?? {};

  const data = await likeService.listLikers({
    targetType,
    targetId,
    viewerId: req.user._id,
    cursor,
    limit: parseLimit(limit, 20),
  });

  res.json({ success: true, data });
});
