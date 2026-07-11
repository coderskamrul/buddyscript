import { useComments, useCreateComment, useDeleteComment } from '../../hooks/useComments';
import { useToast } from '../ui/Toast';
import CommentComposer from './CommentComposer';
import CommentItem from './CommentItem';

export default function CommentThread({ post, inputRef, currentUser }) {
  const toast = useToast();

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useComments(post.id, { enabled: true });

  const createComment = useCreateComment(post.id);
  const deleteComment = useDeleteComment(post.id);

  const comments = data?.pages.flatMap((page) => page.comments) ?? [];

  const addComment = async ({ content, parentId = null }) => {
    try {
      await createComment.mutateAsync({ content, parentId });
    } catch (err) {
      toast.error(err.message);
      // Rethrown so the composer knows to put the user's text back.
      throw err;
    }
  };

  const removeComment = async (comment) => {
    try {
      await deleteComment.mutateAsync({
        commentId: comment.id,
        parentId: comment.parentId ?? null,
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="_feed_inner_timeline_cooment_area">
        <CommentComposer
          ref={inputRef}
          currentUser={currentUser}
          pending={createComment.isPending}
          onSubmit={(content) => addComment({ content })}
        />
      </div>

      <div className="_timline_comment_main">
        {isLoading ? (
          <div className="bs-ui flex items-center gap-3 px-6 py-3">
            <span className="bs-skeleton h-10 w-10 rounded-full" />
            <span className="bs-skeleton h-12 flex-1 rounded-lg" />
          </div>
        ) : null}

        {isError ? (
          <p className="bs-ui px-6 py-3 text-sm text-[#d93025]">
            {error?.message || 'Could not load comments.'}
          </p>
        ) : null}

        {!isLoading && comments.length === 0 ? (
          <p className="bs-ui px-6 py-2 text-sm text-muted">
            No comments yet — start the conversation.
          </p>
        ) : null}

        {/* The design labels this "View 4 previous comments"; it now actually
            pages through them, newest-first. */}
        {hasNextPage ? (
          <div className="_previous_comment">
            <button
              type="button"
              className="_previous_comment_txt"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'View previous comments'}
            </button>
          </div>
        ) : null}

        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            currentUser={currentUser}
            onReply={addComment}
            onDelete={removeComment}
            deleting={deleteComment.isPending}
          />
        ))}
      </div>
    </>
  );
}
