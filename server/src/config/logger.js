import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { env } from './env.js';

/**
 * Structured logging.
 *
 * `console.log` produces a string. A string is fine for one server you are
 * watching in a terminal, and useless across twenty containers behind a load
 * balancer: you cannot filter it, group it, or alert on it. Pino emits one JSON
 * object per line, so "every 5xx on the feed route in the last hour, grouped by
 * user" is a query rather than a grep.
 */
export const logger = pino({
  level: env.log.level,
  base: { service: 'buddyscript-api', env: env.nodeEnv },

  // Secrets in logs are a breach waiting to be indexed by a log vendor. Redact
  // at the logger, not at each call site — a call site can be forgotten.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },

  transport: env.log.pretty
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

/**
 * Carries the current request's id through the call stack without every
 * function having to accept a `logger` argument.
 *
 * The alternative is threading a request-scoped logger from the controller down
 * through the service and into the repository, which pollutes every signature in
 * the codebase with a logging concern. AsyncLocalStorage keeps the context
 * ambient: a repository can log, and the line still carries the request id that
 * ties it to the user-facing request that caused it.
 */
const store = new AsyncLocalStorage();

export const runWithContext = (context, fn) => store.run(context, fn);

/**
 * The logger to use everywhere. Inside a request it is bound to that request's
 * id; outside one (a worker job, a startup step) it is the plain root logger.
 */
export function log() {
  const context = store.getStore();
  return context?.logger ?? logger;
}
