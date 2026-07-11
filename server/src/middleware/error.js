import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, _req, res, _next) {
  let { statusCode = 500, message } = err;
  let details = err.details;

  if (err instanceof multer.MulterError) {
    statusCode = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large. Maximum size is 5MB.'
        : 'Image upload failed.';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Some fields are invalid.';
    details = Object.fromEntries(
      Object.entries(err.errors || {}).map(([key, value]) => [key, value.message])
    );
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Malformed identifier.';
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'That record already exists.';
  }

  if (statusCode >= 500) {
    console.error('[error]', err);
    // Never leak stack traces or driver internals to the client in production.
    if (env.isProd) message = 'Something went wrong on our end.';
  }

  res.status(statusCode).json({
    success: false,
    message: message || 'Something went wrong.',
    ...(details ? { errors: details } : {}),
  });
}
