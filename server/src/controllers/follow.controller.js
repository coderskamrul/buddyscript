import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit } from '../utils/pagination.js';
import * as followService from '../services/follow.service.js';

export const follow = asyncHandler(async (req, res) => {
  const data = await followService.follow({
    followerId: req.user._id,
    targetId: req.params.id,
  });

  res.status(201).json({ success: true, data });
});

export const unfollow = asyncHandler(async (req, res) => {
  const data = await followService.unfollow({
    followerId: req.user._id,
    targetId: req.params.id,
  });

  res.json({ success: true, data });
});

export const listFollowers = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};

  const data = await followService.listFollowers({
    userId: req.params.id,
    viewerId: req.user._id,
    cursor,
    limit: parseLimit(limit, 20),
  });

  res.json({ success: true, data });
});
