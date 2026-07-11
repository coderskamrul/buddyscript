import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postApi } from '../api/endpoints';
import { queryKeys } from './queryKeys';

/**
 * The feed, paginated by cursor. `getNextPageParam` reads the cursor the server
 * handed back rather than counting pages, which is what keeps scrolling stable:
 * posts created while you scroll cannot shift items across a page boundary and
 * make you see the same post twice.
 */
export function useFeed(scope = 'all') {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(scope),
    queryFn: ({ pageParam }) => postApi.feed({ cursor: pageParam, limit: 10, scope }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useCreatePost(scope = 'all') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postApi.create,
    onSuccess: ({ post }) => {
      // Splice the new post straight onto the top of page 1 instead of
      // refetching the whole feed — the user should see their post appear
      // instantly, and a refetch would cost a round trip to learn what we
      // already know.
      queryClient.setQueryData(queryKeys.feed(scope), (cached) => {
        if (!cached) return cached;
        const [firstPage, ...rest] = cached.pages;
        return {
          ...cached,
          pages: [{ ...firstPage, posts: [post, ...firstPage.posts] }, ...rest],
        };
      });

      // A private post belongs in "mine" but not in "all", and vice versa —
      // rather than reason about which cache to patch, drop the other view.
      queryClient.invalidateQueries({
        queryKey: ['feed'],
        predicate: (query) => query.queryKey[1] !== scope,
      });
    },
  });
}

export function useDeletePost(scope = 'all') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postApi.remove,
    onSuccess: (_data, postId) => {
      queryClient.setQueriesData({ queryKey: ['feed'] }, (cached) => {
        if (!cached) return cached;
        return {
          ...cached,
          pages: cached.pages.map((page) => ({
            ...page,
            posts: page.posts.filter((post) => post.id !== postId),
          })),
        };
      });
      queryClient.removeQueries({ queryKey: queryKeys.comments(postId) });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }) => postApi.update(id, payload),
    onSuccess: ({ post }) => {
      queryClient.setQueriesData({ queryKey: ['feed'] }, (cached) => {
        if (!cached) return cached;
        return {
          ...cached,
          pages: cached.pages.map((page) => ({
            ...page,
            posts: page.posts.map((item) => (item.id === post.id ? post : item)),
          })),
        };
      });
    },
  });
}
