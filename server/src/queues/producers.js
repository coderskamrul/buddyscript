import { JOB, QUEUE, enqueue } from './index.js';

/**
 * Typed producers. Services call these; they never touch BullMQ directly.
 *
 * The indirection buys one thing that matters: the job payload is a contract
 * between a producer running in an API container and a consumer running in a
 * worker container, and those two are deployed SEPARATELY. During a rolling
 * deploy, a new API is enqueuing while an old worker is still consuming.
 * Funnelling every payload through one file is what makes that contract
 * reviewable, instead of being an object literal buried in a controller.
 *
 * Payloads carry IDs, never documents. A job that embeds a post body will
 * execute against a stale copy of it if the post is edited between enqueue and
 * run; a job that carries the id re-reads the truth when it runs.
 */

export const enqueuePostFanout = ({ postId, authorId }) =>
  enqueue(
    QUEUE.FANOUT,
    JOB.FANOUT_POST,
    { postId: String(postId), authorId: String(authorId) },
    {
      // Deduplicates by id: if this same post is somehow enqueued twice (a retried
      // request, a double-submit), BullMQ keeps one job. Fan-out is idempotent
      // anyway — the timeline dedupes on read — but not doing the work twice is
      // better than doing it twice harmlessly.
      //
      // A hyphen, NOT a colon: BullMQ builds its Redis keys as `bull:<queue>:<id>`
      // and rejects a custom id containing `:` outright ("Custom Id cannot contain :").
      jobId: `fanout-${postId}`,
    }
  );

export const enqueueFanoutBatch = ({ postId, authorId, afterId }) =>
  enqueue(QUEUE.FANOUT, JOB.FANOUT_BATCH, {
    postId: String(postId),
    authorId: String(authorId),
    afterId: afterId ? String(afterId) : null,
  });

export const enqueueFanoutRetract = ({ postId, authorId }) =>
  enqueue(
    QUEUE.FANOUT,
    JOB.FANOUT_RETRACT,
    { postId: String(postId), authorId: String(authorId), afterId: null },
    { jobId: `retract-${postId}` }
  );

/**
 * The retract chain's own continuation. Separate from `enqueueFanoutBatch`
 * because a shared batch job would re-PUSH the post it is supposed to be
 * removing — and no jobId here, since every link in the chain is a distinct unit
 * of work rather than a deduplicated one.
 */
export const enqueueRetractBatch = ({ postId, authorId, afterId }) =>
  enqueue(QUEUE.FANOUT, JOB.FANOUT_RETRACT, {
    postId: String(postId),
    authorId: String(authorId),
    afterId: afterId ? String(afterId) : null,
  });

export const enqueueNotification = ({ recipientId, actorId, type, entityType, entityId }) => {
  // Nobody wants to be told they liked their own post. Dropped at the producer
  // so the job is never created, rather than created and then discarded.
  if (String(recipientId) === String(actorId)) return null;

  return enqueue(QUEUE.NOTIFICATION, JOB.NOTIFY, {
    recipientId: String(recipientId),
    actorId: String(actorId),
    type,
    entityType: entityType ?? null,
    entityId: entityId ? String(entityId) : null,
  });
};

/**
 * Post-upload image work: pre-generating the delivery variants the feed will ask
 * for, so the FIRST person to see the post does not pay Cloudinary's on-the-fly
 * transform latency (see workers/media.worker.js).
 */
export const enqueueMediaDerive = ({ postId, image }) =>
  enqueue(QUEUE.MEDIA, JOB.MEDIA_DERIVE, { postId: String(postId), image });
