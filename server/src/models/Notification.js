import mongoose from 'mongoose';

export const NOTIFICATION_TYPE = Object.freeze({
  LIKE: 'like',
  COMMENT: 'comment',
  REPLY: 'reply',
  FOLLOW: 'follow',
});

/**
 * Notifications are written by the notification WORKER, never by a request.
 *
 * The point is latency ownership. Liking a post is one indexed write; if the
 * request also had to fan a notification out, resolve the actor, and (later)
 * push it to a device, the user would be waiting on work that has nothing to do
 * with the answer they asked for. So the request enqueues a job and returns; the
 * worker does the rest. If the notification is written 200ms later, nobody can
 * tell — and if the worker is down, the like still succeeds.
 */
const notificationSchema = new mongoose.Schema(
  {
    // Who should see this.
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Who caused it.
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPE), required: true },

    // The thing that was acted on (a post or a comment), if any.
    entityType: { type: String, enum: ['post', 'comment', null], default: null },
    entity: { type: mongoose.Schema.Types.ObjectId, default: null },

    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The only read path: "my notifications, newest first", keyset-paginated.
notificationSchema.index({ recipient: 1, _id: -1 });

/**
 * A notification is worthless after a while and there are a great many of them —
 * they are the highest-volume collection in a social app. A TTL index lets Mongo
 * reclaim that space on its own, instead of the collection growing forever and
 * an ops engineer eventually being paged about disk.
 */
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

notificationSchema.set('toJSON', { virtuals: true });

export const Notification = mongoose.model('Notification', notificationSchema);
