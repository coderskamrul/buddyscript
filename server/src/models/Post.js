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

// Public feed: keyset-paginated with `sort({ _id: -1 })`, so the index must lead
// with the equality field (visibility) and end with the sort/cursor field.
postSchema.index({ visibility: 1, _id: -1 });

// A user's own posts (public + private) for the `$or` branch of the feed query
// and for any future profile timeline.
postSchema.index({ author: 1, _id: -1 });

postSchema.set('toJSON', { virtuals: true });

export const Post = mongoose.model('Post', postSchema);
