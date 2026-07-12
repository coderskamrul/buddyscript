import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The .env lives at the repository root, one level above /server.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Vercel sets this in every serverless invocation. It changes what a "good"
  // connection pool looks like — see config/db.js.
  isServerless: Boolean(process.env.VERCEL),

  mongoUri: required('MONGODB_URI'),
  mongoDb: process.env.MONGODB_DB || 'buddyscript',

  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  cloudinary: {
    cloudName: required('CLOUDINARY_CLOUD_NAME'),
    apiKey: required('CLOUDINARY_API_KEY'),
    apiSecret: required('CLOUDINARY_API_SECRET'),
    // Every post image lands in this one folder, which is what lets the database
    // store a bare file name instead of a path or a URL.
    folder: process.env.CLOUDINARY_FOLDER || 'buddyscript/posts',
  },
  maxUploadBytes: 5 * 1024 * 1024,

  // Post images now go to Cloudinary. This directory is only still served so
  // that posts uploaded before that move keep rendering; nothing writes to it.
  legacyUploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.resolve(__dirname, '../../uploads'),
};
