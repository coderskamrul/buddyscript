export const queryKeys = {
  feed: (scope = 'all') => ['feed', scope],
  comments: (postId) => ['comments', postId],
  replies: (commentId) => ['replies', commentId],
  likers: (targetType, targetId) => ['likers', targetType, targetId],
};
