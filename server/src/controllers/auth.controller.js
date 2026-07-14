import { asyncHandler } from '../utils/asyncHandler.js';
import * as authService from '../services/auth.service.js';
import { publicUser } from '../services/auth.service.js';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '../utils/tokens.js';

/**
 * Cookies are an HTTP concern, so they are set HERE and not in the service. The
 * service mints tokens and knows nothing about how they are transported — which
 * is what would let a native mobile client take the same tokens in a JSON body
 * without any of this logic being duplicated or rewritten.
 */

export const register = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.register(req.body);

  setAuthCookies(res, tokens);
  res.status(201).json({ success: true, data: { user } });
});

export const login = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.login(req.body);

  setAuthCookies(res, tokens);
  res.json({ success: true, data: { user } });
});

export const refresh = asyncHandler(async (req, res) => {
  try {
    const { user, tokens } = await authService.refresh(req.cookies?.[REFRESH_COOKIE]);

    setAuthCookies(res, tokens);
    res.json({ success: true, data: { user } });
  } catch (error) {
    // A refresh that fails for any reason other than "you never had a session"
    // leaves the browser holding a cookie that will keep failing. Clear it, so the
    // client bounces to the login screen once instead of retrying forever.
    if (error.clearCookies) clearAuthCookies(res);
    throw error;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);

  clearAuthCookies(res);
  res.json({ success: true, message: 'Signed out.' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user) } });
});
