import { memo, useState } from 'react';
import { useReplies } from '../../hooks/useComments';
import { useToggleLike } from '../../hooks/useLike';
import { useToast } from '../ui/Toast';
import { avatarFor, cn, compactCount, timeAgo } from '../../utils/format';
import CommentComposer from './CommentComposer';
import LikersModal from './LikersModal';
import { HeartIcon, ThumbsUpIcon } from './ReactionIcons';

/**
 * One comment, or one reply. The two are the same shape and the same component —
 * a reply is just a comment with a parent — so like/delete/likers behave
 * identically at both levels without a second code path.
 */
function CommentItem({ comment, currentUser, onReply, onDelete, isReply = false, deleting }) {
  const toast = useToast();
  const toggleLike = useToggleLike();

  const [replying, setReplying] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);

  const replies = useReplies(comment.id, { enabled: repliesOpen && !isReply });
  const replyItems = replies.data?.pages.flatMap((page) => page.replies) ?? [];

  const like = () =>
    toggleLike.mutate(
      { targetType: 'comment', targetId: comment.id, likedByMe: comment.likedByMe },
      { onError: (error) => toast.error(error.message) }
    );

  const submitReply = async (content) => {
    // A reply always attaches to the top-level comment. When replying to a reply
    // we hand back that reply's parent, keeping the thread one level deep.
    await onReply({ content, parentId: isReply ? comment.parentId : comment.id });
    setReplying(false);
    setRepliesOpen(true);
  };

  return (
    <div className="_comment_main">
      <div className="_comment_image">
        <span className="_comment_image_link">
          <img src={avatarFor(comment.author)} alt="" className="_comment_img1" loading="lazy" />
        </span>
      </div>

      <div className="_comment_area">
        <div className="_comment_details">
          <div className="_comment_details_top">
            <div className="_comment_name">
              <h4 className="_comment_name_title">{comment.author?.fullName}</h4>
            </div>
          </div>

          <div className="_comment_status">
            <p className="_comment_status_text">
              {/* Escaped by React — a comment cannot inject markup. */}
              <span style={{ whiteSpace: 'pre-wrap' }}>{comment.content}</span>
            </p>
          </div>

          {comment.likeCount > 0 ? (
            <button
              type="button"
              onClick={() => setLikersOpen(true)}
              className="_total_reactions bs-ui border-0 bg-transparent p-0"
              aria-label={`See who liked this comment (${comment.likeCount})`}
            >
              <div className="_total_react">
                <span className="_reaction_like">
                  <ThumbsUpIcon />
                </span>
                <span className="_reaction_heart">
                  <HeartIcon />
                </span>
              </div>
              <span className="_total">{compactCount(comment.likeCount)}</span>
            </button>
          ) : null}

          <div className="_comment_reply">
            <div className="_comment_reply_num">
              <ul className="_comment_reply_list">
                <li>
                  <button
                    type="button"
                    onClick={like}
                    aria-pressed={comment.likedByMe}
                    className="bs-ui border-0 bg-transparent p-0"
                    style={{
                      color: comment.likedByMe ? '#377DFF' : 'inherit',
                      fontWeight: comment.likedByMe ? 600 : 'inherit',
                    }}
                  >
                    <span>{comment.likedByMe ? 'Liked.' : 'Like.'}</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setReplying((open) => !open)}
                    className="bs-ui border-0 bg-transparent p-0"
                    aria-expanded={replying}
                  >
                    <span>Reply.</span>
                  </button>
                </li>
                {comment.canDelete ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => onDelete(comment)}
                      disabled={deleting}
                      className="bs-ui border-0 bg-transparent p-0"
                    >
                      <span>Delete</span>
                    </button>
                  </li>
                ) : null}
                <li>
                  <span className="_time_link">.{timeAgo(comment.createdAt)}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Replies are only fetched once someone asks for them. */}
        {!isReply && comment.replyCount > 0 ? (
          <button
            type="button"
            onClick={() => setRepliesOpen((open) => !open)}
            className="bs-ui mb-2 ml-1 border-0 bg-transparent p-0 text-xs font-semibold text-brand"
            aria-expanded={repliesOpen}
          >
            {repliesOpen
              ? 'Hide replies'
              : `View ${compactCount(comment.replyCount)} ${
                  comment.replyCount === 1 ? 'reply' : 'replies'
                }`}
          </button>
        ) : null}

        {repliesOpen && !isReply ? (
          <div className={cn('bs-ui', 'border-l border-black/5 pl-3')}>
            {replies.isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <span className="bs-skeleton h-8 w-8 rounded-full" />
                <span className="bs-skeleton h-4 w-40 rounded" />
              </div>
            ) : null}

            {replyItems.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                currentUser={currentUser}
                onReply={onReply}
                onDelete={onDelete}
                isReply
              />
            ))}

            {replies.hasNextPage ? (
              <button
                type="button"
                onClick={() => replies.fetchNextPage()}
                disabled={replies.isFetchingNextPage}
                className="mb-2 border-0 bg-transparent p-0 text-xs font-semibold text-brand"
              >
                {replies.isFetchingNextPage ? 'Loading…' : 'Show more replies'}
              </button>
            ) : null}
          </div>
        ) : null}

        {replying ? (
          <CommentComposer
            currentUser={currentUser}
            onSubmit={submitReply}
            autoFocus
            placeholder={`Reply to ${comment.author?.firstName ?? 'this comment'}`}
            onCancel={() => setReplying(false)}
          />
        ) : null}
      </div>

      <LikersModal
        open={likersOpen}
        onClose={() => setLikersOpen(false)}
        targetType="comment"
        targetId={comment.id}
        title={`Liked by ${compactCount(comment.likeCount)}`}
      />
    </div>
  );
}

export default memo(CommentItem);
