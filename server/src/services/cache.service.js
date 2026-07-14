import { getRedis, isRedisReady } from '../config/redis.js';
import { log } from '../config/logger.js';

/**
 * The cache.
 *
 * ONE RULE GOVERNS THIS FILE: the cache is never allowed to take the site down.
 *
 * A cache is an optimisation, and an optimisation that can fail the request it
 * was meant to speed up is a liability. So every function here FAILS OPEN — if
 * Redis is missing, unreachable, slow, or returns garbage, the call returns as
 * though it were simply a miss, and the caller goes to Mongo. A degraded site is
 * slower. A site whose cache can 500 it is down.
 *
 * The corollary is that no cache write is ever awaited on a request's critical
 * path (see `set` and the invalidations): the user should not wait to populate a
 * cache they have already been served around.
 */

const TTL_JITTER = 0.1;

/**
 * Spreads expiries out by ±10%.
 *
 * Without it, a thousand keys written by the same burst of traffic all expire in
 * the same second, every one of those reads misses at once, and the whole herd
 * stampedes Mongo together — a self-inflicted thundering herd that repeats on a
 * perfect cycle forever. Jitter breaks the synchronisation.
 */
const jitter = (ttl) => Math.round(ttl * (1 + (Math.random() * 2 - 1) * TTL_JITTER));

export async function get(key) {
  if (!isRedisReady()) return null;

  try {
    const raw = await getRedis().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    // A cache miss and a broken cache are the same thing to the caller: go to
    // the database. This is the fail-open path, and it is deliberate.
    log().warn({ err: error, key }, 'cache read failed; falling through to mongo');
    return null;
  }
}

/** Fire-and-forget. The request does not wait for its own cache write. */
export function set(key, value, ttlSeconds) {
  if (!isRedisReady()) return;

  getRedis()
    .set(key, JSON.stringify(value), 'EX', jitter(ttlSeconds))
    .catch((error) => log().warn({ err: error, key }, 'cache write failed'));
}

/** Batch read. One round trip for a whole page of posts, not one per post. */
export async function mget(keys) {
  if (!isRedisReady() || !keys.length) return new Map();

  try {
    const raws = await getRedis().mget(keys);
    const found = new Map();
    raws.forEach((raw, index) => {
      if (raw) found.set(keys[index], JSON.parse(raw));
    });
    return found;
  } catch (error) {
    log().warn({ err: error }, 'cache mget failed; falling through to mongo');
    return new Map();
  }
}

/** Batch write, pipelined — N sets in one round trip rather than N. */
export function mset(entries, ttlSeconds) {
  if (!isRedisReady() || !entries.length) return;

  const pipeline = getRedis().pipeline();
  for (const [key, value] of entries) {
    pipeline.set(key, JSON.stringify(value), 'EX', jitter(ttlSeconds));
  }
  pipeline.exec().catch((error) => log().warn({ err: error }, 'cache mset failed'));
}

export function del(...keys) {
  if (!isRedisReady() || !keys.length) return;

  getRedis()
    .del(...keys)
    .catch((error) => log().warn({ err: error, keys }, 'cache invalidation failed'));
}

/**
 * Cache-aside (lazy loading), the pattern behind every read path here:
 *
 *   look in cache → hit? return it → miss? read Mongo, populate, return
 *
 * The alternative (read-through/write-through) would put the cache in the write
 * path, where a Redis outage becomes a write outage. Cache-aside keeps Mongo as
 * the single source of truth and Redis as a disposable accelerator that can be
 * flushed at any moment without losing a byte of data.
 */
export async function remember(key, ttlSeconds, loader) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const value = await loader();
  if (value !== null && value !== undefined) set(key, value, ttlSeconds);
  return value;
}

/**
 * The key namespace, declared in one place.
 *
 * Building keys by hand at each call site is how you end up with a stale entry
 * nobody can find: the writer spells the key one way and the invalidator another,
 * and the bug only shows up as "sometimes the feed is out of date". Every key
 * this system uses is minted here.
 */
export const keys = {
  // The post BODY — author, text, counters, like preview. Shared by every viewer.
  post: (id) => `post:${id}`,

  // A feed page: a list of post IDs, never the bodies. See feed.service.js for
  // why that separation is the whole trick.
  feedPage: (scope, viewerId, cursor, limit) =>
    `feed:${scope}:${scope === 'mine' ? viewerId : 'all'}:${cursor ?? 'head'}:${limit}`,

  // A viewer's materialized home timeline (a Redis LIST of post ids).
  timeline: (userId) => `timeline:${userId}`,

  // Which of the people a viewer follows are celebrities, and which are not.
  followSplit: (userId) => `follow:split:${userId}`,

  user: (id) => `user:${id}`,
};
