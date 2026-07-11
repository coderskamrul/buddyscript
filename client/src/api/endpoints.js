import { api } from './client';

const unwrap = (response) => response.data.data;

export const authApi = {
  register: (payload) => api.post('/auth/register', payload).then(unwrap),
  login: (payload) => api.post('/auth/login', payload).then(unwrap),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  me: () => api.get('/auth/me').then(unwrap),
};

export const postApi = {
  feed: ({ cursor, limit = 10, scope = 'all' } = {}) =>
    api.get('/posts', { params: { cursor, limit, scope } }).then(unwrap),

  // Multipart, because the post may carry an image. Axios sets the boundary
  // header itself — setting Content-Type by hand here would omit it and break
  // the upload.
  create: ({ content, visibility, image }) => {
    const form = new FormData();
    form.append('content', content ?? '');
    form.append('visibility', visibility);
    if (image) form.append('image', image);
    return api.post('/posts', form).then(unwrap);
  },

  update: (id, { content, visibility, image, removeImage }) => {
    const form = new FormData();
    if (content !== undefined) form.append('content', content);
    if (visibility !== undefined) form.append('visibility', visibility);
    if (removeImage) form.append('removeImage', 'true');
    if (image) form.append('image', image);
    return api.patch(`/posts/${id}`, form).then(unwrap);
  },

  remove: (id) => api.delete(`/posts/${id}`).then((r) => r.data),
};

export const commentApi = {
  list: (postId, { cursor, limit = 5 } = {}) =>
    api.get(`/posts/${postId}/comments`, { params: { cursor, limit } }).then(unwrap),

  replies: (commentId, { cursor, limit = 20 } = {}) =>
    api.get(`/comments/${commentId}/replies`, { params: { cursor, limit } }).then(unwrap),

  create: (postId, { content, parentId }) =>
    api.post(`/posts/${postId}/comments`, { content, parentId: parentId ?? null }).then(unwrap),

  remove: (commentId) => api.delete(`/comments/${commentId}`).then((r) => r.data),
};

export const likeApi = {
  toggle: ({ targetType, targetId }) =>
    api.post('/likes/toggle', { targetType, targetId }).then(unwrap),

  listLikers: ({ targetType, targetId, cursor, limit = 20 }) =>
    api.get('/likes', { params: { targetType, targetId, cursor, limit } }).then(unwrap),
};
