import { Router } from 'express';
import {
  createPost,
  deletePost,
  getFeed,
  getPost,
  updatePost,
} from '../controllers/post.controller.js';
import {
  createComment,
  listComments,
} from '../controllers/comment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadImage } from '../middleware/upload.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import {
  commentSchema,
  createPostSchema,
  feedQuerySchema,
  idParamSchema,
  listQuerySchema,
  updatePostSchema,
} from '../validators/schemas.js';

const router = Router();

// Everything below the feed is private: no route in this file is reachable
// without a valid session.
router.use(requireAuth);

router.get('/', validate(feedQuerySchema, 'query'), getFeed);

// uploadImage runs first so multipart text fields are parsed before validation.
router.post('/', writeLimiter, uploadImage, validate(createPostSchema), createPost);

router.get('/:id', validate(idParamSchema, 'params'), getPost);
router.patch(
  '/:id',
  writeLimiter,
  validate(idParamSchema, 'params'),
  uploadImage,
  validate(updatePostSchema),
  updatePost
);
router.delete('/:id', validate(idParamSchema, 'params'), deletePost);

router.get(
  '/:id/comments',
  validate(idParamSchema, 'params'),
  validate(listQuerySchema, 'query'),
  listComments
);
router.post(
  '/:id/comments',
  writeLimiter,
  validate(idParamSchema, 'params'),
  validate(commentSchema),
  createComment
);

export default router;
