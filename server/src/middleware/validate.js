import { ApiError } from '../utils/ApiError.js';

/**
 * Validates and *replaces* the request source with the parsed result, so
 * handlers can only ever read fields the schema declared. Anything the client
 * sent that the schema does not know about is dropped — this is what stops
 * mass-assignment (e.g. posting `{ likeCount: 9999 }` or `{ author: someoneElse }`).
 */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || 'form';
        if (!errors[key]) errors[key] = issue.message;
      }
      return next(ApiError.badRequest('Please check the highlighted fields.', errors));
    }

    if (source === 'query') {
      // req.query has only a getter in Express 5-style setups; mutate in place.
      Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true });
    } else {
      req[source] = result.data;
    }
    return next();
  };
