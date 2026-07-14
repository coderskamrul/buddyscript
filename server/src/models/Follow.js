import mongoose from 'mongoose';

/**
 * The social graph — one document per edge.
 *
 * The tempting alternative is `User.following: [ObjectId]`. It does not survive
 * contact with scale: a user with a million followers would need a million
 * ObjectIds in one array (12MB of raw ids, past the 16MB document ceiling once
 * BSON overhead lands), every read of that user would drag the whole array over
 * the wire, and two people following them at the same instant would contend on
 * the same document. An edge collection makes a follow an O(1) insert that
 * contends with nothing, and makes "who follows X" a paginated index scan.
 */
const followSchema = new mongoose.Schema(
  {
    // The person doing the following.
    follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The person being followed.
    following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// One edge per pair. As with likes, this index — not an application-level
// check-then-insert — is what makes following idempotent under concurrency.
followSchema.index({ follower: 1, following: 1 }, { unique: true });

/**
 * THE fan-out index.
 *
 * Fan-out asks exactly one question, several thousand times per viral post:
 * "give me the next N followers of author X after follower-id C". This index
 * answers it as a bounded range scan — the worker keyset-walks it in batches and
 * never re-reads a follower it has already pushed to. Without it, fanning out to
 * a million followers would be a million-document collection scan per batch.
 */
followSchema.index({ following: 1, _id: 1 });

// "Who am I following", newest-first — the read path for the celebrity pull.
followSchema.index({ follower: 1, _id: -1 });

followSchema.set('toJSON', { virtuals: true });

export const Follow = mongoose.model('Follow', followSchema);
