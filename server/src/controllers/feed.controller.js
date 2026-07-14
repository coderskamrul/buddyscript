import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit } from '../utils/pagination.js';
import * as feedService from '../services/feed.service.js';

/**
 * `GET /api/feed` — the HOME TIMELINE: posts from the people you follow, assembled
 * by the hybrid push/pull strategy in services/feed.service.js.
 *
 * This is a NEW endpoint, deliberately alongside rather than instead of
 * `GET /api/posts` (the global discovery feed the existing client renders). The
 * two answer genuinely different questions — "what is happening" versus "what are
 * the people I follow saying" — and every social product ships both. Keeping them
 * separate also means the refactor did not break a single line of the React app.
 *
 * The response shape is identical to `/api/posts`, so the client's existing
 * `useFeed` hook can point at it by changing one URL.
 */
export const getHomeTimeline = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};

  const data = await feedService.getHomeTimeline({
    viewerId: req.user._id,
    cursor,
    limit: parseLimit(limit),
  });

  res.json({ success: true, data });
});
