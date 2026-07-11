import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { likeApi } from '../api/endpoints';
import { queryKeys } from './queryKeys';

const PREVIEW_LIMIT = 5;

/**
 * Keeps the stacked liker faces in step with the button. Liking puts you at the
 * front (newest-first, same order the server returns); unliking takes you out.
 * Without this the avatars would only correct themselves on the next refetch.
 */
const patchPreview = (preview = [], liked, me) => {
  if (!me) return preview;
  const without = preview.filter((user) => String(user.id) !== String(me.id));
  return liked ? [me, ...without].slice(0, PREVIEW_LIMIT) : without;
};

/** Applies a like/unlike to whichever cached item holds this target. */
const patchItem = (item, targetId, liked, me) => {
  if (item.id !== targetId || item.likedByMe === liked) return item;
  return {
    ...item,
    likedByMe: liked,
    // Never let a rollback or a duplicate event drive the count negative.
    likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)),
    ...(item.likePreview ? { likePreview: patchPreview(item.likePreview, liked, me) } : {}),
  };
};

/**
 * The same post can be cached in several places at once (the "all" feed and the
 * "mine" feed), and a comment lives in either a comments list or a replies list.
 * Rather than track which, we patch every infinite-query cache that could hold
 * it — so a like registers everywhere the item is on screen, not just where it
 * was clicked.
 */
function patchCaches(queryClient, { targetType, targetId, liked, me }) {
  if (targetType === 'post') {
    queryClient.setQueriesData({ queryKey: ['feed'] }, (cached) =>
      cached
        ? {
            ...cached,
            pages: cached.pages.map((page) => ({
              ...page,
              posts: page.posts.map((post) => patchItem(post, targetId, liked, me)),
            })),
          }
        : cached
    );
    return;
  }

  for (const key of ['comments', 'replies']) {
    queryClient.setQueriesData({ queryKey: [key] }, (cached) =>
      cached
        ? {
            ...cached,
            pages: cached.pages.map((page) => ({
              ...page,
              [key]: page[key].map((item) => patchItem(item, targetId, liked, me)),
            })),
          }
        : cached
    );
  }
}

/**
 * Optimistic like/unlike: the heart fills the instant you click it. A like that
 * waits on a round trip feels broken, and this is the single most-tapped control
 * in the product.
 */
export function useToggleLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: likeApi.toggle,

    onMutate: async ({ targetType, targetId, likedByMe, me }) => {
      // Stop any in-flight refetch from landing after our optimistic write and
      // stomping it with stale server data.
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      await queryClient.cancelQueries({ queryKey: ['comments'] });
      await queryClient.cancelQueries({ queryKey: ['replies'] });

      patchCaches(queryClient, { targetType, targetId, liked: !likedByMe, me });

      // Handed to onError as the rollback instruction.
      return { targetType, targetId, previousLiked: likedByMe, me };
    },

    onError: (_error, _variables, context) => {
      if (!context) return;
      patchCaches(queryClient, {
        targetType: context.targetType,
        targetId: context.targetId,
        liked: context.previousLiked,
        me: context.me,
      });
    },

    onSuccess: ({ targetType, targetId, liked, likeCount }) => {
      // Reconcile with the server's authoritative count: other people have been
      // liking this too, and our optimistic ±1 only accounted for us.
      const applyExact = (item) =>
        item.id === targetId ? { ...item, likedByMe: liked, likeCount } : item;

      if (targetType === 'post') {
        queryClient.setQueriesData({ queryKey: ['feed'] }, (cached) =>
          cached
            ? {
                ...cached,
                pages: cached.pages.map((page) => ({
                  ...page,
                  posts: page.posts.map(applyExact),
                })),
              }
            : cached
        );
      } else {
        for (const key of ['comments', 'replies']) {
          queryClient.setQueriesData({ queryKey: [key] }, (cached) =>
            cached
              ? {
                  ...cached,
                  pages: cached.pages.map((page) => ({
                    ...page,
                    [key]: page[key].map(applyExact),
                  })),
                }
              : cached
          );
        }
      }

      // The "who liked this" list is now out of date.
      queryClient.invalidateQueries({ queryKey: queryKeys.likers(targetType, targetId) });
    },
  });
}

/** The paginated "who liked this" list behind the likers modal. */
export function useLikers({ targetType, targetId, enabled }) {
  return useInfiniteQuery({
    queryKey: queryKeys.likers(targetType, targetId),
    queryFn: ({ pageParam }) =>
      likeApi.listLikers({ targetType, targetId, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Only fetched when the modal actually opens — a feed of 10 posts must not
    // prefetch 10 liker lists nobody asked for.
    enabled: Boolean(enabled && targetId),
    staleTime: 15_000,
  });
}
