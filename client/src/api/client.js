import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  // Sends the httpOnly auth cookies. The access token is never held in JS, so
  // an XSS payload has nothing to steal — this is why we don't use localStorage.
  withCredentials: true,
  timeout: 20000,
});

/** Normalizes every backend failure into a predictable shape for the UI. */
export class ApiError extends Error {
  constructor(message, { status, fieldErrors } = {}) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors || null;
  }
}

const toApiError = (error) => {
  if (axios.isCancel(error)) return new ApiError('Request cancelled.', { status: 0 });

  const { response } = error;
  if (!response) {
    return new ApiError('Cannot reach the server. Check your connection.', { status: 0 });
  }

  return new ApiError(response.data?.message || 'Something went wrong.', {
    status: response.status,
    fieldErrors: response.data?.errors || null,
  });
};

// --- Silent refresh -------------------------------------------------------
// When the access token expires mid-session we refresh once and replay the
// failed request, so the user never sees a spurious logout. Concurrent 401s
// must not each fire their own refresh (that would rotate the refresh token N
// times and invalidate itself), so the first one takes a lock and the rest wait
// on the same promise.

let refreshPromise = null;
let onAuthFailure = () => {};

export const setAuthFailureHandler = (handler) => {
  onAuthFailure = handler;
};

const refreshSession = () => {
  refreshPromise ??= api
    .post('/auth/refresh')
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    const isAuthRoute = original?.url?.includes('/auth/');
    const canRetry = status === 401 && original && !original._retried && !isAuthRoute;

    if (canRetry) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        // The refresh token is gone or revoked — the session is genuinely over.
        onAuthFailure();
      }
    }

    return Promise.reject(toApiError(error));
  }
);
