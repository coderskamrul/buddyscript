import fs from 'node:fs/promises';
import path from 'node:path';
import { Post, VISIBILITY } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { Like, TARGET_TYPE } from '../models/Like.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireOwnership } from '../middleware/auth.js';
import { buildPage, cursorFilter, parseLimit } from '../utils/pagination.js';
import { AUTHOR_FIELDS, likePreviews, likedTargetIds, shapeAuthor } from '../utils/likeState.js';
import { publicUrlFor } from '../middleware/upload.js';
import { env } from '../config/env.js';

const shapePost = (post, likedIds, viewerId, previews = new Map()) => ({
  id: post._id,
  content: post.content,
  image: post.image,
  visibility: post.visibility,
  author: shapeAuthor(post.author),
  likeCount: post.likeCount,
  commentCount: post.commentCount,
  likedByMe: likedIds.has(String(post._id)),
  isMine: String(post.author?._id ?? post.author) === String(viewerId),
  // Up to 5 recent likers, for the stacked faces on the reaction row.
  likePreview: previews.get(String(post._id)) ?? [],
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
});

/**
 * The visibility rule, in one place: you see every public post, plus your own
 * private ones. Nobody else's private post is reachable through any code path,
 * because this filter is applied in the database query rather than by dropping
 * rows after the fact.
 */
const visibilityFilter = (viewerId) => ({
  $or: [{ visibility: VISIBILITY.PUBLIC }, { author: viewerId }],
});

export const getFeed = asyncHandler(async (req, res) => {
  const { cursor, limit: rawLimit, scope } = req.validatedQuery ?? {};
  const limit = parseLimit(rawLimit);
  const viewerId = req.user._id;

  const filter = {
    ...cursorFilter(cursor),
    ...(scope === 'mine' ? { author: viewerId } : visibilityFilter(viewerId)),
  };

  const docs = await Post.find(filter)
    // _id descending == newest first, and it is the same key the cursor walks,
    // so Mongo satisfies the sort straight from the index — no in-memory sort.
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('author', AUTHOR_FIELDS)
    // lean(): plain objects, no Mongoose document wrappers. On a hot read path
    // that hydration is pure overhead.
    .lean();

  const { items, nextCursor, hasMore } = buildPage(docs, limit);
  const ids = items.map((item) => item._id);

  // Two queries for the whole page, regardless of how many posts it holds:
  // "which of these did I like" and "who are the recent likers of each".
  const [liked, previews] = await Promise.all([
    likedTargetIds(viewerId, TARGET_TYPE.POST, ids),
    likePreviews(TARGET_TYPE.POST, ids),
  ]);

  res.json({
    success: true,
    data: {
      posts: items.map((post) => shapePost(post, liked, viewerId, previews)),
      nextCursor,
      hasMore,
    },
  });
});

export const getPost = asyncHandler(async (req, res) => {
  const viewerId = req.user._id;

  const post = await Post.findOne({
    _id: req.params.id,
    ...visibilityFilter(viewerId),
  })
    .populate('author', AUTHOR_FIELDS)
    .lean();

  // Someone else's private post is reported as "not found", not "forbidden" —
  // a 403 would confirm that a post with that id exists.
  if (!post) throw ApiError.notFound('This post is unavailable.');

  const [liked, previews] = await Promise.all([
    likedTargetIds(viewerId, TARGET_TYPE.POST, [post._id]),
    likePreviews(TARGET_TYPE.POST, [post._id]),
  ]);
  res.json({ success: true, data: { post: shapePost(post, liked, viewerId, previews) } });
});

export const createPost = asyncHandler(async (req, res) => {
  const { content = '', visibility = VISIBILITY.PUBLIC } = req.body;
  const image = publicUrlFor(req.file);

  if (!content.trim() && !image) {
    throw ApiError.badRequest('Write something or add an image before posting.');
  }

  const created = await Post.create({
    content: content.trim(),
    image,
    visibility,
    // The author is always the authenticated user. It is never read from the
    // request body, so a client cannot post as somebody else.
    author: req.user._id,
  });

  const post = await Post.findById(created._id).populate('author', AUTHOR_FIELDS).lean();

  res.status(201).json({
    success: true,
    data: { post: shapePost(post, new Set(), req.user._id) },
  });
});

export const updatePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw ApiError.notFound('This post no longer exists.');
  requireOwnership(post, req.user._id);

  const { content, visibility, removeImage } = req.body;

  if (content !== undefined) post.content = content.trim();
  if (visibility !== undefined) post.visibility = visibility;

  const previousImage = post.image;
  if (req.file) post.image = publicUrlFor(req.file);
  else if (removeImage) post.image = null;

  if (!post.content && !post.image) {
    throw ApiError.badRequest('A post needs either text or an image.');
  }

  await post.save();
  if (previousImage && previousImage !== post.image) await removeUpload(previousImage);

  const populated = await Post.findById(post._id).populate('author', AUTHOR_FIELDS).lean();
  const [liked, previews] = await Promise.all([
    likedTargetIds(req.user._id, TARGET_TYPE.POST, [post._id]),
    likePreviews(TARGET_TYPE.POST, [post._id]),
  ]);

  res.json({
    success: true,
    data: { post: shapePost(populated, liked, req.user._id, previews) },
  });
});

export const deletePost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw ApiError.notFound('This post no longer exists.');
  requireOwnership(post, req.user._id);

  const commentIds = await Comment.find({ post: post._id }).select('_id').lean();

  // Delete the post's dependents too, otherwise likes and comments outlive their
  // parent and the like counts on a rebuilt index drift.
  await Promise.all([
    Post.deleteOne({ _id: post._id }),
    Comment.deleteMany({ post: post._id }),
    Like.deleteMany({
      $or: [
        { targetType: TARGET_TYPE.POST, target: post._id },
        {
          targetType: TARGET_TYPE.COMMENT,
          target: { $in: commentIds.map((comment) => comment._id) },
        },
      ],
    }),
  ]);

  if (post.image) await removeUpload(post.image);

  res.json({ success: true, message: 'Post deleted.' });
});

async function removeUpload(publicPath) {
  try {
    // basename() keeps a crafted value like "/uploads/../../src/server.js" from
    // escaping the upload directory.
    const file = path.join(env.uploadDir, path.basename(publicPath));
    await fs.unlink(file);
  } catch {
    // A missing file is not worth failing the request over.
  }
}
