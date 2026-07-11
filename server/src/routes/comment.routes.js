import { Router } from 'express';
import { deleteComment, listReplies } from '../controllers/comment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, listQuerySchema } from '../validators/schemas.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/:id/replies',
  validate(idParamSchema, 'params'),
  validate(listQuerySchema, 'query'),
  listReplies
);
router.delete('/:id', validate(idParamSchema, 'params'), deleteComment);

export default router;
