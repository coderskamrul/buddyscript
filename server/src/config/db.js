import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * Serverless runs many short-lived instances side by side, and each one that
 * dials Atlas opens a pool of its own. A pool sized for a single long-lived
 * container (50) would therefore be multiplied by however many instances Vercel
 * happens to have warm, and a burst of traffic could exhaust the cluster's
 * connection limit — so each instance gets a small pool, and holds no idle
 * connections open when nothing is in flight.
 */
const POOL = env.isServerless
  ? { maxPoolSize: 10, minPoolSize: 0 }
  : { maxPoolSize: 50, minPoolSize: 5 };

/**
 * Cached on `globalThis`, not in a module variable, because Vercel can reuse an
 * instance while re-evaluating modules — and a second `connect()` on a warm
 * instance would leak the first pool rather than replace it.
 */
const cache = (globalThis.__buddyscriptMongo ??= { promise: null });

export function connectDatabase() {
  // Returns the *promise*, so concurrent callers on a cold start all wait on one
  // dial instead of each opening a connection of their own.
  cache.promise ??= (async () => {
    mongoose.set('strictQuery', true);
    // Fail fast instead of buffering queries forever when the cluster is
    // unreachable. The serverless handler awaits this promise before it lets a
    // request reach Express, so nothing can query an unconnected Mongoose.
    mongoose.set('bufferCommands', false);

    await mongoose.connect(env.mongoUri, {
      dbName: env.mongoDb,
      ...POOL,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log(`[db] connected to ${env.mongoDb}`);
    return mongoose.connection;
  })().catch((error) => {
    // A failed dial must not be memoized, or every later request on this
    // instance would be handed the same rejection without ever retrying.
    cache.promise = null;
    throw error;
  });

  return cache.promise;
}

export async function disconnectDatabase() {
  cache.promise = null;
  await mongoose.connection.close();
}
