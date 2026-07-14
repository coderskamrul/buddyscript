import { Worker } from 'bullmq';
import { getQueueRedis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { QUEUE } from '../index.js';
import { cloudinary } from '../../config/cloudinary.js';
import { env } from '../../config/env.js';
import { FEED_WIDTHS } from '../../services/postImage.service.js';

/**
 * Image post-processing.
 *
 * The upload itself stays in the request — it has to, because the post cannot be
 * written until the image has a name to point at. What does NOT have to be in the
 * request is everything that happens to that image afterwards.
 *
 * Concretely: the client builds a `srcset` from several widths (see
 * client/src/utils/cloudinary.js). Cloudinary generates each of those on FIRST
 * REQUEST — so without this worker, the first person to scroll past a new post
 * pays several hundred milliseconds of transform latency, and if the post lands
 * on a thousand feeds at once, a thousand people race to trigger the same
 * transform. Pre-generating them here means the derived images are already in the
 * CDN before anyone asks, and the first viewer gets a cache hit like everybody
 * else.
 *
 * This is also the natural home for the work a real platform bolts on next:
 * NSFW/abuse moderation, perceptual-hash dedupe, EXIF scrubbing beyond what the
 * upload transform already does, thumbnail extraction for video. All of it is
 * slow, all of it is fallible, and none of it should be able to fail a user's
 * post — which is exactly what a queue with a retry policy is for.
 */
async function derive(job) {
  const { postId, image } = job.data;
  if (!image) return { skipped: true };

  const publicId = `${env.cloudinary.folder}/${image}`;

  // `eager` renders the variants now and caches them at the CDN edge, rather than
  // on the unlucky first viewer's request.
  await cloudinary.uploader.explicit(publicId, {
    type: 'upload',
    resource_type: 'image',
    eager: FEED_WIDTHS.map((width) => ({
      width,
      crop: 'limit',
      fetch_format: 'auto',
      quality: 'auto',
    })),
    // Do the work in Cloudinary's background and let it notify itself; we are not
    // holding a worker slot open waiting for six image encodes.
    eager_async: true,
  });

  logger.info({ postId, image, widths: FEED_WIDTHS }, 'media: derived variants requested');
  return { derived: FEED_WIDTHS.length };
}

export function createMediaWorker() {
  const connection = getQueueRedis();
  if (!connection) return null;

  // Deliberately low. Media jobs call a rate-limited third party, and hammering
  // Cloudinary with 20 concurrent transform requests earns a 420 and a backoff
  // that is slower than just having been patient.
  return new Worker(QUEUE.MEDIA, derive, { connection, concurrency: 3 });
}
