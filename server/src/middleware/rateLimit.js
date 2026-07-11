import rateLimit from 'express-rate-limit';

const message = (text) => ({ success: false, message: text });

// Credential endpoints are the ones worth brute-forcing, so they get a tight
// budget of their own rather than sharing the global allowance.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: message('Too many attempts. Please try again in a few minutes.'),
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('You are doing that too fast. Please slow down.'),
});

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many requests.'),
});
