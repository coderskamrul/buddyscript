import mongoose from 'mongoose';

export const VISIBILITY = Object.freeze({ PUBLIC: 'public', PRIVATE: 'private' });

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, trim: true, maxlength: 5000, default: '' },
    image: { type: String, default: null },
    visibility: {
      type: String,
      enum: Object.values(VISIBILITY),
      default: VISIBILITY.PUBLIC,
      required: true,
    },
    // Denormalized counters: reading a feed of 20 posts must never fan out into
    // 20 count() queries. Kept in sync with $inc on every like/comment write.
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

/**
 * Indexes follow the ESR rule: Equality fields first, then Sort, then Range.
 * Every feed query here is keyset-paginated — `sort({_id: -1})` with `_id < cursor`
 * — so `_id` is simultaneously the sort key and the range key, and it belongs
 * last in every one of them. That is what lets Mongo answer a page as a bounded
 * index seek with no in-memory sort, at the same cost on page 50,000 as page 1.
 */

// The global/public feed. Equality on visibility, then the cursor.
postSchema.index({ visibility: 1, _id: -1 });

// A user's own posts at any visibility: the `scope=mine` feed and the `$or`
// branch of the discovery feed.
postSchema.index({ author: 1, _id: -1 });

/**
 * The CELEBRITY PULL index — the read half of the hybrid feed.
 *
 * When a viewer's timeline is assembled, posts by the celebrities they follow
 * are not in the materialized timeline (we deliberately never fanned them out),
 * so they are pulled live with:
 *
 *   { author: { $in: [...celebs] }, visibility: 'public', _id: { $lt: cursor } }
 *
 * `$in` on the leading field lets Mongo run one bounded seek per author and
 * merge the results, so this stays a handful of index seeks rather than a scan —
 * even though it is on the hot path of every single feed read.
 */
postSchema.index({ author: 1, visibility: 1, _id: -1 });

postSchema.set('toJSON', { virtuals: true });

export const Post = mongoose.model('Post', postSchema);
