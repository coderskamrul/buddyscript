import { memo, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToggleLike } from '../../hooks/useLike';
import { useDeletePost, useUpdatePost } from '../../hooks/useFeed';
import { useToast } from '../ui/Toast';
import { avatarFor, cn, compactCount, timeAgo } from '../../utils/format';
import { cloudinarySrcSet } from '../../utils/cloudinary';
import CommentThread from './CommentThread';
import LikersModal from './LikersModal';
import VisibilitySelect from './VisibilitySelect';
import {
  CommentIcon,
  DeleteIcon,
  EditIcon,
  LockIcon,
  MoreIcon,
  ShareIcon,
  ThumbsUpIcon,
} from './ReactionIcons';

function PostCard({ post, scope }) {
  const { user } = useAuth();
  const toast = useToast();

  const toggleLike = useToggleLike();
  const deletePost = useDeletePost(scope);
  const updatePost = useUpdatePost();

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [draftVisibility, setDraftVisibility] = useState(post.visibility);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const menuRef = useRef(null);
  const commentInputRef = useRef(null);

  // The design's dropdown was Bootstrap-driven; without its JS we own the
  // outside-click dismissal ourselves.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const like = () => {
    // `likedByMe` tells the mutation what to roll back to; `me` lets it slot the
    // viewer's own face into the stacked avatars without waiting for a refetch.
    toggleLike.mutate(
      {
        targetType: 'post',
        targetId: post.id,
        likedByMe: post.likedByMe,
        me: user ? { id: user.id, fullName: user.fullName, avatar: user.avatar } : null,
      },
      { onError: (error) => toast.error(error.message) }
    );
  };

  // "Alice, Bob and 3 others" — the same information the modal shows, available
  // on hover without opening it.
  const likersLabel = (() => {
    const names = (post.likePreview ?? []).map((liker) =>
      String(liker.id) === String(user?.id) ? 'You' : liker.fullName
    );
    if (!names.length) return `${post.likeCount} likes`;

    const others = post.likeCount - names.length;
    const shown = names.slice(0, 3).join(', ');
    if (others > 0) return `${shown} and ${others} other${others === 1 ? '' : 's'}`;
    return shown;
  })();

  const openComments = () => {
    setCommentsOpen(true);
    // Let the thread mount before reaching for its input.
    requestAnimationFrame(() => commentInputRef.current?.focus());
  };

  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !post.image) {
      toast.error('A post needs either text or an image.');
      return;
    }

    try {
      await updatePost.mutateAsync({
        id: post.id,
        content: trimmed,
        visibility: draftVisibility,
      });
      setEditing(false);
      toast.success('Post updated.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const confirmDelete = async () => {
    try {
      await deletePost.mutateAsync(post.id);
      toast.success('Post deleted.');
    } catch (error) {
      toast.error(error.message);
      setConfirmingDelete(false);
    }
  };

  const isPrivate = post.visibility === 'private';

  return (
    <div className="_feed_inner_timeline_post_area _b_radious6 _padd_b24 _padd_t24 _mar_b16">
      <div className="_feed_inner_timeline_content _padd_r24 _padd_l24">
        <div className="_feed_inner_timeline_post_top">
          <div className="_feed_inner_timeline_post_box">
            <div className="_feed_inner_timeline_post_box_image">
              <img src={avatarFor(post.author)} alt="" className="_post_img" />
            </div>
            <div className="_feed_inner_timeline_post_box_txt">
              <h4 className="_feed_inner_timeline_post_box_title">{post.author?.fullName}</h4>
              <p className="_feed_inner_timeline_post_box_para">
                {timeAgo(post.createdAt)} .{' '}
                <span
                  className="bs-ui inline-flex items-center"
                  title={
                    isPrivate ? 'Only you can see this post' : 'Anyone on Buddy Script can see this'
                  }
                >
                  {isPrivate ? <LockIcon /> : null}
                  {isPrivate ? 'Only me' : 'Public'}
                </span>
              </p>
            </div>
          </div>

          {/* The edit/delete menu exists only for the post's own author. The
              server enforces this too — this just avoids offering an action
              that would be rejected. */}
          {post.isMine ? (
            <div className="_feed_inner_timeline_post_box_dropdown" ref={menuRef}>
              <div className="_feed_timeline_post_dropdown">
                <button
                  type="button"
                  className="_feed_timeline_post_dropdown_link"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Post options"
                >
                  <MoreIcon />
                </button>
              </div>

              {menuOpen ? (
                <div
                  className="_feed_timeline_dropdown _timeline_dropdown"
                  style={{ display: 'block' }}
                  role="menu"
                >
                  <ul className="_feed_timeline_dropdown_list">
                    <li className="_feed_timeline_dropdown_item">
                      <button
                        type="button"
                        role="menuitem"
                        className="_feed_timeline_dropdown_link"
                        style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }}
                        onClick={() => {
                          setDraft(post.content);
                          setDraftVisibility(post.visibility);
                          setEditing(true);
                          setMenuOpen(false);
                        }}
                      >
                        <span>
                          <EditIcon />
                        </span>
                        Edit Post
                      </button>
                    </li>
                    <li className="_feed_timeline_dropdown_item">
                      <button
                        type="button"
                        role="menuitem"
                        className="_feed_timeline_dropdown_link"
                        style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }}
                        onClick={() => {
                          setConfirmingDelete(true);
                          setMenuOpen(false);
                        }}
                      >
                        <span>
                          <DeleteIcon />
                        </span>
                        Delete Post
                      </button>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing ? (
          <div className="bs-ui mt-3">
            <textarea
              className="form-control _textarea"
              value={draft}
              maxLength={5000}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Edit post text"
              rows={3}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <VisibilitySelect
                value={draftVisibility}
                onChange={setDraftVisibility}
                disabled={updatePost.isPending}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:bg-black/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={updatePost.isPending}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
                >
                  {updatePost.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {post.content ? (
              // React escapes this by default — user text can never become markup.
              <h4 className="_feed_inner_timeline_post_title" style={{ whiteSpace: 'pre-wrap' }}>
                {post.content}
              </h4>
            ) : null}

            {post.image ? (
              <div className="_feed_inner_timeline_image">
                <img
                  // `src` is the URL the server built, and is what a legacy post
                  // or an unconfigured cloud name falls back to. When we do have
                  // the Cloudinary id, `srcSet` + `sizes` let the browser fetch
                  // the one width it will actually paint — a phone takes the
                  // 400px file, a retina desktop the 1200px one.
                  src={post.image}
                  srcSet={cloudinarySrcSet(post.imageId)}
                  sizes="(max-width: 767px) 100vw, 636px"
                  alt=""
                  className="_time_img"
                  // Feed images below the fold are the single biggest payload on
                  // the page; deferring them is the cheapest real win here.
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="_feed_inner_timeline_total_reacts _padd_r24 _padd_l24 _mar_b26">
        {post.likeCount > 0 ? (
          // The design's stacked liker faces: the first uses `_react_img1`, the
          // rest `_react_img` (each pulled left to overlap), and the round
          // `_..._total_reacts_para` badge carries the count. Faces 3-5 are
          // hidden on mobile by `_rect_img_mbl_none`, exactly as authored.
          <button
            type="button"
            onClick={() => setLikersOpen(true)}
            className="_feed_inner_timeline_total_reacts_image bs-ui border-0 bg-transparent p-0"
            aria-label={`See who liked this post (${post.likeCount})`}
            title={likersLabel}
          >
            {(post.likePreview ?? []).map((liker, index) => (
              <img
                key={liker.id}
                src={avatarFor(liker, index)}
                alt=""
                loading="lazy"
                className={cn(
                  index === 0 ? '_react_img1' : '_react_img',
                  index >= 2 && '_rect_img_mbl_none'
                )}
              />
            ))}
            <p className="_feed_inner_timeline_total_reacts_para">
              {compactCount(post.likeCount)}
            </p>
          </button>
        ) : (
          <p className="bs-ui m-0 text-sm text-muted">Be the first to like this</p>
        )}

        <div className="_feed_inner_timeline_total_reacts_txt">
          <p className="_feed_inner_timeline_total_reacts_para1">
            <button
              type="button"
              onClick={() => setCommentsOpen((open) => !open)}
              className="bs-ui border-0 bg-transparent p-0 text-inherit"
              aria-expanded={commentsOpen}
            >
              <span>{compactCount(post.commentCount)}</span> Comment
              {post.commentCount === 1 ? '' : 's'}
            </button>
          </p>
        </div>
      </div>

      <div className="_feed_inner_timeline_reaction">
        <button
          type="button"
          onClick={like}
          aria-pressed={post.likedByMe}
          className={cn(
            '_feed_inner_timeline_reaction_emoji _feed_reaction',
            post.likedByMe && '_feed_reaction_active'
          )}
        >
          <span className="_feed_inner_timeline_reaction_link">
            <span style={{ color: post.likedByMe ? '#377DFF' : undefined }}>
              <ThumbsUpIcon filled={post.likedByMe} size={19} />
              {post.likedByMe ? 'Liked' : 'Like'}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={openComments}
          className="_feed_inner_timeline_reaction_comment _feed_reaction"
        >
          <span className="_feed_inner_timeline_reaction_link">
            <span>
              <CommentIcon />
              Comment
            </span>
          </span>
        </button>

        <button
          type="button"
          className="_feed_inner_timeline_reaction_share _feed_reaction"
          onClick={() => toast.success('Sharing is outside the scope of this build.')}
        >
          <span className="_feed_inner_timeline_reaction_link">
            <span>
              <ShareIcon />
              Share
            </span>
          </span>
        </button>
      </div>

      {/* Comments mount only when opened, so a 10-post feed page issues one
          request rather than eleven. */}
      {commentsOpen ? (
        <CommentThread post={post} inputRef={commentInputRef} currentUser={user} />
      ) : null}

      <LikersModal
        open={likersOpen}
        onClose={() => setLikersOpen(false)}
        targetType="post"
        targetId={post.id}
        title={`Liked by ${compactCount(post.likeCount)}`}
      />

      {confirmingDelete ? (
        <div
          className="bs-ui fixed inset-0 z-[1080] flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmingDelete(false);
          }}
        >
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`delete-title-${post.id}`}
            className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-card dark:bg-[#242526]"
          >
            <h2
              id={`delete-title-${post.id}`}
              className="m-0 text-base font-semibold text-ink dark:text-white"
            >
              Delete this post?
            </h2>
            <p className="mt-2 text-sm text-muted">
              This also removes its comments and likes. It cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletePost.isPending}
                className="rounded-lg bg-[#d93025] px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
              >
                {deletePost.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The feed re-renders on every like anywhere in it; without memo, liking post #1
// would re-render all 50 cards on screen.
export default memo(PostCard);
