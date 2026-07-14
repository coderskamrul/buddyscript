import { Router } from 'express';
import { follow, listFollowers, unfollow } from '../controllers/follow.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { idParamSchema, listQuerySchema } from '../validators/schemas.js';

const router = Router();

router.use(requireAuth);

// The social graph. `:id` is always the OTHER user — the follower is always the
// authenticated caller, never a value taken from the request.
router.post('/:id', writeLimiter, validate(idParamSchema, 'params'), follow);
router.delete('/:id', writeLimiter, validate(idParamSchema, 'params'), unfollow);

router.get(
  '/:id/followers',
  validate(idParamSchema, 'params'),
  validate(listQuerySchema, 'query'),
  listFollowers
);

export default router;
