import { z } from 'zod';
import mongoose from 'mongoose';
import { VISIBILITY } from '../models/Post.js';
import { TARGET_TYPE } from '../models/Like.js';

const objectId = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), { message: 'Invalid identifier.' });

const name = (label) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(50, `${label} must be 50 characters or fewer.`);

export const registerSchema = z
  .object({
    firstName: name('First name'),
    lastName: name('Last name'),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(128, 'Password must be 128 characters or fewer.')
      .regex(/[a-zA-Z]/, 'Password must contain at least one letter.')
      .regex(/[0-9]/, 'Password must contain at least one number.'),
    confirmPassword: z.string(),
    acceptTerms: z.coerce.boolean().refine((v) => v === true, {
      message: 'You must accept the terms & conditions.',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

// Unknown keys are stripped by default, which is the point: a client that sends
// `{ author, likeCount }` gets them dropped rather than assigned.
// "must have text or an image" can't be checked here because the image arrives
// on req.file, so the controller enforces it once multer has run.
export const createPostSchema = z.object({
  content: z.string().trim().max(5000, 'Posts are limited to 5000 characters.').default(''),
  visibility: z.nativeEnum(VISIBILITY).default(VISIBILITY.PUBLIC),
});

export const updatePostSchema = z.object({
  content: z.string().trim().max(5000).optional(),
  visibility: z.nativeEnum(VISIBILITY).optional(),
  removeImage: z.coerce.boolean().optional(),
});

export const commentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(2000, 'Comments are limited to 2000 characters.'),
  // Present => this is a reply to that comment.
  parentId: objectId.optional().nullable(),
});

export const feedQuerySchema = z.object({
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  scope: z.enum(['all', 'mine']).optional(),
});

export const listQuerySchema = z.object({
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const likeTargetSchema = z.object({
  targetType: z.nativeEnum(TARGET_TYPE),
  targetId: objectId,
});

export const likersQuerySchema = z.object({
  targetType: z.nativeEnum(TARGET_TYPE),
  targetId: objectId,
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const idParamSchema = z.object({ id: objectId });
