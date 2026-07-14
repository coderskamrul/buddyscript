/**
 * THE WORKER PROCESS — `npm run worker`.
 *
 * A SEPARATE process from the API, and separately deployed. This is not tidiness,
 * it is the thing that makes both halves scale:
 *
 *   • The API and the workers fail differently and scale differently. A traffic
 *     spike needs more API containers; a celebrity posting needs more fan-out
 *     workers. Running them in one process means you cannot buy one without
 *     buying the other.
 *   • A worker chewing through a 1,000-batch fan-out would otherwise be doing it
 *     ON an event loop that is supposed to be answering HTTP requests, and every
 *     request served by that container would sit behind it.
 *   • The API can then be genuinely stateless — no in-flight work lives in it, so
 *     any container can be killed at any time and a load balancer can route any
 *     request to any of them. That is the precondition for horizontal scaling,
 *     and an in-process job runner quietly destroys it.
 *
 * Scale it with `WORKER_CONCURRENCY` and by running more copies. They coordinate
 * through Redis; no worker needs to know another exists.
 */
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeQueues } from './queues/index.js';
import { createFanoutWorker } from './queues/workers/fanout.worker.js';
import { createNotificationWorker } from './queues/workers/notification.worker.js';
import { createMediaWorker } from './queues/workers/media.worker.js';

// Note there is no `createApp()` here, and no `listen()`. A worker must not open
// an HTTP port — see the module comment above.

async function start() {
  if (!env.redis.enabled) {
    logger.error(
      'REDIS_URL is not set. The worker has no queue to consume from and would ' +
        'idle forever. Set REDIS_URL, or run the API alone (jobs are dropped in ' +
        'degraded mode).'
    );
    process.exit(1);
  }

  // Workers read and write Mongo (notifications, follower batches), so they need
  // the same connection the API has — just not the same HTTP server.
  //
  // Redis is connected EAGERLY and before any job can be picked up: a fan-out job
  // that runs against a still-connecting client would skip its timeline write and
  // report success (see config/redis.js).
  await Promise.all([connectDatabase(), connectRedis()]);

  const workers = [
    createFanoutWorker(),
    createNotificationWorker(),
    createMediaWorker(),
  ].filter(Boolean);

  for (const worker of workers) {
    worker.on('completed', (job) =>
      logger.debug({ queue: worker.name, job: job.name, jobId: job.id }, 'job completed')
    );

    // A job that has exhausted its retries is a real incident: a notification
    // nobody got, or a slice of followers who never received a post. It must be
    // loud enough to alert on, and it stays in the failed set for a week so it
    // can be inspected and replayed.
    worker.on('failed', (job, err) =>
      logger.error(
        {
          err,
          queue: worker.name,
          job: job?.name,
          jobId: job?.id,
          attempts: job?.attemptsMade,
          data: job?.data,
        },
        'job failed'
      )
    );
  }

  logger.info({ queues: workers.map((worker) => worker.name) }, 'workers started');

  /**
   * GRACEFUL SHUTDOWN. `worker.close()` waits for the jobs currently in flight to
   * finish and stops taking new ones. Without it, a deploy SIGTERMs a worker
   * mid-batch — and while the batch would eventually be retried (it is durable in
   * Redis and idempotent on replay), doing this properly means a rolling deploy
   * costs nothing at all rather than a stall and a redelivery.
   */
  const shutdown = async (signal) => {
    logger.info({ signal }, 'worker shutting down; draining in-flight jobs');

    // Do not let a wedged job hold the deploy open forever.
    const guard = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 30_000);
    guard.unref();

    await Promise.all(workers.map((worker) => worker.close()));
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();

    clearTimeout(guard);
    logger.info('worker stopped cleanly');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  logger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
