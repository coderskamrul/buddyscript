# Buddy Script

The supplied Login / Register / Feed HTML pages, rebuilt as a React + Tailwind
application on an Express + MongoDB backend.

```text
├── client/            React 18 + Vite + Tailwind
├── server/            Express + Mongoose (MongoDB Atlas) + Redis + BullMQ
├── legacy-html/       the original HTML, kept for reference
├── assets/            the original design assets (also copied to client/public)
├── DOCUMENTATION.md   what was built, and every decision behind it
├── ARCHITECTURE.md    how it scales to millions of users, and why
└── .env               config (already points at the provided Atlas cluster)
```

## The three documents

| | |
| --- | --- |
| 📘 **[DOCUMENTATION.md](DOCUMENTATION.md)** | **Start here — the complete project document.** Overview, stack, features, architecture, data model, indexing, caching, queues, feed generation, scaling, security, setup, API reference, design decisions and trade-offs, future improvements. |
| 📐 **[ARCHITECTURE.md](ARCHITECTURE.md)** | Supplementary deep-dive on the system design and its failure modes. |
| 📗 **README.md** (this file) | How to run it, how to deploy it, and how the supplied design was handled. |

## Running it

`.env` is not in the repo (it holds the database credentials and JWT keys), so
create it first:

```bash
cp .env.example .env      # then fill in MONGODB_URI and the two JWT secrets
```

Then, from the repository root:

```bash
# 1. API  → http://localhost:5000
cd server && npm install && npm run seed && npm run dev

# 2. App  → http://localhost:5173
cd client && npm install && npm run dev
```

The design's stylesheets and images live in `client/public/assets/`, so Vite
serves them at `/assets/*` in both dev and production.

### Redis and the background worker

Redis powers the cache, the rate limiter, the materialized feed timelines and the
job queues. **It is optional in development and required in production.**

Without a `REDIS_URL` the app boots in **degraded mode** — the cache is a no-op,
rate limits are per-process, and background jobs are dropped — and says so loudly
at startup. That is fine for working on the UI, and nothing else.

To run the real thing:

```bash
brew install redis && redis-server          # or: docker run -p 6379:6379 redis

# then, in a THIRD terminal — the background workers are a separate process
cd server && npm run worker:dev
```

The worker is what consumes the queues: feed fan-out, notifications, and image
variant generation. Without it, posts and likes still work — the jobs simply queue
up in Redis and drain the moment a worker appears.

| Command | What it does |
|---|---|
| `npm run dev` | the API |
| `npm run worker:dev` | the job consumers (fan-out, notifications, media) |
| `npm run indexes` | build/sync MongoDB indexes — a **deploy step**, not a boot step |
| `npm run seed` | seed the database |

---

## Deploying

Two Vercel projects from one repo — the frontend and the API — wired together
with a **Vercel rewrite**, not with CORS. That choice is load-bearing:

> The frontend proxies `/api/*` through to the API project, so the **browser only
> ever talks to one origin**. The httpOnly session cookies therefore stay
> first-party and `SameSite=Lax` keeps working. If the React app called the API's
> own `*.vercel.app` domain directly, those cookies would be cross-site and the
> browser would silently drop them — every request would 401. So the API's domain
> is something only Vercel's edge ever dials, never the browser.

**1. API.** New project, **Root Directory = `server`**. It picks up
[`server/vercel.json`](server/vercel.json), which routes every path to the one
function in [`server/api/index.js`](server/api/index.js).

Set all of these in the project's Environment settings — the server throws on the
first missing one and the deploy fails before it can serve anything:

```bash
MONGODB_URI            # your Atlas connection string
MONGODB_DB             # buddyscript
JWT_SECRET             # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_REFRESH_SECRET     # ...and a different one
CLIENT_ORIGIN          # https://<your-frontend>.vercel.app
CLOUDINARY_CLOUD_NAME  # \
CLOUDINARY_API_KEY     #  } from cloudinary.com > Dashboard
CLOUDINARY_API_SECRET  # /
```

