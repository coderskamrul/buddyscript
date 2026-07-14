import multer from 'multer';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
}

/**
 * Translates the exception vocabulary of every library we depend on into ONE
 * response shape. A client should never have to know that a duplicate email
 * surfaces as a MongoServerError with `code: 11000`, or that an oversized upload
 * is a MulterError — those are our implementation leaking, and they would become
 * a breaking change the day we swapped a library out.
 */
function normalize(err) {
  if (err instanceof ApiError) {
    return { statusCode: err.statusCode, message: err.message, details: err.details };
  }

  if (err instanceof multer.MulterError) {
    return {
      statusCode: 400,
      message:
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Image is too large. Maximum size is 5MB.'
          : 'Image upload failed.',
    };
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: 400,
      message: 'Some fields are invalid.',
      details: Object.fromEntries(
        Object.entries(err.errors || {}).map(([key, value]) => [key, value.message])
      ),
    };
  }

  if (err instanceof mongoose.Error.CastError) {
    return { statusCode: 400, message: 'Malformed identifier.' };
  }

  if (err.code === 11000) {
    return { statusCode: 409, message: 'That record already exists.' };
  }

  // Anything that reaches here is a bug, not a rejected request.
  return { statusCode: err.statusCode ?? 500, message: err.message };
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, _next) {
  const { statusCode, message, details } = normalize(err);

  /**
   * The log carries the FULL error — stack, cause, the lot — and the request id
   * that ties it to the user who hit it. The RESPONSE carries only what is safe to
   * say out loud. Those two audiences want different things and confusing them is
   * how a stack trace, a driver error naming your collections, or a connection
   * string ends up on a stranger's screen.
   */
  const log = req.log ?? logger;

  if (statusCode >= 500) {
    log.error({ err, statusCode }, 'request failed');
  } else {
    // Expected rejections — a 401, a validation failure. Worth having, not worth
    // a stack trace or a page in the middle of the night.
    log.warn({ statusCode, message }, 'request rejected');
  }

  res.status(statusCode).json({
    success: false,
    // In production a 500's real message is never echoed: it is written by a
    // library we do not control and can name internals we would rather not
    // publish. Below 500 the message is ours, and is meant for the user.
    message:
      statusCode >= 500 && env.isProd
        ? 'Something went wrong on our end.'
        : message || 'Something went wrong.',
    ...(details ? { errors: details } : {}),
    // Hand the correlation id to the client, so a bug report can name the exact
    // request instead of describing it.
    requestId: req.id,
  });
}
