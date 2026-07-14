import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Redis connections.
 *
 * Two are created, not one, and the split is not cosmetic. BullMQ's blocking
 * commands (BRPOPLPUSH and friends) occupy a connection for as long as they
 * block, so a queue sharing the cache's connection would stall every GET behind
 * a worker waiting for a job. BullMQ also requires `maxRetriesPerRequest: null`,
 * which is precisely the setting we do NOT want on the cache: there, a command
 * that cannot complete should give up quickly so the request can fall through to
 * Mongo rather than hang.
 *
 * Both are lazy. Nothing dials Redis until something actually needs it, which is
 * what lets a `REDIS_URL`-less development machine boot at all.
 */

const clients = new Map();

const baseOptions = {
  lazyConnect: true,

  /**
   * `enableAutoPipelining` is deliberately OFF, and it is not a performance
   * oversight.
   *
   * It is incompatible with `enableOfflineQueue: false` (below), and the failure
   * mode is the worst kind: when the connection is not writable, ioredis's
   * auto-pipeline executor THROWS SYNCHRONOUSLY from inside a `setImmediate`
   * callback. That is not inside any promise chain, so no `.catch()` at the call
   * site can intercept it — it surfaces as an uncaughtException and kills the
   * process. A Redis outage would therefore not degrade the API; it would crash
   * every container, repeatedly, as fast as they could restart.
   *
   * Little is given up. The paths that actually benefit from pipelining — the
   * fan-out timeline writes, the page-wide cache reads — already use EXPLICIT
   * pipelines and MGET, which is both faster and legible.
   */
  enableAutoPipelining: false,

  // Bound the reconnect backoff: without a cap, a Redis that was down for a while
  // is retried so rarely that recovery takes far longer than the outage did.
  retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
};

function create(name, options) {
  const client = new Redis(env.redis.url, { ...baseOptions, ...options });

  // ioredis emits 'error' on every failed reconnect attempt. An unhandled
  // 'error' event on an EventEmitter is a process-level crash in Node — so this
  // listener is not optional, it is what keeps a Redis blip from killing the API.
  client.on('error', (error) => {
    logger.error({ err: error, client: name }, 'redis connection error');
  });
  client.on('ready', () => logger.info({ client: name }, 'redis connected'));

  client.connect().catch((error) => {
    logger.error({ err: error, client: name }, 'redis initial connection failed');
  });

  return client;
}

/** The cache + rate-limiter connection. */
export function getRedis() {
  if (!env.redis.enabled) return null;

  if (!clients.has('cache')) {
    clients.set(
      'cache',
      create('cache', {
        keyPrefix: env.redis.keyPrefix,

        // Fail fast. A cache is an optimisation: if it cannot answer in time, the
        // right move is to give up and read Mongo, never to make the user wait.
        maxRetriesPerRequest: 2,
        connectTimeout: 2_000,

        /**
         * THE SETTING THAT MAKES "FAIL OPEN" ACTUALLY WORK.
         *
         * ioredis BUFFERS commands issued while it is disconnected and replays them
         * on reconnect, and by default it will hold them there indefinitely. For a
         * cache that is exactly wrong: a `GET` issued during a Redis outage does not
         * fail — it simply never returns, and the request waiting on it never
         * answers. (Observed before this was added: 13-second requests, then client
         * timeouts, with Express workers pinned open the whole time.)
         *
         * `commandTimeout` bounds EVERY command, including one sitting in that
         * offline queue. A Redis that cannot answer within a second is treated as a
         * Redis that is not there: the cache catches the rejection and reads Mongo,
         * the rate limiter catches it and lets the request through. The outage
         * becomes a slowdown, which is what it was always supposed to be.
         *
         * (The offline queue itself is deliberately left ON. Turning it off breaks
         * STARTUP: `rate-limit-redis` issues a SCRIPT LOAD from inside its
         * constructor, before this lazy client has finished connecting, and with no
         * offline queue that rejects instantly — an unhandled rejection at import
         * time that kills the process before it ever listens.)
         */
        commandTimeout: 1_000,
      })
    );
  }
  return clients.get('cache');
}

/**
 * The queue connection. BullMQ mandates `maxRetriesPerRequest: null` (a job must
 * not be dropped just because a command was slow) and manages its own key
 * namespacing, so no keyPrefix here — BullMQ would double-prefix it.
 */
export function getQueueRedis() {
  if (!env.redis.enabled) return null;

  if (!clients.has('queue')) {
    clients.set('queue', create('queue', { maxRetriesPerRequest: null }));
  }
  return clients.get('queue');
}

/** True only when a connection is actually usable *right now*. */
export const isRedisReady = () => getRedis()?.status === 'ready';

/**
 * Dials Redis and WAITS for it to be usable. Called once at process start, by both
 * the API and the worker.
 *
 * Without this, the lazy `getRedis()` above has a trap in it: the first caller
 * creates the client, which begins connecting and is therefore NOT yet 'ready' —
 * so `isRedisReady()` returns false and that first caller silently takes the
 * degraded path. In the API that is invisible (one cache miss). In the WORKER it
 * is not: the first fan-out job would skip its Redis write entirely and report
 * success, and a post would simply never arrive in anybody's timeline.
 *
 * Connecting up front removes the race rather than papering over it. It is
 * deliberately non-fatal: a Redis that is down at boot must not stop the API from
 * starting and serving reads from Mongo.
 */
export async function connectRedis() {
  const client = getRedis();
  if (!client) return null;

  if (client.status === 'ready') return client;

  try {
    await new Promise((resolve, reject) => {
      const onReady = () => {
        client.off('error', onError);
        resolve();
      };
      const onError = (error) => {
        client.off('ready', onReady);
        reject(error);
      };
      client.once('ready', onReady);
      client.once('error', onError);
    });
    return client;
  } catch (error) {
    logger.error({ err: error }, 'redis not ready at startup; continuing in degraded mode');
    return null;
  }
}

export async function disconnectRedis() {
  await Promise.all([...clients.values()].map((client) => client.quit().catch(() => {})));
  clients.clear();
}
