import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const ACCESS_COOKIE = 'bs_access';
export const REFRESH_COOKIE = 'bs_refresh';

export const signAccessToken = (user) =>
  jwt.sign({ sub: user._id.toString(), type: 'access' }, env.jwtSecret, {
    expiresIn: env.jwtExpiry,
  });

export const signRefreshToken = (user) =>
  jwt.sign(
    { sub: user._id.toString(), type: 'refresh', jti: crypto.randomUUID() },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiry }
  );

export const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);
export const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

// Refresh tokens are stored hashed, exactly like passwords: a leaked database
// dump must not hand an attacker usable long-lived sessions.
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const baseCookie = {
  // httpOnly => XSS cannot read the token out of document.cookie.
  httpOnly: true,
  // sameSite=lax blocks the token from riding along on cross-site form posts,
  // which is what protects these state-changing endpoints from CSRF.
  sameSite: 'lax',
  secure: env.isProd,
  path: '/',
};

const DAY = 24 * 60 * 60 * 1000;

export function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie, maxAge: DAY });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie, maxAge: 30 * DAY });
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, baseCookie);
  res.clearCookie(REFRESH_COOKIE, baseCookie);
}
