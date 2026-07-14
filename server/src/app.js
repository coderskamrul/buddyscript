import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import { env } from './config/env.js';
import { isRedisReady } from './config/redis.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestContext, requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import postRoutes from './routes/post.routes.js';
import commentRoutes from './routes/comment.routes.js';
import likeRoutes from './routes/like.routes.js';
import feedRoutes from './routes/feed.routes.js';
import followRoutes from './routes/follow.routes.js';

/**
 * THE STATELESS EXPRESS APP.
 *
 * Nothing that matters is kept in this process. No session store, no rate-limit
 * counters, no in-flight jobs, no uploaded bytes on disk, no cached feed in a
 * module-level Map. Every one of those lives in Mongo, in Redis, or in Cloudinary.
 *
 * That is the whole precondition for horizontal scaling, and it is a property you
 * have to keep rather than one you can add later: it means ANY of N containers can
 * serve ANY request (no sticky sessions), a container can be killed mid-deploy
 * without losing work, and the way to handle 10× the traffic is to run 10× the
 * containers. A single `Map` cached at module scope in this file — the most
 * natural optimisation in the world — would silently break all three.
 */
export function createApp() {
  const app = express();

  // Behind a proxy (Render/Nginx/an ALB) `req.ip` is the PROXY's address unless we
  // trust the forwarding header — and the rate limiter keys on it, so without this
  // every user on Earth would share one bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // First, so that every line logged by everything below it — including a request
  // rejected by the rate limiter — carries the request id.
  app.use(requestLogger);
  app.use(requestContext);

  app.use(
    helmet({
      // Legacy uploads are served from this origin and embedded by the client on
      // another (5173 in dev); the default same-origin policy would block them.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: env.clientOrigin,
      // Required for the browser to send/receive the httpOnly auth cookies.
      credentials: true,
    })
  );

  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser());
  app.use(globalLimiter);

  // New post images go to Cloudinary and are served from its CDN — nothing writes
  // here any more. This mount stays only so that posts created before that move
  // (and the one the seed script creates) don't turn into broken images.
  app.use(
    '/uploads',
    express.static(env.legacyUploadDir, {
      maxAge: '7d',
      immutable: true,
      // These are user-controlled bytes. Forbidding the browser to sniff and
      // render them defuses stored-XSS via a crafted file.
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );

  /**
   * The load balancer's health check. It reports Redis's state but does NOT go
   * unhealthy when Redis is down, and that distinction is deliberate: the app
   * degrades without Redis (slower — it reads Mongo) rather than failing. A health
   * check that fails on a Redis blip would have the load balancer pull EVERY
   * container out of rotation at once, converting a cache outage into a total one.
   */
  app.get('/api/health', (_req, res) =>
    res.json({
      success: true,
      status: 'ok',
      uptime: process.uptime(),
      redis: env.redis.enabled ? (isRedisReady() ? 'ready' : 'degraded') : 'disabled',
    })
  );

  // This is an API, so there is nothing to render at the root — but a bare 404
  // there reads as "the deployment is broken" to anyone who opens the URL in a
  // browser. Say what this host is instead.
  app.get('/', (_req, res) =>
    res.json({ success: true, service: 'buddyscript-api', health: '/api/health' })
  );

  app.use('/api/auth', authRoutes);
  // The global discovery feed. Unchanged — the existing client uses it as-is.
  app.use('/api/posts', postRoutes);
  // The follower-graph home timeline (hybrid fan-out).
  app.use('/api/feed', feedRoutes);
  app.use('/api/follows', followRoutes);
  app.use('/api/comments', commentRoutes);
  app.use('/api/likes', likeRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