Atlas also has an IP allowlist, and serverless functions have no fixed egress IP.
Allow `0.0.0.0/0`, or nothing will connect.

**2. Frontend.** New project, **Root Directory = `client`**. Point the rewrite in
[`client/vercel.json`](client/vercel.json) at the API project's domain.

### Why the API needs its own entrypoint

A serverless function must default-export a handler. `src/app.js` exports a
*factory*, and `src/server.js` calls `app.listen()` — neither is a handler, and
pointing Vercel at either fails with *"the default export must be a function or
server"*. `api/index.js` is the seam that adapts one to the other; nothing else
about the app changes, and `npm run dev` still runs a normal long-lived server.

The one thing serverless genuinely changes is the database. Many short-lived
instances run side by side and each opens a pool of its own, so the pool is sized
down (and the connection memoized across warm invocations) when `VERCEL` is set —
see [`config/db.js`](server/src/config/db.js).

### Caveats

- **Rate limits are per-instance.** `express-rate-limit` counts in memory, and
  serverless memory isn't shared, so the effective limit is looser than the
  configured one. A real deployment wants a shared store (Redis/Upstash).
- **Cold starts.** The first request after an idle period pays for the Mongo dial.
- **Pre-Cloudinary `/uploads` images 404 in production.** `server/uploads` is
  gitignored, so it was never deployed, and nothing writes to a serverless
  filesystem anyway. Only posts made before the Cloudinary switch are affected.

### Rotate the credentials

The `.env` in this repo's history was shared during development. Before making
anything public, rotate the Atlas database password and generate fresh JWT
secrets — the old ones should be considered compromised.

`npm run seed` is optional but recommended — it creates four users, five posts
(one private), comments, replies and likes so the feed has something in it.

**Demo login:** `demo@buddyscript.dev` / `Passw0rd123`

The Vite dev server proxies `/api` and `/uploads` to the API, so the browser
talks to a single origin and the auth cookies are first-party.

---

## How the design was handled

The brief says *"stick to the provided design"*, and that design is built on the
supplied Bootstrap grid plus `common.css` / `main.css` / `responsive.css`. Those
stylesheets are therefore kept **verbatim** and linked from `client/index.html`;
the JSX reuses their original class names (`_feed_inner_timeline_post_area`,
`_comment_main`, …), so the page renders exactly as authored.

Tailwind is layered on top with **preflight, `.container` and `.visibility`
disabled** — each of those collides with a class the design already relies on —
and is used only for UI the supplied HTML never had:

> Worth knowing if you extend this: Tailwind and Bootstrap share two class names,
> `.container` and `.collapse`. Tailwind loads last, so its `.collapse`
> (`visibility: collapse`) silently made the *entire navbar* invisible until the
> `visibility` core plugin was disabled. If you add a Tailwind plugin, check it
> doesn't reintroduce a name Bootstrap already owns.

| New UI | Why it didn't exist before |
| --- | --- |
| Public / "Only me" selector | the design has no privacy control |
| "Who liked this" modal | requirement, no markup for it |
| Image preview + remove | the composer's Photo button was decorative |
| Feed tabs (All / My posts) | private posts are invisible in "All" without it |
| Toasts, skeletons, delete confirm | no feedback/loading states in the design |

Three deliberate deviations, all forced by the brief:

1. **Registration gained First name / Last name fields.** The supplied form only
   had email + password, but the brief requires both names. They use the design's
   own input classes.
2. **Google sign-in, "Forgot password" and "Remember me" are rendered but
   disabled.** The brief scopes them out; they're kept for design fidelity with a
   tooltip explaining why, rather than left as buttons that silently do nothing.
3. **Two CSS rules were added** (`client/src/index.css`) to fix a latent bug in
   the template: the comment bubble is `max-width: fit-content` with the
   Like/Reply row absolutely positioned beneath it, which only looked right
   because the mockup's one comment was a long paragraph. A short real comment
   ("Nice!") made that row wrap onto two lines.

Also fixed: the left sidebar's event card had an `<a>` nested inside an `<a>` —
invalid HTML that React warns about. The inner one is now a `<span>` (same class,
identical rendering).

