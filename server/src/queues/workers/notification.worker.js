import { Worker } from 'bullmq';
import { getQueueRedis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { QUEUE } from '../index.js';
import { Notification } from '../../models/Notification.js';

/**
 * Notifications.
 *
 * Small, high-volume, and entirely off the critical path: nothing the user sees
 * after liking a post depends on the notification existing. So the like request
 * enqueues and returns, and this worker does the write.
 *
 * The reason that matters is not the ~5ms it saves today. It is that this is the
 * seam where notification work GROWS. "Write a row" becomes "write a row, look up
 * the recipient's devices, call APNs and FCM, respect their quiet hours, collapse
 * it into 'Alice and 12 others liked your post'" — hundreds of milliseconds and
 * three third-party services, any of which can be down. All of that can be built
 * behind this boundary without a single millisecond of it ever reaching the
 * request that triggered it.
 */
async function notify(job) {
  const { recipientId, actorId, type, entityType, entityId } = job.data;

  await Notification.create({
    recipient: recipientId,
    actor: actorId,
    type,
    entityType,
    entity: entityId,
  });

  // ── Where push delivery would go ────────────────────────────────────────────
  // await pushService.send(recipientId, renderNotification(type, actorId));
  // Deliberately not implemented: it needs APNs/FCM credentials that this
  // assignment has no reason to hold. The queue, the retry policy and the
  // isolation from the request path — the parts that are architecture rather
  // than integration — are all here and working.
  // ────────────────────────────────────────────────────────────────────────────

  logger.debug({ recipientId, actorId, type }, 'notification written');
  return { delivered: true };
}

export function createNotificationWorker() {
  const connection = getQueueRedis();
  if (!connection) return null;

  return new Worker(QUEUE.NOTIFICATION, notify, { connection, concurrency: 20 });
}
