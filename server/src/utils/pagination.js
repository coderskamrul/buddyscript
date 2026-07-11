import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export function parseLimit(raw, fallback = DEFAULT_LIMIT) {
  const limit = Number.parseInt(raw, 10);
  if (Number.isNaN(limit) || limit < 1) return fallback;
  return Math.min(limit, MAX_LIMIT);
}

/**
 * Keyset (cursor) pagination on _id.
 *
 * `skip` is O(n) — the server walks and discards every skipped document, so
 * page 50,000 of a million-post feed is a table scan. An ObjectId encodes its
 * creation time in its leading bytes, so `_id < cursor` sorted by `_id: -1` is
 * both a correct "older than this" filter and an index range seek: the cost of
 * page 50,000 is identical to page 1. It is also stable — posts created while
 * the user scrolls cannot shift items across page boundaries and cause the
 * duplicate/skipped rows that offset pagination produces.
 */
export function cursorFilter(cursor) {
  if (!cursor) return {};
  if (!mongoose.isValidObjectId(cursor)) throw ApiError.badRequest('Invalid cursor.');
  return { _id: { $lt: new mongoose.Types.ObjectId(cursor) } };
}

/**
 * Fetches limit + 1 rows so we can report `hasMore` without a second count()
 * query, then trims the extra row back off.
 */
export function buildPage(docs, limit) {
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  return {
    items,
    nextCursor: hasMore && items.length ? items[items.length - 1]._id.toString() : null,
    hasMore,
  };
}
