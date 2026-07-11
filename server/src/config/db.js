import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  // Fail fast instead of buffering queries forever when the cluster is unreachable.
  mongoose.set('bufferCommands', false);

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDb,
    // A bounded pool keeps a burst of feed reads from exhausting Atlas connections.
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log(`[db] connected to ${env.mongoDb}`);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
}
