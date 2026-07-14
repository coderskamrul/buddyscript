import { Worker } from 'bullmq';
import { getQueueRedis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { JOB, QUEUE } from '../index.js';
import { enqueueFanoutBatch, enqueueRetractBatch } from '../producers.js';
import * as followRepo from '../../repositories/follow.repository.js';
import * as userRepo from '../../repositories/user.repository.js';
import * as timelineRepo from '../../repositories/timeline.repository.js';

/**
 * FAN-OUT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE 1,000,000-FOLLOWER PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A user with a million followers taps "post". The naive implementation writes
 * the post, then writes one timeline entry per follower — a million writes —
 * before it answers the HTTP request. Three things break at once:
 *
 *   1. The request. A million writes at even 0.1ms each is 100 seconds. The
 *      client timed out 95 seconds ago; the load balancer killed the connection
 *      before that. The user taps "post" again, and now there are two of them.
 *   2. The database. Those million writes arrive as one undifferentiated burst,
 *      and they are competing with every read on the site.
 *   3. The deploy. That Express worker is now pinned for 100 seconds, so a
 *      rolling restart either waits for it or kills it mid-fan-out, leaving
 *      600,000 followers with the post and 400,000 without — and nothing that
 *      knows where it stopped.
 *
 * THIS IMPLEMENTATION DOES TWO THINGS INSTEAD.
 *
 * First: the request does not fan out AT ALL. It writes the post row, enqueues
 * one job, and returns — in about 50ms, the same 50ms whether the author has
 * three followers or three million. Latency stops being a function of popularity.
 *
 * Second, and this is the part that actually solves it: **a million-follower
 * author is never fanned out to in the first place.** Above
 * `env.feed.celebrityThreshold` we deliberately DECLINE to push, and their posts
 * are pulled at read time instead (feed.service.js). Because the alternative is
 * indefensible arithmetic — a million timeline writes to serve a post to an
 * audience of whom perhaps 5% will open the app today. It is ~950,000 writes
 * performed on behalf of nobody, and it is paid on EVERY post they ever make.
 * The pull costs ONE extra indexed Mongo query per feed read, and it is only paid
 * by people who actually showed up.
 *
 * Fan-out below the threshold is still decomposed into bounded, resumable BATCHES
 * (below) — because "asynchronous" is not the same as "safe", and a single job
 * that walks 9,000 followers is still a job that loses all its progress when a
 * worker is redeployed mid-flight.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Decides the strategy for one new post, and starts the work.
 * O(1) — one document read. It does not touch the follower collection at all.
 */
async function fanoutPost(job) {
  const { postId, authorId } = job.data;

  const author = await userRepo.findReach(authorId);
  if (!author) {
    logger.warn({ postId, authorId }, 'fanout: author no longer exists; dropping');
    return { strategy: 'skipped' };
  }

  const followerCount = author.followerCount ?? 0;

  if (followerCount >= env.feed.celebrityThreshold) {
    // The whole point. No timeline writes happen for this post — ever. Readers
    // will merge it in themselves.
    logger.info(
      { postId, authorId, followerCount, threshold: env.feed.celebrityThreshold },
      'fanout: author is above the celebrity threshold — using fan-out on READ (no push)'
    );
    return { strategy: 'pull', followerCount, pushed: 0 };
  }

  // Below the threshold: push. Start the batch chain at the beginning of the
  // follower list.
  await enqueueFanoutBatch({ postId, authorId, afterId: null });

  logger.info({ postId, authorId, followerCount }, 'fanout: using fan-out on WRITE (push)');
  return { strategy: 'push', followerCount };
}

/**
 * One batch of followers, then it enqueues the next batch and returns.
 *
 * SELF-CHAINING, rather than "compute every batch's cursor up front and fan them
 * out in parallel" — because the cursors are not knowable up front without
 * walking the collection, which is the very work being batched.
 *
 * What the chain buys, concretely:
 *
 *   • Each job is bounded (`fanoutBatchSize` followers, one pipelined Redis round
 *     trip, tens of milliseconds). A worker can be SIGTERM'd between any two
 *     links and lose at most one batch.
 *   • It is resumable: `afterId` is a keyset cursor, so a retried batch re-does
 *     its own 1,000 followers and nothing else. Never a restart from zero.
 *   • It is back-pressure friendly: the queue meters the work out at whatever
 *     rate the workers can actually absorb, instead of dumping a million
 *     operations onto Redis and Mongo at once and taking the site down with the
 *     load spike.
 *
 * Retries are safe because the push is IDEMPOTENT: the timeline dedupes on read
 * (timeline.repository.js), so a batch that ran twice is indistinguishable from
 * one that ran once. That is what lets us settle for BullMQ's at-least-once
 * delivery instead of needing exactly-once, which distributed queues cannot
 * actually give you.
 */
async function fanoutBatch(job) {
  const { postId, authorId, afterId } = job.data;

  const { followerIds, nextId } = await followRepo.findFollowerBatch({
    userId: authorId,
    afterId,
    limit: env.feed.fanoutBatchSize,
  });

  // The count comes back from the WRITE, not from the number of followers we
  // found. Those are not the same number, and conflating them is how a fan-out
  // that silently wrote nothing (an unready Redis, say) still logs "pushed: 1000"
  // and looks perfectly healthy. A log that cannot report failure is worse than
  // no log at all.
  const pushed = followerIds.length
    ? await timelineRepo.pushToTimelines(followerIds, postId)
    : 0;

  if (pushed !== followerIds.length) {
    // Not fatal — the read path falls back to Mongo, and the job will be retried.
    // But it must be loud, because it means followers did not get the post.
    logger.error(
      { postId, found: followerIds.length, pushed },
      'fanout: timeline write incomplete — followers may not see this post'
    );
    throw new Error(`fanout wrote ${pushed}/${followerIds.length} timelines`);
  }

  // Chain onwards BEFORE returning, so the queue always holds the next unit of
  // work. If this worker dies right now, the next batch is already durable in
  // Redis and another worker picks it up.
  if (nextId) {
    await enqueueFanoutBatch({ postId, authorId, afterId: nextId });
  }

  logger.debug({ postId, pushed, done: !nextId }, 'fanout: batch complete');

  return { pushed, done: !nextId };
}

/**
 * The inverse. A deleted post has to leave the timelines it was pushed into —
 * otherwise every follower's next feed read carries an id that resolves to
 * nothing, and their page quietly comes back short.
 *
 * (Reads tolerate this anyway — `findPostsByIds` drops ids whose post is gone —
 * so retraction is a cleanup, not a correctness fix. It runs on the same batched
 * chain for the same reason.)
 */
async function fanoutRetract(job) {
  const { postId, authorId, afterId } = job.data;

  const { followerIds, nextId } = await followRepo.findFollowerBatch({
    userId: authorId,
    afterId,
    limit: env.feed.fanoutBatchSize,
  });

  if (followerIds.length) {
    await timelineRepo.removeFromTimelines(followerIds, postId);
  }

  // Chains to ANOTHER RETRACT, not to a push — sharing the batch job here would
  // re-add the very post we are removing.
  if (nextId) {
    await enqueueRetractBatch({ postId, authorId, afterId: nextId });
  }

  return { removed: followerIds.length, done: !nextId };
}

const handlers = {
  [JOB.FANOUT_POST]: fanoutPost,
  [JOB.FANOUT_BATCH]: fanoutBatch,
  [JOB.FANOUT_RETRACT]: fanoutRetract,
};

export function createFanoutWorker() {
  const connection = getQueueRedis();
  if (!connection) return null;

  return new Worker(
    QUEUE.FANOUT,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Unknown fanout job: ${job.name}`);
      return handler(job);
    },
    {
      connection,
      // Fan-out is I/O-bound (Mongo reads, pipelined Redis writes), so a worker
      // process can keep many jobs in flight without competing for CPU. This is
      // the main throughput dial: raise it to fan out faster, lower it to be
      // gentler on Mongo.
      concurrency: 10,
    }
  );
}
