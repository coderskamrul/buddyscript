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

  mongoUri: required('MONGODB_URI'),
  mongoDb: process.env.MONGODB_DB || 'buddyscript',

  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // Overridable so a host can point uploads at a mounted persistent disk
  // (Render/Railway volumes) instead of the ephemeral container filesystem.
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.resolve(__dirname, '../../uploads'),
  maxUploadBytes: 5 * 1024 * 1024,
};
