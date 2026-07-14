/**
 * `npm run indexes` — build/sync every index declared on the models.
 *
 * This is a DEPLOY STEP, not a boot step, and the distinction matters enough to
 * be worth a whole script.
 *
 * Mongoose's `autoIndex` defaults to true: every model calls `createIndex` on
 * every connection. On a laptop with 50 posts that is invisible. On a collection
 * with 50 million, an index build is minutes of heavy I/O — and with autoIndex on,
 * EVERY container does it, simultaneously, on every deploy and every autoscale
 * event. So it is turned off in production (config/db.js) and the build is done
 * once, deliberately, from here.
 *
 * `syncIndexes()` also DROPS indexes that are no longer declared in the schema.
 * That is what keeps this file honest — an index removed from a model is really
 * removed from the database, rather than lingering forever, slowing every write to
 * that collection, and being maintained by nobody because nobody remembers it.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { logger } from '../config/logger.js';

// Importing the models is what registers their schemas — and therefore their
// index declarations — with Mongoose.
import '../models/User.js';
import '../models/Post.js';
import '../models/Comment.js';
import '../models/Like.js';
import '../models/Follow.js';
import '../models/Notification.js';

async function main() {
  await connectDatabase();

  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    const dropped = await model.syncIndexes();

    const indexes = await model.collection.indexes();
    logger.info(
      {
        model: name,
        indexes: indexes.map((index) => index.name),
        dropped,
      },
      'indexes synced'
    );
  }

  await disconnectDatabase();
  logger.info('all indexes synced');
}

main().catch((error) => {
  logger.fatal({ err: error }, 'index sync failed');
  process.exit(1);
});
