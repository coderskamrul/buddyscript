import { Queue } from 'bullmq';
import { getQueueRedis } from '../config/redis.js';
import { env } from '../config/env.js';
import { log, logger } from '../config/logger.js';

/**
 * THE QUEUES.
 *
 * The rule that decides what belongs here: if the user does not need the result
 * to render their next screen, it does not belong in their request.
 *
 * Creating a post needs one thing to be true before the API can answer — the post
 * row exists. Fanning it out to a million timelines, notifying the author's
 * followers, and generating image variants are all consequences of that write,
 * and none of them change the response. Doing them inline would make the p99 of
 * "post a photo" a function of how many followers you have, which is absurd: the
 * most popular users would have the slowest app.
 *
 * So the request writes the row, enqueues, and returns in ~50ms. The workers pick
 * the rest up. That is also what makes the API stateless and horizontally
 * scalable — an API container holds no in-flight work, so it can be killed at any
 * moment without losing any.
 */

export const QUEUE = Object.freeze({
  FANOUT: 'fanout',
  NOTIFICATION: 'notification',
  MEDIA: 'media',
});

export const JOB = Object.freeze({
  // Decide push-vs-pull for a new post, then spawn the batch jobs.
  FANOUT_POST: 'fanout-post',
  // One slice of followers. A million-follower post becomes ~1,000 of these.
  FANOUT_BATCH: 'fanout-batch',
  // Retract a deleted post from the timelines it was pushed into.
  FANOUT_RETRACT: 'fanout-retract',

  NOTIFY: 'notify',
  MEDIA_DERIVE: 'media-derive',
});

const defaultJobOptions = {
  /**
   * Retries with exponential backoff. A worker's dependencies (Mongo, Redis,
   * Cloudinary) fail transiently, and the correct response to a transient
   * failure is to try again LATER — immediately retrying a database that is
   * under load simply adds to the load that is causing the failures.
   */
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },

  // Completed jobs are kept briefly (enough to debug a bad fan-out), failures for
  // a week (enough to notice, investigate, and replay them). Keeping everything
  // forever would grow Redis without bound — the queue would become the outage.
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
};

const queues = new Map();

export function getQueue(name) {
  // No Redis => no queue. Callers handle this (see `enqueue` below); this is the
  // degraded-mode path, and it is why a dev machine boots without a Redis.
  const connection = getQueueRedis();
  if (!connection) return null;

  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection, defaultJobOptions }));
  }
  return queues.get(name);
}

/**
 * How long a request will wait for the queue to accept a job before giving up.
 *
 * This is not belt-and-braces — without it the API HANGS when Redis is down.
 * BullMQ requires its connection to use `maxRetriesPerRequest: null`, which means
 * a command issued while Redis is unreachable is retried FOREVER rather than
 * rejected. `queue.add()` therefore never settles, and a `createPost` awaiting it
 * never answers: the user's request hangs until the client times out, and an
 * Express worker is held open for every post attempted during the outage.
 *
 * A cache that fails open is worthless if the queue can still hang the same
 * request. So the wait is bounded, and a queue that cannot answer in 2 seconds is
 * treated exactly like a queue that is down.
 */
const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Connection states that mean "Redis is not coming back for this request". Mirrors
 * the set in middleware/rateLimit.js — a *connecting* client is allowed to buffer,
 * a *dead* one is not waited on.
 */
const DEAD = new Set(['end', 'close', 'reconnecting']);

const withTimeout = (promise, ms, label) => {
  // Promise.race abandons the LOSER, it does not cancel it. So when the timeout
  // wins, `promise` is still pending — and if it rejects a minute later (Redis
  // finally giving up), nobody is listening, and an unhandled rejection in Node
  // takes the whole process down. Attaching a no-op catch keeps the abandoned
  // promise's eventual failure handled; the race result is unaffected.
  promise.catch(() => {});

  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref()
    ),
  ]);
};

/**
 * The single producer entry point.
 *
 * Enqueuing MUST NOT be able to fail — or stall — the request that triggered it. A
 * like whose notification could not be queued is still a like: the user pressed
 * the button, the row is written, and the correct outcome is a logged warning, not
 * a 500 in their face and certainly not a hung connection. So this swallows, and
 * loudly.
 *
 * (The honest caveat, spelled out because it is the real limitation of this design:
 * the DB write and the enqueue are not one atomic transaction. A crash — or an
 * outage — in the gap between them loses the job. At this scale that is an
 * acceptable trade: a missed notification, or a post that reaches its followers'
 * timelines late, via the read-path Mongo rebuild rather than the push.
 * ARCHITECTURE.md documents the transactional outbox pattern that removes it when
 * it stops being acceptable.)
 */
export async function enqueue(queueName, jobName, payload, options = {}) {
  const queue = getQueue(queueName);

  if (!queue) {
    log().warn(
      { queue: queueName, job: jobName },
      'redis unavailable — job dropped (degraded mode; set REDIS_URL to enable queues)'
    );
    return null;
  }

  // Known-dead connection: drop the job NOW rather than making the user wait out
  // the full ENQUEUE_TIMEOUT_MS before we conclude the same thing. During a Redis
  // outage this is the difference between posting in 300ms and posting in 2.3s.
  if (DEAD.has(getQueueRedis()?.status)) {
    log().warn({ queue: queueName, job: jobName }, 'redis down — job dropped');
    return null;
  }

  try {
    const job = await withTimeout(
      queue.add(jobName, payload, options),
      ENQUEUE_TIMEOUT_MS,
      `enqueue ${queueName}/${jobName}`
    );
    log().debug({ queue: queueName, job: jobName, jobId: job.id }, 'job enqueued');
    return job;
  } catch (error) {
    // Loud, because a dropped job has real consequences (a follower who never got
    // the post pushed to them) — but NOT fatal, because the write the user asked
    // for has already succeeded.
    log().error({ err: error, queue: queueName, job: jobName }, 'failed to enqueue job');
    return null;
  }
}

/**
 * Bulk enqueue — one round trip for N jobs.
 *
 * This is what a million-follower fan-out actually uses: the ~1,000 batch jobs it
 * decomposes into are added in a handful of pipelined calls rather than 1,000
 * sequential awaits.
 */
export async function enqueueBulk(queueName, jobs) {
  const queue = getQueue(queueName);
  if (!queue || !jobs.length) return 0;

  try {
    await withTimeout(
      queue.addBulk(jobs),
      ENQUEUE_TIMEOUT_MS,
      `bulk enqueue ${queueName} (${jobs.length})`
    );
    return jobs.length;
  } catch (error) {
    log().error({ err: error, queue: queueName, count: jobs.length }, 'bulk enqueue failed');
    return 0;
  }
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((queue) => queue.close().catch(() => {})));
  queues.clear();
}

if (!env.redis.enabled) {
  logger.warn(
    'REDIS_URL is not set — running in DEGRADED MODE: cache disabled, ' +
      'rate limiting is per-process (in-memory), background jobs are dropped. ' +
      'This is fine for local development and NOT safe behind a load balancer.'
  );
}
