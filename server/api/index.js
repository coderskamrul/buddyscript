/**
 * The Vercel entrypoint.
 *
 * A serverless function must default-export a request handler; `src/app.js`
 * exports a *factory* (`createApp`), which is why pointing Vercel straight at it
 * fails with "the default export must be a function or server". `src/server.js`
 * is no use either — it calls `app.listen()`, and there is no port to listen on
 * here: the platform owns the socket and hands us one request at a time.
 *
 * So this file is the seam. Everything else about the app is unchanged, and
 * `npm run dev` still runs the long-lived server locally.
 */
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/db.js';

// Built once per instance, not once per request. A cold start pays for it; every
// warm invocation after that reuses it.
const app = createApp();

// `bufferCommands` is off (see config/db.js), so a query issued before Mongo is
// connected throws rather than queueing. The gate below is what guarantees that
// can't happen: nothing reaches Express until the connection resolves.
let connection = null;

export default async function handler(req, res) {
  try {
    // Cached across warm invocations, so only a cold start actually dials Atlas.
    connection ??= connectDatabase();
    await connection;
  } catch (error) {
    // Drop the memo, or one failed dial would be replayed as a permanent
    // failure by every subsequent request this instance ever serves.
    connection = null;
    console.error('[api] database unavailable:', error.message);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable.' });
  }

  // An Express app *is* a (req, res) handler, so it can be returned as one.
  return app(req, res);
}
