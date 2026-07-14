import { Router } from 'express';
import { getHomeTimeline } from '../controllers/feed.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listQuerySchema } from '../validators/schemas.js';

const router = Router();

router.use(requireAuth);

// GET /api/feed — the follower-graph home timeline (hybrid push/pull).
router.get('/', validate(listQuerySchema, 'query'), getHomeTimeline);

export default router;
