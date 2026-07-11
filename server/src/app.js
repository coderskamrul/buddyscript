import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';

import { env } from './config/env.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import postRoutes from './routes/post.routes.js';
import commentRoutes from './routes/comment.routes.js';
import likeRoutes from './routes/like.routes.js';

export function createApp() {
  const app = express();

  // Behind a proxy (Heroku/Nginx/Render) req.ip is the proxy's address unless we
  // trust the forwarding header — and the rate limiter keys on req.ip, so
  // without this every user would share one bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Uploads are served from this origin and embedded by the client on
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
  if (!env.isProd) app.use(morgan('dev'));
  app.use(globalLimiter);

  app.use(
    '/uploads',
    express.static(env.uploadDir, {
      maxAge: '7d',
      immutable: true,
      // Uploads are user-controlled bytes. Forcing a download instead of letting
      // the browser sniff and render them defuses stored-XSS via a crafted file.
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );

  app.get('/api/health', (_req, res) =>
    res.json({ success: true, status: 'ok', uptime: process.uptime() })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api/comments', commentRoutes);
  app.use('/api/likes', likeRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
