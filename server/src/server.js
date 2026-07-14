import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { closeQueues } from './queues/index.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function start() {
  // Connect before listening: a server that accepts traffic it cannot serve is
  // worse than one that starts a second later.
  //
  // Redis is dialled here too, so the first request does not race a
  // still-connecting client and silently take the degraded path. Unlike Mongo it
  // is NOT fatal if it fails — the app reads through to Mongo without it.
  await connectDatabase();
  await connectRedis();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        env: env.nodeEnv,
        redis: env.redis.enabled ? 'enabled' : 'DISABLED (degraded mode)',
      },
      'api listening'
    );
  });

  /**
   * GRACEFUL SHUTDOWN — the other half of what makes a container disposable.
   *
   * A rolling deploy sends SIGTERM and then waits. `server.close()` stops
   * ACCEPTING new connections while letting the ones already in flight finish, so
   * a user who is mid-request when their container is replaced gets their
   * response instead of a connection reset. Without it, every deploy drops a
   * fraction of live traffic — invisibly, because the errors happen in the
   * browser and not in your logs.
   */
  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');

    server.close(async () => {
      await Promise.allSettled([closeQueues(), disconnectDatabase(), disconnectRedis()]);
      logger.info('stopped cleanly');
      process.exit(0);
    });

    // Don't let one hung connection hold the deploy open forever.
    setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  /**
   * A promise nobody caught means the process is in a state we did not design and
   * cannot reason about. Log it with the full error and let the orchestrator
   * restart us clean — limping on with corrupt state serves worse answers than
   * being briefly unavailable.
   */
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    shutdown('unhandledRejection');
  });
}

start().catch((error) => {
  logger.fatal({ err: error }, 'api failed to start');
  process.exit(1);
});
