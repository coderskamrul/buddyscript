# Buddy Script

The supplied Login / Register / Feed HTML pages, rebuilt as a React + Tailwind
application on an Express + MongoDB backend.

```
├── client/          React 18 + Vite + Tailwind
├── server/          Express + Mongoose (MongoDB Atlas)
├── legacy-html/     the original HTML, kept for reference
├── assets/          the original design assets (also copied to client/public)
└── .env             config (already points at the provided Atlas cluster)
```

## Running it

`.env` is not in the repo (it holds the database credentials and JWT keys), so
create it first:

```bash
cp .env.example .env      # then fill in MONGODB_URI and the two JWT secrets
```

Then, in two terminals from the repository root:

```bash
# 1. API  → http://localhost:5000
cd server && npm install && npm run seed && npm run dev

# 2. App  → http://localhost:5173
cd client && npm install && npm run dev
```

The design's stylesheets and images live in `client/public/assets/`, so Vite
serves them at `/assets/*` in both dev and production.

---

## Deploying (Vercel + Render)

The frontend goes to Vercel, the API to Render. They are wired together with a
**Vercel rewrite**, not with CORS — and that choice matters:

> Vercel proxies `/api/*` and `/uploads/*` through to the API, so the **browser
> only ever talks to one origin**. The httpOnly session cookies therefore stay
> first-party and `SameSite=Lax` keeps working. If the React app called the API's
> own domain directly, those cookies would be cross-site and the browser would
> silently drop them — every request would 401.

**1. API → Render.** Push the repo, then Render > New > Blueprint (it reads
[`render.yaml`](render.yaml)). Set the secrets it asks for in the dashboard:

```bash
MONGODB_URI          # your Atlas connection string
JWT_SECRET           # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_REFRESH_SECRET   # ...and a different one
```

**2. Frontend → Vercel.** Import the repo and set **Root Directory = `client`**.
Before deploying, open [`client/vercel.json`](client/vercel.json) and replace both
`https://REPLACE-ME.onrender.com` hosts with your Render URL.

### Two caveats worth knowing up front

- **Uploaded images do not survive a redeploy.** Render's free tier has an
  ephemeral filesystem, so `server/uploads` is wiped on every deploy and on
  free-tier idle spin-down. Text posts are fine (they're in MongoDB); images
  vanish. Fix it by attaching a persistent disk (the commented-out `disk:` block
  in `render.yaml`, a paid feature) and pointing `UPLOAD_DIR` at it — or by moving
  uploads to S3/Cloudinary, which is the right answer at any real scale anyway.
- **Render's free tier sleeps** after inactivity, so the first request after an
  idle period takes ~30s to wake the container.

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

Four collections. Posts, comments and likes are kept **separate** rather than
embedding likes/comments inside a post document.

```
users     { firstName, lastName, email (unique), password (bcrypt), sessions[] }
posts     { author→users, content, image, visibility, likeCount, commentCount }
comments  { post→posts, author→users, parent→comments|null, content,
            likeCount, replyCount }
likes     { user→users, targetType: 'post'|'comment', target }
```

**Why likes are their own collection.** An embedded `likes: []` array on a post
grows without bound — a viral post has millions of likers, which blows past
MongoDB's 16 MB document limit and drags the entire liker list over the wire on
every feed read. As a separate collection, post documents stay small and
"who liked this" becomes a paginated query.

**Indexes** (all created by `npm run seed` via `syncIndexes()`):

| Index | Serves |
| --- | --- |
| `posts { visibility: 1, _id: -1 }` | the public feed, newest-first |
| `posts { author: 1, _id: -1 }` | your own posts (incl. private) |
| `comments { post: 1, parent: 1, _id: -1 }` | a post's comments; a comment's replies |
| `likes { targetType, target, user }` **unique** | one like per user per target |
| `likes { targetType, target, _id: -1 }` | "who liked this", paginated |
| `likes { user, targetType, target }` | "did *I* like these?" for a whole page |

Each index leads with its equality fields and ends with the sort key, so MongoDB
satisfies both the filter and the ordering from the index alone.

---

## Designing for millions of posts and reads

**Cursor pagination, never `skip`.** `skip(n)` makes the server walk and discard
n documents, so page 50,000 of a million-post feed is a scan. An ObjectId encodes
its creation time, so `_id < cursor` sorted by `_id: -1` is both a correct "older
than this" filter and an index range seek — page 50,000 costs the same as page 1.
It's also *stable*: posts created while you scroll can't shift items across a page
boundary and show you the same post twice.

**Denormalized counters.** `likeCount` / `commentCount` / `replyCount` live on the
document and move by `$inc`. Rendering a feed of 10 posts must not fan out into
10 `countDocuments()` calls.

**No N+1 on like state.** The like/unlike state for an entire page is resolved in
*one* query (`{ user, targetType, target: { $in: ids } }`) rather than one query
per post — see `server/src/utils/likeState.js`.

**Lazy thread loading.** Comments load only when a thread is opened, and replies
only when expanded. A feed page costs one request, not eleven.

**Client-side.** `@tanstack/react-query` caches and dedupes; likes are optimistic
with rollback; `PostCard` is memoized so liking one post doesn't re-render fifty;
infinite scroll uses `IntersectionObserver` (not a scroll handler); feed images
are `loading="lazy"`.

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
- **Uploads** — mimetype allowlist, 5 MB cap, client filename discarded (it can
  carry `../` traversal or a double extension) and replaced with a random name;
  served with `X-Content-Type-Options: nosniff`.
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
| GET | `/api/posts` | `?cursor&limit&scope=all\|mine` |
| POST | `/api/posts` | multipart: `content`, `visibility`, `image` |
| PATCH / DELETE | `/api/posts/:id` | author only |
| GET / POST | `/api/posts/:id/comments` | `parentId` on POST makes it a reply |
| GET | `/api/comments/:id/replies` | |
| DELETE | `/api/comments/:id` | comment author, or the post's author |
| POST | `/api/likes/toggle` | `{ targetType, targetId }` — posts and comments |
| GET | `/api/likes` | `?targetType&targetId` — who liked it, paginated |

### Notes

- **Replies are capped at one level.** Replying to a reply attaches it to the same
  top-level comment. This matches the design and keeps a thread readable.
- **Like toggling is race-safe by construction.** Rather than check-then-write
  (which two fast clicks can both pass), the insert is attempted and the unique
  index arbitrates — a duplicate-key error *is* the signal that it was already
  liked.
- `MONGODB_DB` was empty in the provided `.env`; it's set to `buddyscript`.
