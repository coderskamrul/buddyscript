// Express 4 does not catch rejections from async handlers; without this wrapper
// a rejected promise becomes an unhandled rejection and the request hangs.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
