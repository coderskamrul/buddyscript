import { Router } from 'express';
import { listLikers, toggleLike } from '../controllers/like.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { likeTargetSchema, likersQuerySchema } from '../validators/schemas.js';

const router = Router();

router.use(requireAuth);

// One endpoint toggles likes for posts, comments and replies alike — the target
// type is part of the payload, so there is a single place where like semantics
// (and their authorization checks) live.
router.post('/toggle', writeLimiter, validate(likeTargetSchema), toggleLike);
router.get('/', validate(likersQuerySchema, 'query'), listLikers);

export default router;
