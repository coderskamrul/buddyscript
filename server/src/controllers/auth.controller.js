import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  hashToken,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';

const MAX_SESSIONS = 5;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// A real bcrypt hash of a throwaway string. When the email doesn't exist we
// still run one full bcrypt comparison against this, so the "unknown email" and
// "wrong password" paths cost the same wall-clock time. Returning early instead
// would let an attacker enumerate registered emails by timing the response.
const DUMMY_HASH = '$2a$12$I5zGber61HHE5YmfuR.SHOakCZpXkBB1wUlWFcgTLGYOvWz4MlZcG';

const publicUser = (user) => ({
  id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: `${user.firstName} ${user.lastName}`,
  email: user.email,
  avatar: user.avatar,
  createdAt: user.createdAt,
});

async function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  // Keep only the most recent sessions so the array can't grow without bound,
  // and drop any that have already expired.
  const now = Date.now();
  const sessions = (user.sessions || [])
    .filter((session) => session.expiresAt.getTime() > now)
    .slice(-(MAX_SESSIONS - 1));

  sessions.push({
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(now + REFRESH_TTL_MS),
  });

  await User.updateOne({ _id: user._id }, { $set: { sessions } });
  setAuthCookies(res, { accessToken, refreshToken });
}

export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  const existing = await User.exists({ email });
  if (existing) throw ApiError.conflict('An account with that email already exists.');

  // The password is hashed by the model's pre-save hook, never here.
  const user = await User.create({ firstName, lastName, email, password });

  await issueSession(res, user);
  res.status(201).json({ success: true, data: { user: publicUser(user) } });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password +sessions');

  const passwordMatches = user
    ? await user.comparePassword(password)
    : await bcrypt.compare(password, DUMMY_HASH);

  // One message for both failure modes, so the response body doesn't reveal
  // whether the email is registered.
  if (!user || !passwordMatches) {
    throw ApiError.unauthorized('Email or password is incorrect.');
  }

  await issueSession(res, user);
  res.json({ success: true, data: { user: publicUser(user) } });
});

/**
 * Rotating refresh: the presented token is invalidated the moment it is used and
 * a fresh one is issued. Replaying a stolen refresh token therefore fails, and
 * a token that is not in the user's session list is rejected outright — which is
 * what makes logout actually revoke access rather than just clearing a cookie.
 */
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No active session.');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    clearAuthCookies(res);
    throw ApiError.unauthorized('Session expired. Please sign in again.');
  }

  const user = await User.findById(payload.sub).select('+sessions');
  if (!user) {
    clearAuthCookies(res);
    throw ApiError.unauthorized('Account no longer exists.');
  }

  const presented = hashToken(token);
  const known = user.sessions.some(
    (session) => session.tokenHash === presented && session.expiresAt.getTime() > Date.now()
  );

  if (!known) {
    clearAuthCookies(res);
    throw ApiError.unauthorized('Session is no longer valid. Please sign in again.');
  }

  user.sessions = user.sessions.filter((session) => session.tokenHash !== presented);
  await issueSession(res, user);

  res.json({ success: true, data: { user: publicUser(user) } });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];

  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await User.updateOne(
        { _id: payload.sub },
        { $pull: { sessions: { tokenHash: hashToken(token) } } }
      );
    } catch {
      // An unparseable token is already useless; clearing the cookies is enough.
    }
  }

  clearAuthCookies(res);
  res.json({ success: true, message: 'Signed out.' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user) } });
});
