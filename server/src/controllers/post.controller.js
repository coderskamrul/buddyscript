import { Post, VISIBILITY } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { Like, TARGET_TYPE } from '../models/Like.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireOwnership } from '../middleware/auth.js';
import { buildPage, cursorFilter, parseLimit } from '../utils/pagination.js';
import { AUTHOR_FIELDS, likePreviews, likedTargetIds, shapeAuthor } from '../utils/likeState.js';
import {
  destroyPostImage,
  isLegacyPath,
  postImageUrl,
  uploadPostImage,
} from '../services/postImage.js';

const shapePost = (post, likedIds, viewerId, previews = new Map()) => ({
  id: post._id,

  content: post.content,

  // The row holds a bare Cloudinary file name. `image` is that name rendered as
  // a ready-to-use URL, so a client needs no Cloudinary knowledge to show a
  // post; `imageId` is the name itself, so a client that *does* have that
  // knowledge can ask for a size of its own (the browser builds a srcset from
  // it). Legacy rows still hold a path, and have no id to hand out.
  image: postImageUrl(post.image),
  imageId: isLegacyPath(post.image) ? null : post.image,

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

  // Checked before the upload, not after: a post with neither text nor an image
  // is going to be rejected either way, and this way we don't pay to push 5MB to
  // Cloudinary first — nor leave it there once we do.
  if (!content.trim() && !req.file) {
    throw ApiError.badRequest('Write something or add an image before posting.');
  }

  const image = req.file ? await uploadPostImage(req.file) : null;

  let created;
  try {
    created = await Post.create({
      content: content.trim(),
      image,
      visibility,
      // The author is always the authenticated user. It is never read from the
      // request body, so a client cannot post as somebody else.
      author: req.user._id,
    });
  } catch (error) {
    // The image is already in Cloudinary. Without the row that points at it,
    // nothing can ever reference it or clean it up — so undo the upload.
    await destroyPostImage(image);
    throw error;
  }

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
  const previousImage = post.image;

  // Resolve the post's *final* state first and validate that, so an edit that
  // would empty the post is rejected before the upload rather than after it.
  const nextContent = content !== undefined ? content.trim() : post.content;
  const willHaveImage = req.file ? true : !(removeImage || !post.image);

  if (!nextContent && !willHaveImage) {
    throw ApiError.badRequest('A post needs either text or an image.');
  }

  post.content = nextContent;
  if (visibility !== undefined) post.visibility = visibility;
  if (req.file) post.image = await uploadPostImage(req.file);
  else if (removeImage) post.image = null;

  try {
    await post.save();
  } catch (error) {
    if (post.image !== previousImage) await destroyPostImage(post.image);
    throw error;
  }

  // Only once the row no longer points at it — otherwise a failed save would
  // leave a post referencing an image that had already been deleted.
  if (previousImage !== post.image) await destroyPostImage(previousImage);

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

  await destroyPostImage(post.image);

  res.json({ success: true, message: 'Post deleted.' });
});
