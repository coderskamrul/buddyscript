import bcrypt from 'bcryptjs';
import { ApiError } from '../utils/ApiError.js';
import * as userRepo from '../repositories/user.repository.js';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';

const MAX_SESSIONS = 5;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A real bcrypt hash of a throwaway string. When the email does not exist we
 * still run one full bcrypt comparison against this, so the "unknown email" and
 * "wrong password" paths cost the same wall-clock time. Returning early instead
 * would let an attacker enumerate registered emails by timing the response.
 */
const DUMMY_HASH = '$2a$12$I5zGber61HHE5YmfuR.SHOakCZpXkBB1wUlWFcgTLGYOvWz4MlZcG';

export const publicUser = (user) => ({
  id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: `${user.firstName} ${user.lastName}`,
  email: user.email,
  avatar: user.avatar,
  followerCount: user.followerCount ?? 0,
  followingCount: user.followingCount ?? 0,
  createdAt: user.createdAt,
});

/**
 * Mints a token pair and records the refresh token's HASH against the user.
 *
 * ── Why this is still "stateless" ───────────────────────────────────────────
 * The ACCESS token is a self-contained JWT: any API container can verify it with
 * the shared secret, having never seen the user before. That is the property that
 * matters for horizontal scaling — a request can be routed to any instance by the
 * load balancer, no sticky sessions, no shared session store on the read path.
 *
 * The refresh token is deliberately NOT stateless, and that is the point of it. A
 * pure JWT cannot be revoked — "log out everywhere" is impossible, and a stolen
 * token is valid until it expires. Storing the hash makes the refresh path
 * revocable, and it is exercised once a day rather than on every request, so it
 * costs the scalability of the hot path nothing.
 * ────────────────────────────────────────────────────────────────────────────
 */
async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  // Keep only the most recent sessions, so the array cannot grow without bound,
  // and drop any that have already expired.
  const now = Date.now();
  const sessions = (user.sessions || [])
    .filter((session) => session.expiresAt.getTime() > now)
    .slice(-(MAX_SESSIONS - 1));

  sessions.push({
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(now + REFRESH_TTL_MS),
  });

  await userRepo.replaceSessions(user._id, sessions);
  return { accessToken, refreshToken };
}

export async function register({ firstName, lastName, email, password }) {
  const existing = await userRepo.existsByEmail(email);
  if (existing) throw ApiError.conflict('An account with that email already exists.');

  // The password is hashed by the model's pre-save hook, never here.
  const user = await userRepo.create({ firstName, lastName, email, password });
  const tokens = await issueSession(user);

  return { user: publicUser(user), tokens };
}

export async function login({ email, password }) {
  const user = await userRepo.findByEmailWithSecrets(email);

  const passwordMatches = user
    ? await user.comparePassword(password)
    : await bcrypt.compare(password, DUMMY_HASH);

  // ONE message for both failure modes, so the response body does not reveal
  // whether the email is registered.
  if (!user || !passwordMatches) {
    throw ApiError.unauthorized('Email or password is incorrect.');
  }

  const tokens = await issueSession(user);
  return { user: publicUser(user), tokens };
}

/**
 * ROTATING REFRESH: the presented token is invalidated the moment it is used, and
 * a fresh one is issued. Replaying a stolen refresh token therefore fails, and a
 * token that is not in the user's session list is rejected outright — which is
 * what makes logout actually REVOKE access rather than merely clear a cookie.
 */
/**
 * A 401 that also means "the cookie you are holding is dead — stop sending it".
 * The flag is a property on the error rather than part of `details`, because
 * `details` is serialized to the client as `errors` and this is a signal for the
 * controller, not for the user.
 */
const staleSession = (message) => {
  const error = ApiError.unauthorized(message);
  error.clearCookies = true;
  return error;
};

export async function refresh(token) {
  if (!token) throw ApiError.unauthorized('No active session.');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw staleSession('Session expired. Please sign in again.');
  }

  const user = await userRepo.findByIdWithSessions(payload.sub);
  if (!user) {
    throw staleSession('Account no longer exists.');
  }

  const presented = hashToken(token);
  const known = user.sessions.some(
    (session) => session.tokenHash === presented && session.expiresAt.getTime() > Date.now()
  );

  if (!known) {
    throw staleSession('Session is no longer valid. Please sign in again.');
  }

  user.sessions = user.sessions.filter((session) => session.tokenHash !== presented);
  const tokens = await issueSession(user);

  return { user: publicUser(user), tokens };
}

export async function logout(token) {
  if (!token) return;

  try {
    const payload = verifyRefreshToken(token);
    await userRepo.pullSession(payload.sub, hashToken(token));
  } catch {
    // An unparseable token is already useless; clearing the cookies is enough.
  }
}
