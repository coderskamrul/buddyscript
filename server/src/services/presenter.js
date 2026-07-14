import { isLegacyPath, postImageUrl } from './postImage.service.js';

/**
 * WIRE SHAPES — and the split that the entire caching strategy depends on.
 *
 * Every entity here is presented in TWO parts:
 *
 *   SHARED    — what the post says, who wrote it, how many likes it has. Identical
 *               for every viewer on Earth, therefore CACHEABLE ONCE and read by
 *               all of them.
 *   VIEWER    — `likedByMe`, `isMine`, `canDelete`. Different for every viewer,
 *               therefore NEVER cached.
 *
 * Conflating them is the classic mistake, and it is fatal at scale: cache the
 * whole rendered post including `likedByMe` and the cache key has to include the
 * viewer, so a post on a million feeds needs a million cache entries — a cache
 * with a ~0% hit rate that also happens to be enormous. Split them, and one
 * cached `post:{id}` serves all million, while the per-viewer bits are computed
 * live in a single batched, index-covered query per page (likeRepo.likedTargetIds).
 *
 * So: `sharedPost()` output goes in Redis. `withViewer()` runs on the way out,
 * on every request, and never touches the cache.
 */

export const shapeAuthor = (author) =>
  author
    ? {
        id: author._id,
        firstName: author.firstName,
        lastName: author.lastName,
        fullName: `${author.firstName} ${author.lastName}`,
        avatar: author.avatar,
      }
    : null;

/** Viewer-independent. This is the object that is cached under `post:{id}`. */
export const sharedPost = (post, likePreview = []) => ({
  id: post._id,
  content: post.content,

  // The row holds a bare Cloudinary file name. `image` is that name rendered as
  // a ready-to-use URL, so a client needs no Cloudinary knowledge to show a post;
  // `imageId` is the name itself, so a client that DOES have that knowledge can
  // request a size of its own (the browser builds a srcset from it). Legacy rows
  // still hold a path, and have no id to hand out.
  image: postImageUrl(post.image),
  imageId: isLegacyPath(post.image) ? null : post.image,

  visibility: post.visibility,
  author: shapeAuthor(post.author),
  likeCount: post.likeCount,
  commentCount: post.commentCount,
  // Up to 5 recent likers, for the stacked faces on the reaction row.
  likePreview,
  authorId: String(post.author?._id ?? post.author),
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
});

/**
 * Stamps the viewer-specific fields onto a shared (possibly cached) post.
 * `authorId` is an implementation detail of that stamping and does not go out on
 * the wire — the client sees `isMine`, which is what it actually needs.
 */
export const withViewer = (post, { likedIds, viewerId }) => {
  const { authorId, ...rest } = post;
  return {
    ...rest,
    likedByMe: likedIds.has(String(post.id)),
    isMine: String(authorId) === String(viewerId),
  };
};

export const shapeComment = (comment, { likedIds, viewerId, postAuthorId }) => ({
  id: comment._id,
  postId: comment.post,
  parentId: comment.parent,
  content: comment.content,
  author: shapeAuthor(comment.author),
  likeCount: comment.likeCount,
  replyCount: comment.replyCount,
  likedByMe: likedIds.has(String(comment._id)),
  // The comment's author — or the post's author, acting as moderator on their own
  // post — may delete it.
  canDelete:
    String(comment.author?._id ?? comment.author) === String(viewerId) ||
    String(postAuthorId) === String(viewerId),
  createdAt: comment.createdAt,
});
