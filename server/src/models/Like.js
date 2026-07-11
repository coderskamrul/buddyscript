import mongoose from 'mongoose';

export const TARGET_TYPE = Object.freeze({ POST: 'post', COMMENT: 'comment' });

// Likes live in their own collection rather than as an array on the post.
// An embedded array would grow unbounded (a viral post has millions of likers),
// blow past the 16MB document limit, and make every post read drag the whole
// liker list over the wire. A separate collection keeps post documents small
// and makes "who liked this" a paginated query instead of a document field.
const likeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: Object.values(TARGET_TYPE), required: true },
    // Post._id or Comment._id depending on targetType.
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

// The uniqueness guarantee: one like per (user, target). This is what makes
// like/unlike idempotent under double-clicks and concurrent requests — the DB
// rejects the duplicate rather than the application racing to check-then-write.
likeSchema.index({ targetType: 1, target: 1, user: 1 }, { unique: true });

// "Who liked this", newest-first, keyset-paginated.
likeSchema.index({ targetType: 1, target: 1, _id: -1 });

// "Which of these targets has the viewer liked" — answers the like-state of a
// whole page of posts/comments in one query instead of one query per item.
likeSchema.index({ user: 1, targetType: 1, target: 1 });

likeSchema.set('toJSON', { virtuals: true });

export const Like = mongoose.model('Like', likeSchema);
