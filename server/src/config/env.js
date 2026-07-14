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

const int = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${key} must be an integer.`);
  return parsed;
};

const bool = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

/**
 * Redis is REQUIRED in production and OPTIONAL in development.
 *
 * In production it is load-bearing — the rate limiter, the cache and the queues
 * all live in it, and running without it would silently drop us back to
 * per-instance state that is wrong the moment there is more than one instance.
 * A production boot with no REDIS_URL therefore fails loudly, right here.
 *
 * In development, demanding a running Redis just to read the feed would make the
 * project harder to run than it has to be. With no URL the app boots in
 * DEGRADED MODE: the cache is a no-op, the rate limiter falls back to in-memory,
 * and queued jobs run inline. Each of those is announced at startup, so degraded
 * mode can never be mistaken for the real thing.
 */
const redisUrl = process.env.REDIS_URL || (isProd ? required('REDIS_URL') : null);

export const env = {
  port: int('PORT', 5000),
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',

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

  redis: {
    url: redisUrl,
    enabled: Boolean(redisUrl),
    // Every key this app writes is prefixed, so a single Redis can host several
    // environments without them reading each other's cache.
    keyPrefix: process.env.REDIS_KEY_PREFIX || `bs:${nodeEnv}:`,
  },

  cache: {
    // A keyset page below the head is a STABLE WINDOW — under `sort({_id: -1})`
    // no future write can ever enter it — so it is safe to cache for minutes.
    // The head page is exactly where new posts land, so it gets seconds.
    // See services/cache.service.js.
    feedHeadTtl: int('CACHE_FEED_HEAD_TTL', 20),
    feedPageTtl: int('CACHE_FEED_PAGE_TTL', 300),
    postTtl: int('CACHE_POST_TTL', 600),
    userTtl: int('CACHE_USER_TTL', 300),
    // Which of the people you follow are celebrities: read on every timeline
    // request, changed only when you follow someone.
    followingTtl: int('CACHE_FOLLOWING_TTL', 300),
  },

  feed: {
    /**
     * The fan-out threshold. An author with FEWER followers than this has each
     * post PUSHED into every follower's materialized timeline on write; an author
     * with MORE has their posts PULLED at read time instead.
     *
     * The number is a cost trade. Pushing costs `followers` Redis writes once;
     * pulling costs one indexed Mongo query per read. Below the threshold the
     * write is cheap and the read is free. Above it, the write becomes a
     * millions-of-ops storm on behalf of followers who may never open the app.
     * See ARCHITECTURE.md, "Feed generation strategy".
     */
    celebrityThreshold: int('FEED_CELEBRITY_THRESHOLD', 10_000),

    // How many followers a single fan-out BATCH job handles. Keeps any one job
    // short (seconds, not minutes), so a worker restart re-does very little.
    fanoutBatchSize: int('FEED_FANOUT_BATCH_SIZE', 1_000),

    // A materialized timeline is a cache, not an archive. Nobody scrolls past
    // ~800 posts; beyond the cap, reads fall back to Mongo.
    timelineMaxLength: int('FEED_TIMELINE_MAX_LENGTH', 800),
  },

  rateLimit: {
    globalPerMinute: int('RATE_LIMIT_GLOBAL', 600),
    writePerMinute: int('RATE_LIMIT_WRITE', 60),
    authPer15Min: int('RATE_LIMIT_AUTH', 20),
  },

  log: {
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    // Human-readable locally; newline-delimited JSON in production, because that
    // is what a log aggregator can actually parse and index.
    pretty: bool('LOG_PRETTY', !isProd),
  },

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
