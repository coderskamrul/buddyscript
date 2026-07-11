import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // null => top-level comment. Otherwise the comment this is a reply to.
    // Replies are capped at one level (a reply to a reply is stored against the
    // same parent), which matches the design and keeps reads to two queries.
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    likeCount: { type: Number, default: 0, min: 0 },
    replyCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Top-level comments for a post, and replies for a comment, both newest-first.
commentSchema.index({ post: 1, parent: 1, _id: -1 });

commentSchema.set('toJSON', { virtuals: true });

export const Comment = mongoose.model('Comment', commentSchema);
