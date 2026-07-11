import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { commentApi } from '../api/endpoints';
import { queryKeys } from './queryKeys';

/**
 * Top-level comments for a post. `enabled` is false until the user opens the
 * thread — a feed page of 10 posts should cost 1 request, not 11.
 */
export function useComments(postId, { enabled }) {
  return useInfiniteQuery({
    queryKey: queryKeys.comments(postId),
    queryFn: ({ pageParam }) => commentApi.list(postId, { cursor: pageParam, limit: 5 }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(enabled && postId),
    staleTime: 20_000,
  });
}

/** Replies to one comment — likewise only fetched when expanded. */
export function useReplies(commentId, { enabled }) {
  return useInfiniteQuery({
    queryKey: queryKeys.replies(commentId),
    queryFn: ({ pageParam }) => commentApi.replies(commentId, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(enabled && commentId),
    staleTime: 20_000,
  });
}

const bumpPostCommentCount = (queryClient, postId, delta) => {
  queryClient.setQueriesData({ queryKey: ['feed'] }, (cached) =>
    cached
      ? {
          ...cached,
          pages: cached.pages.map((page) => ({
            ...page,
            posts: page.posts.map((post) =>
              post.id === postId
                ? { ...post, commentCount: Math.max(0, post.commentCount + delta) }
                : post
            ),
          })),
        }
      : cached
  );
};

export function useCreateComment(postId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ content, parentId }) => commentApi.create(postId, { content, parentId }),

    onSuccess: ({ comment }) => {
      if (comment.parentId) {
        // A reply: append to the parent's reply list (oldest-first, so it goes
        // at the end) and bump the parent's replyCount.
        queryClient.setQueryData(queryKeys.replies(comment.parentId), (cached) => {
          if (!cached) return cached;
          const pages = [...cached.pages];
          const last = pages[pages.length - 1];
          pages[pages.length - 1] = { ...last, replies: [...last.replies, comment] };
          return { ...cached, pages };
        });

        queryClient.setQueryData(queryKeys.comments(postId), (cached) =>
          cached
            ? {
                ...cached,
                pages: cached.pages.map((page) => ({
                  ...page,
                  comments: page.comments.map((item) =>
                    item.id === comment.parentId
                      ? { ...item, replyCount: item.replyCount + 1 }
                      : item
                  ),
                })),
              }
            : cached
        );
      } else {
        // A top-level comment: newest-first, so it goes on the front of page 1.
        queryClient.setQueryData(queryKeys.comments(postId), (cached) => {
          if (!cached) {
            return {
              pages: [{ comments: [comment], nextCursor: null, hasMore: false }],
              pageParams: [undefined],
            };
          }
          const [firstPage, ...rest] = cached.pages;
          return {
            ...cached,
            pages: [{ ...firstPage, comments: [comment, ...firstPage.comments] }, ...rest],
          };
        });
      }

      bumpPostCommentCount(queryClient, postId, 1);
    },
  });
}

export function useDeleteComment(postId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId }) => commentApi.remove(commentId),

    onSuccess: (response, { commentId, parentId }) => {
      // The server reports how many rows actually went away (a top-level comment
      // takes its replies with it), so the post's counter stays truthful.
      const removed = response?.data?.removedCount ?? 1;

      if (parentId) {
        queryClient.setQueryData(queryKeys.replies(parentId), (cached) =>
          cached
            ? {
                ...cached,
                pages: cached.pages.map((page) => ({
                  ...page,
                  replies: page.replies.filter((reply) => reply.id !== commentId),
                })),
              }
            : cached
        );

        queryClient.setQueryData(queryKeys.comments(postId), (cached) =>
          cached
            ? {
                ...cached,
                pages: cached.pages.map((page) => ({
                  ...page,
                  comments: page.comments.map((item) =>
                    item.id === parentId
                      ? { ...item, replyCount: Math.max(0, item.replyCount - 1) }
                      : item
                  ),
                })),
              }
            : cached
        );
      } else {
        queryClient.setQueryData(queryKeys.comments(postId), (cached) =>
          cached
            ? {
                ...cached,
                pages: cached.pages.map((page) => ({
                  ...page,
                  comments: page.comments.filter((item) => item.id !== commentId),
                })),
              }
            : cached
        );
        queryClient.removeQueries({ queryKey: queryKeys.replies(commentId) });
      }

      bumpPostCommentCount(queryClient, postId, -removed);
    },
  });
}
