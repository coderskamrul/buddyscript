import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * RATE LIMITING — in Redis. This is the single change that most directly makes
 * the API horizontally scalable.
 *
 * express-rate-limit's default store is a Map IN THE PROCESS'S MEMORY. On one
 * server that is fine. Behind a load balancer it is quietly, seriously broken:
 *
 *   • Each of N instances keeps its OWN counter, so a "20 attempts per 15 minutes"
 *     login limit is really 20 × N. At ten instances an attacker gets 200 attempts
 *     — the limit that exists to stop credential stuffing has been multiplied by
 *     exactly the number of servers you added to cope with the load.
 *   • The counters die with the process, so a deploy, a crash, or an autoscaler
 *     scaling in resets everyone's budget to zero used.
 *   • Which instance a request lands on is a coin flip, so the limit any given
 *     user actually experiences is nondeterministic.
 *
 * Putting the counters in Redis makes them SHARED STATE, so the limit is a
 * property of the SYSTEM rather than of whichever container the load balancer
 * happened to pick. That is what "stateless app tier" really means: the servers
 * hold nothing, so they can be added, killed and replaced freely — and the things
 * that genuinely must be counted across requests live in Redis instead.
 *
 * The store is INCR + EXPIRE — a fixed window, atomic, one round trip. (A sliding
 * window is fairer at the boundary, since a user can spend their whole budget in
 * the last second of one window and again in the first second of the next, but it
 * costs a sorted set per client. ARCHITECTURE.md notes it as an upgrade.)
 */

const message = (text) => ({ success: false, message: text });

/**
 * Falls back to the in-memory store when there is no Redis — development only.
 * config/env.js refuses to boot production without a REDIS_URL, so this cannot
 * silently ship.
 *
 * EACH LIMITER GETS ITS OWN PREFIX, and that is load-bearing rather than tidy.
 * The store keys on `prefix + keyGenerator(req)`, so two limiters sharing a prefix
 * share a COUNTER: every request through the global limiter would also burn a
 * slice of the same user's login budget, and whichever limiter touched the key
 * first would set the TTL — so a 15-minute auth window could silently be reset by
 * a 1-minute global one. The limits would be neither of the numbers written below.
 */
/**
 * Connection states that mean "Redis is not coming back for THIS request".
 *
 * Note that `connecting` is NOT one of them, and that is the whole subtlety:
 * `rate-limit-redis` issues a SCRIPT LOAD from inside its constructor, which runs
 * at import time while this lazy client is still dialling. Rejecting then would be
 * an unhandled rejection at startup. So a *connecting* client is allowed to buffer
 * (ioredis's offline queue replays it on connect), while a *dead* one is refused
 * on the spot.
 */
const DEAD = new Set(['end', 'close', 'reconnecting']);

function store(prefix) {
  const client = getRedis();
  if (!client) return undefined;

  return new RedisStore({
    // rate-limit-redis hands over a command name and its args; that is exactly
    // ioredis's `call` signature.
    sendCommand: (...args) => {
      // Reject INSTANTLY on a known-dead connection rather than letting the
      // command sit in the offline queue until `commandTimeout` fires. Both paths
      // end in `passOnStoreError` letting the request through — but this one costs
      // the user nothing, and the other costs them a second on EVERY request for
      // as long as the outage lasts.
      if (DEAD.has(client.status)) {
        return Promise.reject(new Error('redis unavailable'));
      }
      return client.call(...args);
    },
    prefix,
  });
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,

  /**
   * FAIL OPEN when the store is unreachable. This one line is what keeps a Redis
   * outage from being a total outage.
   *
   * By default, express-rate-limit propagates a store error to the error handler —
   * so with Redis down, the limiter (which runs on EVERY request) throws, and the
   * whole API answers 500. The cache is carefully written to fall through to Mongo
   * when Redis dies (services/cache.service.js), and none of that matters if the
   * rate limiter 500s the request before it ever reaches a controller.
   *
   * So when the store cannot answer, we let the request through UNCOUNTED. Serving
   * traffic without a limit is strictly better than serving none — and the failure
   * is logged loudly by config/redis.js, which is where it should be noticed.
   *
   * The residual risk is honest and accepted: during a Redis outage the API is
   * unprotected against brute force. That is the right trade for a social feed
   * (the alternative is a self-inflicted denial of service on every user), but it
   * would be the WRONG trade for, say, a payments endpoint — which is precisely
   * the kind of decision that deserves to be written down rather than defaulted.
   */
  passOnStoreError: true,

  /**
   * WHO gets counted.
   *
   * `req.ip` alone is the wrong key for an authenticated API. An office, a
   * university or a mobile carrier NATs thousands of people behind one address,
   * and limiting them as a single client means one heavy user can lock out an
   * entire building. So when we know who the caller is, count the USER.
   *
   * The IP is kept for the anonymous endpoints (login, register) — where it is
   * all we have, and where it is also the RIGHT key, because the attack being
   * defended against there is one machine trying many accounts.
   *
   * (`app.set('trust proxy', 1)` in app.js is what makes `req.ip` the real client
   * address rather than the load balancer's.)
   */
  keyGenerator: (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`),
};

// Credential endpoints are the ones worth brute-forcing, so they get a tight
// budget of their own rather than sharing the global allowance.
export const authLimiter = rateLimit({
  ...base,
  store: store('rl:auth:'),
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimit.authPer15Min,
  // Only FAILURES count. Somebody legitimately signing in and out all day is not
  // an attacker and should not be locked out for it.
  skipSuccessfulRequests: true,
  message: message('Too many attempts. Please try again in a few minutes.'),
});

export const writeLimiter = rateLimit({
  ...base,
  store: store('rl:write:'),
  windowMs: 60 * 1000,
  limit: env.rateLimit.writePerMinute,
  message: message('You are doing that too fast. Please slow down.'),
});

export const globalLimiter = rateLimit({
  ...base,
  store: store('rl:global:'),
  windowMs: 60 * 1000,
  limit: env.rateLimit.globalPerMinute,
  message: message('Too many requests.'),
});

if (!env.redis.enabled) {
  logger.warn(
    'rate limiting is using the IN-MEMORY store: counters are per-process and ' +
      'will be wrong behind a load balancer. Set REDIS_URL.'
  );
}