---

## Data model

Six collections. Posts, comments, likes and follows are all kept **separate**
rather than embedded as arrays on a parent document.

```text
users         { firstName, lastName, email (unique), password (bcrypt),
                sessions[], followerCount, followingCount }
posts         { author→users, content, image, visibility, likeCount, commentCount }
comments      { post→posts, author→users, parent→comments|null, content,
                likeCount, replyCount }
likes         { user→users, targetType: 'post'|'comment', target }
follows       { follower→users, following→users }
notifications { recipient→users, actor→users, type, entityType, entity, readAt }
```

`posts.image` holds a **Cloudinary file name and nothing else** — see
[Images](#images).

**Why likes are their own collection.** An embedded `likes: []` array on a post
grows without bound — a viral post has millions of likers, which blows past
MongoDB's 16 MB document limit and drags the entire liker list over the wire on
every feed read. As a separate collection, post documents stay small and
"who liked this" becomes a paginated query.

**Indexes** — built by `npm run indexes` (a deploy step, not a boot step; see
[ARCHITECTURE.md §8](ARCHITECTURE.md#8-database-indexing-strategy)):

| Index | Serves |
| --- | --- |
| `posts { visibility: 1, _id: -1 }` | the public discovery feed, newest-first |
| `posts { author: 1, _id: -1 }` | your own posts (incl. private) |
| `posts { author: 1, visibility: 1, _id: -1 }` | the **celebrity pull** on every home-timeline read |
| `comments { post: 1, parent: 1, _id: -1 }` | a post's comments; a comment's replies |
| `likes { targetType, target, user }` **unique** | one like per user per target |
| `likes { targetType, target, _id: -1 }` | "who liked this", paginated |
| `likes { user, targetType, target }` | "did *I* like these?" for a whole page |
| `follows { follower, following }` **unique** | one edge per pair |
| `follows { following: 1, _id: 1 }` | the **fan-out walk** — batched, keyset-paged |
| `follows { follower: 1, _id: -1 }` | "who am I following" |
| `notifications { recipient: 1, _id: -1 }` | "my notifications" |
| `notifications { createdAt: 1 }` **TTL 30d** | Mongo reclaims the space itself |

Each index leads with its equality fields and ends with the sort key, so MongoDB
satisfies both the filter and the ordering from the index alone.

---

## Images

Post images go to **Cloudinary** and are served from its CDN. The API server
never writes them to its own disk, which is what removes the old "uploads are
wiped on every redeploy" failure mode — the container is now stateless.

**The database stores only the file name.** Not a URL, not a path:

```text
posts.image = "l2d1bnbmsxv3yz5qpbfx"        // 20 bytes
              ↓  resolved against CLOUDINARY_FOLDER + CLOUDINARY_CLOUD_NAME
https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto,c_limit,w_1200/buddyscript/posts/l2d1bnbmsxv3yz5qpbfx
```

The host, the folder and the transformation are *configuration*, not data. Baking
them into every row would mean that changing CDN, renaming the folder or retuning
the delivery transformation becomes a migration over every post ever written —
and would store the same ~100-byte prefix a million times over. Keeping the row
down to the name makes all three a config edit.

**Client and server derive that URL from the same formula**, in
[`server/src/services/postImage.service.js`](server/src/services/postImage.service.js) and its
mirror [`client/src/utils/cloudinary.js`](client/src/utils/cloudinary.js). They
must agree, so a change to one belongs in the other. The API therefore sends both:

| Field | | |
| --- | --- | --- |
| `image` | a ready-to-use URL | so a client needs no Cloudinary knowledge to render a post |
| `imageId` | the bare file name | so a client that *has* that knowledge can ask for its own width |

That second field is what lets the browser build a `srcSet`. Only the browser
knows its viewport and pixel density, so only the browser can pick the right file:

- **On ingest**, the image is downscaled once to fit 1600px. A 12MP phone photo is
  never stored at 12MP, so we pay for pixels nobody will see exactly zero times
  rather than on every read. Re-encoding also strips EXIF — which carries the GPS
  coordinates the photo was taken at.
- **On delivery**, `f_auto` negotiates the format and `q_auto` the quality. The
  seed's 1194 KB PNG reaches a modern browser as **28 KB of WebP** at the width
  the feed actually paints it.
- `c_limit` never upscales past the stored asset, and names are unique and never
  overwritten — so a URL always resolves to the same bytes, and can be cached
  immutably and forever. That is why there is no version component in it.

**Posts written before this change still render.** The seed's
`/assets/images/timeline_img.png` and any older `/uploads/…` row hold a *path*,
and a Cloudinary name never starts with `/` — so the leading slash is the
discriminator. Those pass through untouched (and get no `imageId`, so no
`srcSet`). `/uploads` is still served read-only for them; nothing writes there.

---

## Designing for millions of posts and reads

The full reasoning — with the trade-offs each choice cost — is in
**[ARCHITECTURE.md](ARCHITECTURE.md)**. The short version:

**Cursor pagination, never `skip`.** `skip(n)` makes the server walk and discard
n documents, so page 50,000 of a million-post feed is a scan. An ObjectId encodes
its creation time, so `_id < cursor` sorted by `_id: -1` is both a correct "older
than this" filter and an index range seek — page 50,000 costs the same as page 1.
It's also *stable*: posts created while you scroll can't shift items across a page
boundary and show you the same post twice.

**Hybrid fan-out.** Posts by ordinary users are *pushed* into their followers'
Redis timelines by a background worker; posts by users above the celebrity
threshold are *pulled* and merged at read time. A user with a million followers
therefore generates **zero** timeline writes when they post, and their post still
reaches every feed. ([§4–5](ARCHITECTURE.md#5-the-1000000-follower-problem))

**Redis cache, split by lifetime.** Feed pages cache ordered post *ids*; the post
*bodies* are cached separately under `post:{id}`. So a post on ten thousand feeds
is stored once, and editing it is a single `DEL`. Every cache call **fails open** —
if Redis is down the site is slower, not broken. ([§6](ARCHITECTURE.md#6-redis-caching-strategy))

**Denormalized counters.** `likeCount` / `commentCount` / `replyCount` /
`followerCount` live on the document and move by `$inc`, clamped at zero by the
database itself. Rendering a feed of 10 posts must not fan out into 10
`countDocuments()` calls.

**No N+1 anywhere.** The like state for an entire page is resolved in *one*
index-covered query (`{ user, targetType, target: { $in: ids } }`), and the liker
previews for the page in *one* aggregation — not one query per post. See
`server/src/repositories/like.repository.js`.

**Heavy work is queued, never done in the request.** Fan-out, notifications and
image-variant generation run in a separate worker process (`npm run worker`), so
posting takes ~50ms whether you have three followers or three million.
([§7](ARCHITECTURE.md#7-queue-architecture))

**Stateless API.** No sessions, rate-limit counters, cached feeds or in-flight jobs
live in an Express process — they are all in Redis. Any container can serve any
request, so scaling out means adding containers.
([§9](ARCHITECTURE.md#9-horizontal-scaling))

**Images never touch the API server.** They stream from multer's memory buffer
straight to Cloudinary and are read back from its CDN, so serving a viral post's
image costs the Express process nothing — no disk, no bandwidth, no state.

**Client-side.** `@tanstack/react-query` caches and dedupes; likes are optimistic
with rollback; `PostCard` is memoized so liking one post doesn't re-render fifty;
infinite scroll uses `IntersectionObserver` (not a scroll handler); feed images
are `loading="lazy"` and carry a `srcSet` so a phone downloads the 400px file
rather than the 1200px one.

---

## Security

- **Passwords** — bcrypt, cost 12, `select: false` so a stray query can't leak
  hashes.
- **JWT in httpOnly cookies**, not `localStorage` — an XSS payload has no token to
  steal. `sameSite=lax` is what protects the state-changing routes from CSRF.
- **Rotating refresh tokens**, stored **hashed** in the DB. Using one invalidates
  it, so a stolen refresh token can't be replayed, and logout genuinely revokes
  the session instead of just clearing a cookie.
- **Login is timing-safe and non-enumerating** — an unknown email still runs a
  full bcrypt comparison against a dummy hash, and both failure modes return the
  same message.
- **Authorization is enforced server-side on every route.** The author of a post
  is always `req.user`, never a value from the request body.
- **Mass assignment is impossible** — Zod strips unknown keys, so
  `{ author, likeCount: 9999 }` is dropped rather than assigned.
- **Private posts are filtered in the database query**, not after the fact, and a
  private post you don't own returns *404, not 403* — a 403 would confirm it
  exists. This holds for reading it, commenting on it, and liking it.
- **Uploads** — 5 MB cap and a mimetype allowlist, but the mimetype is a
  *client-supplied header*, so the control that actually holds is Cloudinary's
  `resource_type: 'image'`, which decodes the bytes and rejects anything that
  isn't a real image. The client's filename is discarded (it can carry `../`
  traversal or a double extension `evil.php.png`) — Cloudinary mints a random
  name, and `overwrite: false` means one upload can never clobber another's
  asset. Images are served from Cloudinary's own domain, so a crafted file could
  not reach same-origin script even if it got through.
- Plus `helmet`, CORS with an origin allowlist, and rate limits (tight on
  `/auth`, looser on writes).

---

## Verification

Both suites were run against the live Atlas cluster and a real headless browser.

- `33/33` API checks — privacy rules, authorization, like/unlike, comments,
  replies, counters, refresh/logout, cursor pagination, mass-assignment, upload
  validation.
- `14/14` browser checks driving the real UI — register → post → like → who-liked
  → comment → reply → like a comment → private post → My posts → dark mode →
  logout → protected route, with zero console errors.

---

## API

All routes require a session except `register` / `login` / `refresh`.

| Method | Route | |
| --- | --- | --- |
| POST | `/api/auth/register` | first/last name, email, password |
| POST | `/api/auth/login` | |
| POST | `/api/auth/refresh` | rotates the refresh token |
| POST | `/api/auth/logout` | revokes the session server-side |
| GET | `/api/auth/me` | |
| GET | `/api/posts` | the **discovery** feed: `?cursor&limit&scope=all\|mine` |
| POST | `/api/posts` | multipart: `content`, `visibility`, `image` |
| PATCH / DELETE | `/api/posts/:id` | author only |
| GET | `/api/feed` | the **home timeline** — hybrid fan-out, `?cursor&limit` |
| POST / DELETE | `/api/follows/:id` | follow / unfollow a user |
| GET | `/api/follows/:id/followers` | paginated |
| GET / POST | `/api/posts/:id/comments` | `parentId` on POST makes it a reply |
| GET | `/api/comments/:id/replies` | |
| DELETE | `/api/comments/:id` | comment author, or the post's author |
| POST | `/api/likes/toggle` | `{ targetType, targetId }` — posts and comments |
| GET | `/api/likes` | `?targetType&targetId` — who liked it, paginated |

**Two feeds, deliberately.** `/api/posts` is the global discovery feed (everything
public, newest first) and is what the React client renders — its contract is
unchanged by the refactor. `/api/feed` is the follower-graph home timeline, built
by the hybrid push/pull fan-out described in
[ARCHITECTURE.md §4](ARCHITECTURE.md#4-feed-generation-fan-out-on-write-vs-fan-out-on-read).
They answer genuinely different questions ("what is happening" vs. "what are the
people I follow saying"), and every social product ships both. The response shape
is identical, so the client's `useFeed` hook can point at either by changing one
URL.

### Notes

- **Replies are capped at one level.** Replying to a reply attaches it to the same
  top-level comment. This matches the design and keeps a thread readable.
- **Like toggling is race-safe by construction.** Rather than check-then-write
  (which two fast clicks can both pass), the insert is attempted and the unique
  index arbitrates — a duplicate-key error *is* the signal that it was already
  liked.
- `MONGODB_DB` was empty in the provided `.env`; it's set to `buddyscript`.
