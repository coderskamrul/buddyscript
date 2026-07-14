import { asyncHandler } from '../utils/asyncHandler.js';
import { parseLimit } from '../utils/pagination.js';
import * as postService from '../services/post.service.js';

/**
 * CONTROLLERS know about HTTP and nothing else.
 *
 * Read the request, call the service, write the response. There is no Mongo in
 * this file, no cache, no queue, and no business rule — which is what makes all
 * of those testable without an HTTP server and reusable from something that is
 * not one. This layer is deliberately boring; that is the whole idea.
 */

export const getFeed = asyncHandler(async (req, res) => {
  const { cursor, limit, scope } = req.validatedQuery ?? {};

  const data = await postService.getFeed({
    viewerId: req.user._id,
    cursor,
    limit: parseLimit(limit),
    scope: scope ?? 'all',
  });

  res.json({ success: true, data });
});

export const getPost = asyncHandler(async (req, res) => {
  const post = await postService.getPost({
    postId: req.params.id,
    viewerId: req.user._id,
  });

  res.json({ success: true, data: { post } });
});

export const createPost = asyncHandler(async (req, res) => {
  const post = await postService.createPost({
    authorId: req.user._id,
    content: req.body.content,
    visibility: req.body.visibility,
    file: req.file,
  });

  res.status(201).json({ success: true, data: { post } });
});

export const updatePost = asyncHandler(async (req, res) => {
  const post = await postService.updatePost({
    postId: req.params.id,
    viewerId: req.user._id,
    content: req.body.content,
    visibility: req.body.visibility,
    removeImage: req.body.removeImage,
    file: req.file,
  });

  res.json({ success: true, data: { post } });
});

export const deletePost = asyncHandler(async (req, res) => {
  await postService.deletePost({ postId: req.params.id, viewerId: req.user._id });
  res.json({ success: true, message: 'Post deleted.' });
});
