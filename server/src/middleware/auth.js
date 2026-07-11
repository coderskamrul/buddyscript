import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../utils/tokens.js';

/**
 * Reads the access token from the httpOnly cookie, or from an Authorization
 * header (handy for curl/Postman). Attaches the user to req.user.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = req.cookies?.[ACCESS_COOKIE] || bearer;

  if (!token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    // Distinguish "expired" from "forged" so the client knows to hit /refresh
    // instead of bouncing the user to the login screen.
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'Session expired.', { expired: true });
    throw ApiError.unauthorized('Invalid session.');
  }

  if (payload.type !== 'access') throw ApiError.unauthorized('Invalid session.');

  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists.');

  req.user = user;
  return next();
});

/**
 * Authorization guard. Ownership is checked against the resource, never against
 * an id supplied by the client — the caller can only ever act as req.user.
 */
export function requireOwnership(resource, userId) {
  const ownerId = resource.author?._id ?? resource.author;
  if (String(ownerId) !== String(userId)) {
    throw ApiError.forbidden('You can only modify your own content.');
  }
}
