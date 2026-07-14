import crypto from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger, runWithContext } from '../config/logger.js';

/**
 * REQUEST LOGGING, and the correlation id that makes it useful.
 *
 * Every request gets an id. It goes into every log line the request produces — in
 * the API and, because it is passed along in the job payload's context, in the
 * worker that finishes the job afterwards. It also goes back to the client in
 * `X-Request-Id`.
 *
 * That last part is the payoff. A user says "it failed at about 3pm", and instead
 * of grepping twenty containers for a plausible-looking stack trace, you ask for
 * the id in the response and get the exact request: every query it ran, every
 * cache miss, every job it enqueued, in order, across services.
 */
export const requestLogger = pinoHttp({
  logger,

  // Honour an id from upstream (the load balancer or an API gateway may already
  // have minted one), so a single id spans the whole edge-to-database path rather
  // than restarting at our door.
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = existing || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },

  /**
   * Log LEVEL by outcome. Without this, every 404 from a bot probing for
   * /wp-admin.php is an ERROR, and a log full of errors that do not matter is a
   * log nobody reads — which is how the one that does matter gets missed.
   */
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Health checks fire every few seconds forever and are pure noise.
    return 'info';
  },

  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },

  // Trim the serialized request/response down to what is actually diagnostic.
  // The default dumps every header on every line.
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      // Set by requireAuth, so it is only present once the request is
      // authenticated — which is exactly when it is worth having.
      userId: req.raw?.user?._id,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

/**
 * Binds the request's logger into AsyncLocalStorage, so a service or repository
 * three calls deep can `log()` and have the line carry the request id — without
 * a logger being threaded through every function signature between here and
 * there.
 */
export const requestContext = (req, _res, next) =>
  runWithContext({ logger: req.log, requestId: req.id }, next);
