import { getRedis, isRedisReady } from '../config/redis.js';
import { log } from '../config/logger.js';
import { env } from '../config/env.js';
import { keys } from '../services/cache.service.js';

/**
 * The MATERIALIZED HOME TIMELINE — one Redis list per user, holding post IDs.
 *
 * Ids, not post bodies. This is the single most important decision in the fan-out
 * design and it is worth being explicit about why:
 *
 *   A post fanned out to a million followers is stored a million times. At ~1KB
 *   of JSON per post body that is a gigabyte of Redis for ONE post, every copy of
 *   which has to be rewritten the moment the author edits a typo or somebody
 *   likes it. At 24 bytes per id it is 24MB, and an edit invalidates exactly ONE
 *   key — the post body in the shared `post:{id}` cache — which all million
 *   timelines then read through.
 *
 * So: the timeline is an INDEX (what should this user see, in what order), and
 * the post cache is the CONTENT (what does this post say). They are invalidated
 * on completely different schedules, which is precisely why they must not be the
 * same cache entry.
 *
 * Bounded by `timelineMaxLength`. A timeline is a cache, not an archive: nobody
 * scrolls past ~800 posts, and a reader who does simply falls through to Mongo.
 */

const MAX = env.feed.timelineMaxLength;

/**
 * Pushes one post id into many followers' timelines — the write half of fan-out.
 *
 * Pipelined: 1,000 followers is ONE round trip carrying 2,000 commands, not 2,000
 * round trips. Over a 1ms network hop, the difference between those two is the
 * difference between 2 seconds and 2 milliseconds — per batch, and there are a
 * thousand batches in a million-follower fan-out. Without the pipeline, fan-out
 * to a celebrity would take over half an hour in network latency alone.
 */
export async function pushToTimelines(followerIds, postId) {
  if (!isRedisReady() || !followerIds.length) return 0;

  const pipeline = getRedis().pipeline();
  for (const followerId of followerIds) {
    const key = keys.timeline(followerId);
    pipeline.lpush(key, String(postId));
    // Trim on every push rather than in a sweep job: it keeps each list bounded
    // at all times and costs O(1) when nothing needs removing.
    pipeline.ltrim(key, 0, MAX - 1);
    // A timeline nobody reads is dead weight. Expiring it means an inactive
    // user's list is reclaimed automatically, and rebuilt from Mongo for free the
    // next time they log in (see feed.service.js — the cold-start fallback).
    pipeline.expire(key, 60 * 60 * 24 * 30);
  }

  await pipeline.exec();
  return followerIds.length;
}

/**
 * Reads a page out of a materialized timeline.
 *
 * The whole list is pulled (≤800 ids, ~19KB) and paged in memory rather than by
 * Redis index, because an index-based LRANGE is not a stable cursor: a post
 * arriving mid-scroll shifts every index down by one, and the reader sees the
 * same post twice. Ids are stable, indexes are not.
 *
 * The sort is what makes that safe. An ObjectId's hex string sorts
 * lexicographically in exactly the order its bytes do — the leading 4 bytes are a
 * big-endian timestamp — so `id < cursor` on the string is the same comparison
 * Mongo makes with `_id: { $lt: cursor }`. Re-sorting on read therefore also
 * repairs any out-of-order arrival from two fan-out jobs racing, and the dedupe
 * absorbs a job that was retried after a crash. Fan-out is thus allowed to be
 * at-least-once — which is the only thing a queue can actually promise.
 */
export async function readTimeline(userId, { cursor, limit }) {
  if (!isRedisReady()) return null;

  try {
    const raw = await getRedis().lrange(keys.timeline(userId), 0, -1);
    // A cold/evicted timeline is NOT an empty timeline. Saying "no posts" here
    // would show an active user a blank feed; `null` means "unknown, go and ask
    // Mongo", and the caller rebuilds.
    if (!raw.length) return null;

    const ids = [...new Set(raw)]
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
      .filter((id) => !cursor || id < String(cursor));

    return ids.slice(0, limit + 1);
  } catch (error) {
    log().warn({ err: error, userId }, 'timeline read failed; falling back to mongo');
    return null;
  }
}

/** Seeds a timeline from Mongo — the cold-start path for a user Redis has evicted. */
export async function rebuildTimeline(userId, postIds) {
  if (!isRedisReady() || !postIds.length) return;

  const key = keys.timeline(userId);
  try {
    await getRedis()
      .multi()
      .del(key)
      // Newest id must end up at the head, and RPUSH appends — so a
      // newest-first array is written in the order it already has.
      .rpush(key, ...postIds.map(String))
      .ltrim(key, 0, MAX - 1)
      .expire(key, 60 * 60 * 24 * 30)
      .exec();
  } catch (error) {
    log().warn({ err: error, userId }, 'timeline rebuild failed');
  }
}

/** Removes a deleted post from a timeline (used by the fan-out worker's undo path). */
export async function removeFromTimelines(followerIds, postId) {
  if (!isRedisReady() || !followerIds.length) return;

  const pipeline = getRedis().pipeline();
  for (const followerId of followerIds) {
    pipeline.lrem(keys.timeline(followerId), 0, String(postId));
  }
  await pipeline.exec();
}
