# BuddyScript — Project Documentation

A social feed application built on a production-scale architecture designed to serve
millions of users and reads.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Features Implemented](#3-features-implemented)
4. [Project Structure](#4-project-structure)
5. [System Architecture](#5-system-architecture)
6. [Request Flow](#6-request-flow)
7. [Data Model](#7-data-model)
8. [Database Indexing Strategy](#8-database-indexing-strategy)
9. [Pagination Strategy](#9-pagination-strategy)
10. [Redis Caching Strategy](#10-redis-caching-strategy)
11. [Background Job Architecture](#11-background-job-architecture)
12. [Feed Generation Strategy](#12-feed-generation-strategy)
13. [Handling a User With 1,000,000 Followers](#13-handling-a-user-with-1000000-followers)
14. [Horizontal Scaling](#14-horizontal-scaling)
15. [Rate Limiting](#15-rate-limiting)
16. [CDN and Media Handling](#16-cdn-and-media-handling)
17. [Security](#17-security)
18. [Error Handling and Structured Logging](#18-error-handling-and-structured-logging)
19. [Environment-Based Configuration](#19-environment-based-configuration)
20. [Setup and Running](#20-setup-and-running)
21. [Deployment](#21-deployment)
22. [API Reference](#22-api-reference)
23. [Verification and Testing](#23-verification-and-testing)
24. [Design Decisions and Trade-offs](#24-design-decisions-and-trade-offs)
25. [Future Improvements](#25-future-improvements)

---

## 1. Overview

BuddyScript is a social feed platform: users register, publish posts with images,
control post visibility, comment and reply, like posts and comments, and follow one
another to build a personalised timeline.

The supplied Login, Register and Feed HTML designs were rebuilt as a React
application on an Express and MongoDB backend. The backend was then architected for
production scale — Redis caching, cursor-based pagination, a layered
service/repository structure, asynchronous background jobs, and a hybrid feed fan-out
strategy capable of absorbing a post from a user with a million followers without
degrading response time.

The guiding principle throughout is that **reads dominate a social feed by roughly
100:1**, and that **follower counts follow a power law rather than a normal
distribution**. Almost every architectural decision in this document follows from one
of those two facts.

---

## 2. Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, React Router, TanStack Query, Tailwind CSS |
| API | Node.js 20+, Express 4, ES Modules |
| Database | MongoDB (Atlas) with Mongoose |
| Cache | Redis (ioredis) |
| Job Queue | BullMQ on Redis |
| Rate Limiting | express-rate-limit with a Redis store |
| Authentication | JWT access tokens + rotating refresh tokens, httpOnly cookies |
| Media Storage / CDN | Cloudinary |
| Validation | Zod |
| Logging | pino (structured JSON) + pino-http |

---

## 3. Features Implemented

### Authentication

- Registration, login, logout, and current-user (`/me`) endpoints.
- Passwords hashed with bcrypt (cost factor 12).
- Short-lived JWT access token plus a long-lived rotating refresh token, both
  delivered as httpOnly cookies.
- Logout revokes the session server-side; it does not merely clear a cookie.
- Multi-device sessions supported, capped at five per user.

### Posts

- Create, edit and delete posts, with an optional image.
- Visibility control: **Public** or **Only me**.
- Cursor-paginated feed.
- Image upload to Cloudinary with automatic optimisation and CDN delivery.

### Comments and Replies

- Comments on posts; replies threaded one level deep.
- Replies are loaded on demand rather than eagerly with the feed.
- Comment authors and post authors may both delete a comment.

### Likes

- Likes on both posts and comments.
- Paginated "who liked this" list.
- Stacked liker avatars on each post's reaction row.
- Idempotent under rapid double-clicks (enforced by a unique database index).

### Social Graph

- Follow and unfollow users.
- Paginated follower lists.
- Denormalised follower and following counts.

### Home Timeline

- A personalised feed of posts from followed users, assembled through a hybrid
  fan-out strategy (§12).

### Notifications (Infrastructure)

- Notification records written asynchronously by a background worker on like,
  comment, reply and follow events.
- No user-facing UI is exposed; the queue, worker, retry policy and data model are
  the deliverable, and they form the seam at which push delivery (APNs/FCM) would be
  added.

---

## 4. Project Structure

```text
.
├── client/                     React 18 + Vite + Tailwind
│   └── src/
│       ├── api/                Axios client and endpoint definitions
│       ├── components/         Feed, layout, auth and UI components
│       ├── context/            Auth context
│       ├── hooks/              TanStack Query hooks (feed, comments, likes)
│       ├── pages/              Login, Register, Feed
│       └── utils/              Cloudinary URL builder, formatters
│
├── server/
│   └── src/
│       ├── config/             env, mongo, redis, cloudinary, logger
│       ├── models/             Mongoose schemas and index declarations
│       ├── repositories/       Data access only (Mongo / Redis)
│       ├── services/           Business rules, caching, orchestration
│       ├── controllers/        HTTP only
│       ├── routes/             Routing, validation, rate limits
│       ├── middleware/         auth, validation, rate limit, logging, errors
│       ├── queues/             BullMQ queues, producers
│       │   └── workers/        fanout, notification, media
│       ├── validators/         Zod request schemas
│       ├── utils/              Pagination, tokens, error types
│       ├── scripts/            seed, syncIndexes
│       ├── app.js              Express application factory
│       ├── server.js           API process entry point
│       └── worker.js           Worker process entry point
│
├── render.yaml                 Deployment blueprint (API + worker + Redis)
└── .env.example                Configuration template
```

---

## 5. System Architecture

```text
                    ┌──────────────┐
   Browser ───────► │ CDN (static) │  React bundle, images (Cloudinary)
                    └──────────────┘
       │
       │ /api/*
       ▼
┌───────────────────┐
│   Load Balancer   │  round-robin; no sticky sessions required
└─────────┬─────────┘
          │
    ┌─────┴─────┬───────────┬─────────┐
    ▼           ▼           ▼         ▼
┌────────┐ ┌────────┐  ┌────────┐  ┌────────┐
│ API #1 │ │ API #2 │  │ API #3 │  │ API #N │   Express — stateless
└────┬───┘ └────┬───┘  └───┬────┘  └───┬────┘
     └──────────┴──────────┴───────────┘
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
   ┌─────────┐ ┌─────────┐  ┌──────────┐
   │  Redis  │ │ MongoDB │  │Cloudinary│
   │ cache   │ │ (truth) │  │  (CDN)   │
   │ queues  │ └─────────┘  └──────────┘
   │ limits  │
   │timelines│
   └────┬────┘
        │ jobs
        ▼
┌────────────────────┐
│  Worker Process(es)│  fan-out, notifications, media — scaled separately
└────────────────────┘
```

### Layered Backend

The backend enforces a single direction of dependency:

```text
Route → Middleware → Controller → Service → Repository → MongoDB / Redis
```

| Layer | Responsibility | Knows nothing about |
| --- | --- | --- |
| **Controller** | HTTP only: read the request, call a service, write the response | MongoDB, Redis, queues |
| **Service** | Business rules, authorisation, caching, orchestration, enqueueing | HTTP status codes, Express |
| **Repository** | Data access only | HTTP, business rules |

This separation is not cosmetic. It delivers three concrete properties:

- **The storage decision stops leaking.** Introducing read replicas or sharding the
  posts collection changes files in `repositories/` and nothing else, because no
  controller contains a database query to update.
- **Business rules are enforced exactly once.** The post-visibility rule ("a user
  sees all public posts, plus their own private posts") exists in a single function.
  It cannot be forgotten on a new endpoint, because every endpoint reaches the data
  through it.
- **Rules are testable without an HTTP server**, and reusable from anything that is
  not one — a background worker, a CLI, or a future GraphQL resolver.

### Two Processes

The system runs as two independently deployable and independently scalable
processes:

| Process | Command | Role |
| --- | --- | --- |
| **API** | `npm start` | Serves HTTP. Stateless. Scale on traffic. |
| **Worker** | `npm run worker` | Consumes job queues. Scale on fan-out load. |

They are separate because they fail differently and scale differently. A traffic
spike requires more API containers; a celebrity publishing a post requires more
fan-out workers. Combining them into one process means neither can be purchased
without the other — and a worker processing a thousand-batch fan-out would be doing
so on the event loop that is supposed to be answering HTTP requests.

---

## 6. Request Flow

The following traces `GET /api/feed` for a user who follows 200 accounts, two of
which are high-follower ("celebrity") accounts.

1. **Load balancer** routes to any API container. No sticky session is needed,
   because the container holds no session state.
2. **Request logger** assigns an `X-Request-Id` (or adopts one already set by the
   edge) and binds it into `AsyncLocalStorage`, so every subsequent log line — even
   from deep inside a repository — carries it.
3. **Global rate limiter** performs one Redis `INCR`. The counter is shared across
   all containers, so the limit is a property of the system rather than of one
   process.
4. **Authentication middleware** verifies the JWT with the shared secret. This
   involves **no database read and no session lookup**, which is what keeps the
   container stateless.
5. **Validation middleware** parses the query string with Zod and *replaces* it, so
   the handler can only read fields the schema declared. Unknown fields are dropped,
   which eliminates mass-assignment.
6. **Controller → Feed service:**
   - Read the cached follow-split (`follow:split:{userId}`) to determine which
     followed accounts are celebrities and which are not.
   - **Push half:** `LRANGE timeline:{userId}` returns post IDs already materialised
     by the fan-out worker. O(1).
   - **Pull half:** one indexed MongoDB query fetches recent posts by the two
     celebrity accounts.
   - Merge both ID lists, sort descending, and take the page.
7. **Hydration:** a single Redis `MGET` fetches the post bodies for the whole page.
   Any cache misses are resolved by **one** `$in` query against MongoDB — never one
   query per post.
8. **Personalisation:** one index-covered query resolves `likedByMe` for the entire
   page.
9. **Response**, followed by a single structured log line containing the status,
   duration and request ID.

**Total cost: approximately two Redis round trips and one to three MongoDB queries,
regardless of page size.** There are no N+1 query patterns anywhere in the read path.

---

## 7. Data Model

Six collections. Posts, comments, likes and follows are each stored as separate
collections rather than as embedded arrays on a parent document.

```text
users          { firstName, lastName, email (unique), password (bcrypt),
                 avatar, sessions[], followerCount, followingCount }

posts          { author→users, content, image, visibility,
                 likeCount, commentCount }

comments       { post→posts, author→users, parent→comments|null,
                 content, likeCount, replyCount }

likes          { user→users, targetType: 'post'|'comment', target }

follows        { follower→users, following→users }

notifications  { recipient→users, actor→users, type,
                 entityType, entity, readAt }
```

### Why likes, comments and follows are separate collections

An embedded array (`post.likes: [ObjectId]`) does not survive scale. A viral post has
millions of likers, which would:

- exceed MongoDB's 16 MB per-document limit;
- drag the entire liker list over the wire on every single feed read;
- cause write contention, as two concurrent likers contend on the same document.

As separate collections, post documents stay small, "who liked this" becomes a
paginated index scan, and a like is an O(1) insert that contends with nothing. The
identical reasoning applies to the follow graph: a user with a million followers
cannot have a million ObjectIds in an array field.

### Denormalised counters

`likeCount`, `commentCount`, `replyCount`, `followerCount` and `followingCount` are
maintained with `$inc`. Rendering a feed of twenty posts must never fan out into
twenty `countDocuments()` calls.

`followerCount` in particular is not a vanity field — it is a **routing decision**.
Every post creation must determine whether to push to followers or leave the post to
be pulled (§12), and that question must be answerable from one cheap document read
rather than a count across millions of edges.

All counters are **clamped at zero by the database itself**, using an
aggregation-pipeline update (`$max: [0, {$add: [...]}]`). A plain `$inc: -1` can drift
negative if a delete is ever replayed; this construction makes a negative count
impossible regardless of retries.

---

## 8. Database Indexing Strategy

Every index follows the **ESR rule: Equality → Sort → Range**.

Because every list query in the system is keyset-paginated (`sort({_id: -1})` with
`_id < cursor`), `_id` serves simultaneously as the sort key and the range key, and
therefore appears **last** in every compound index. This is what allows MongoDB to
satisfy a page as a bounded index seek with **no in-memory sort**, at identical cost
on page 50,000 and page 1.

| Collection | Index | Serves |
| --- | --- | --- |
| **posts** | `{ visibility: 1, _id: -1 }` | The public discovery feed |
| | `{ author: 1, _id: -1 }` | A user's own posts (public and private) |
| | `{ author: 1, visibility: 1, _id: -1 }` | The celebrity pull on every home-timeline read |
| **follows** | `{ follower: 1, following: 1 }` *(unique)* | One edge per pair; makes following idempotent |
| | `{ following: 1, _id: 1 }` | The fan-out walk — batched and keyset-paged |
| | `{ follower: 1, _id: -1 }` | "Who am I following" |
| **likes** | `{ targetType, target, user }` *(unique)* | The concurrency guarantee |
| | `{ targetType, target, _id: -1 }` | "Who liked this", paginated |
| | `{ user, targetType, target }` | Page-wide like state (covered index) |
| **comments** | `{ post: 1, parent: 1, _id: -1 }` | A post's comments; a comment's replies |
| **notifications** | `{ recipient: 1, _id: -1 }` | "My notifications" |
| | `{ createdAt: 1 }` *(TTL, 30 days)* | Automatic space reclamation |
| **users** | `{ email: 1 }` *(unique)* | Login |

### Three indexes worth explaining

**`likes { user, targetType, target }` is a covered index.** Every field the
like-state query needs is contained in the index itself, so MongoDB answers "which of
these ten posts has this viewer liked?" without touching a single document. This is
what makes `likedByMe` effectively free for an entire page.

**The unique index on `likes` is a concurrency control, not merely a constraint.** Two
rapid clicks both pass an application-level check-then-write and produce a double
like. Instead, the insert is attempted and the **database arbitrates**: a
duplicate-key error *is* the signal that the item was already liked. The race is
resolved by the storage engine rather than by application code hoping to win it. The
same pattern is used for follows.

**`follows { following: 1, _id: 1 }` is the index that must survive a million rows.**
Fan-out walks it in keyset batches, never re-reading a follower it has already
processed. Paginating this with `skip`/`limit` instead would make batch 1,000 scan and
discard the 999,000 rows preceding it — quadratic work on the hottest write path in
the system.

### Index builds are a deployment step, not a boot step

Mongoose's `autoIndex` is enabled by default, meaning every model issues `createIndex`
on every connection. On a collection of fifty documents this is invisible; on a
collection of fifty million it is minutes of heavy I/O on the primary — performed by
*every* container, on *every* deployment and *every* autoscale event, triggered by the
very traffic spike that caused the scale-out.

`autoIndex` is therefore disabled in production, and indexes are built once,
deliberately, via `npm run indexes`. That command uses `syncIndexes()`, which also
drops indexes no longer declared in the schema — so an index removed from a model is
genuinely removed from the database rather than lingering forever, slowing every write
to that collection.

---

## 9. Pagination Strategy

**Cursor-based (keyset) pagination is used throughout. `skip`/`offset` is used
nowhere.**

`skip(n)` requires the server to walk and discard n documents, so page 50,000 of a
million-post feed becomes a collection scan. Its cost grows linearly with page depth.

A MongoDB ObjectId encodes its creation timestamp in its leading four bytes.
Therefore `_id < cursor`, sorted by `_id: -1`, is simultaneously:

- a **correct** "older than this" filter, and
- an **index range seek** — so page 50,000 costs exactly what page 1 costs.

It is also **stable**. With offset pagination, posts created while a user scrolls
shift every subsequent item forward by one, causing the reader to see the same post
twice or to miss one entirely. A cursor anchors to a specific document, so new posts
cannot shift items across a page boundary.

Each query fetches `limit + 1` rows in order to report `hasMore` without a second
`count()` query, then trims the extra row before responding.

---

## 10. Redis Caching Strategy

### Governing principle

> **The cache must never be able to take the site down.**

A cache is an optimisation, and an optimisation capable of failing the request it was
meant to accelerate is a liability. Every cache operation therefore **fails open**: if
Redis is missing, unreachable, slow, or returns malformed data, the call behaves
exactly as a cache miss and the caller reads from MongoDB. A degraded site is slower;
a site whose cache can return a 500 is down.

As a corollary, **no cache write is ever awaited on a request's critical path**. The
user does not wait to populate a cache they have already been served around.

### Pattern: cache-aside (lazy loading)

```text
read → cache hit?  → return it
     → cache miss? → read MongoDB → populate cache → return
```

MongoDB remains the single source of truth and Redis is a **disposable accelerator**
that can be flushed at any moment without losing a byte of data. A read-through or
write-through cache would place Redis in the *write* path, where a Redis outage
becomes a write outage.

### What is cached

| Key | Contents | TTL | Invalidation |
| --- | --- | --- | --- |
| `post:{id}` | Post **body** — text, author, counters, liker preview | 10 min | Explicit `DEL` on edit, delete, like, comment |
| `feed:{scope}:{uid}:{cursor}:{limit}` | Ordered post **IDs only** | 20 s (head) / 5 min (deep) | TTL |
| `timeline:{uid}` | Materialised home timeline (list of post IDs) | 30 days | Fan-out worker |
| `follow:split:{uid}` | Which followed accounts are celebrities | 5 min | Explicit `DEL` on follow/unfollow |
| `rl:{limiter}:{key}` | Rate-limit counters | window | TTL |

### Key design decision: IDs and bodies are cached separately

**Feed pages cache post IDs. The post cache holds post bodies.** This is the single
most consequential decision in the caching design.

If a feed page cached the full post *bodies* inside it, a post appearing on 10,000
different feed pages would be stored 10,000 times — and correcting a single typo would
require locating and rewriting all 10,000 entries, which is not possible without
either a reverse index or a `SCAN` across the keyspace.

By separating them:

- a post is stored **once**, under `post:{id}`, no matter how many feeds it appears on;
- an edit is **one `DEL`**, and every feed page picks up the new body on its next
  hydration;
- a partial cache hit remains a win — eight of ten posts cached means one MongoDB query
  for two documents, not ten.

The same reasoning governs the fan-out timeline, which stores **IDs, not bodies**. A
post fanned out to a million followers at roughly 1 KB of JSON each would consume
**1 GB of Redis for a single post**, and every like would invalidate all million
copies. At 24 bytes per ID it consumes 24 MB, and a like invalidates exactly one shared
key.

> The timeline is an **index**: what should this user see, and in what order.
> The post cache is the **content**: what does this post actually say.
> They change on entirely different schedules, which is precisely why they must not be
> the same cache entry.

### Key design decision: shared data versus viewer-specific data

Every post is presented in two parts:

- **Shared** — content, author, counters. Identical for every viewer on earth, and
  therefore **cached once** and read by all of them.
- **Viewer-specific** — `likedByMe`, `isMine`. Different for every viewer, and
  therefore **never cached**.

Conflating the two is fatal at scale. If the fully rendered post — including
`likedByMe` — were cached, the cache key would have to include the viewer, so a post
appearing on a million feeds would require a million cache entries. That is an
enormous cache with an approximately 0% hit rate. Separated, one `post:{id}` entry
serves all million viewers, while the per-viewer fields cost a single batched,
index-covered query per page.

### TTL asymmetry: deep pages cache fifteen times longer

Under keyset pagination, **a page below the head is a stable window**. Every post it
can ever contain already exists — a newly created post receives a *higher* `_id`, so it
lands on the head page and cannot enter a lower one. The composition of page 40 is
therefore immutable.

Deep pages are consequently cached for **five minutes**, and the head page — where new
posts actually arrive — for **twenty seconds**.

This produces a fortunate result: **deep scrolling is simultaneously the most expensive
case and the most cacheable one.**

### Why the feed head is not explicitly invalidated

This is deliberate. The head page carries a twenty-second TTL. If every new post issued
a `DEL` against it, then on a busy site the head page would be evicted several times per
second, would never be warm, and every reader landing on it — which is most readers —
would fall through to MongoDB. The cache would perform no useful work while still
costing a round trip.

A twenty-second window in which the discovery feed does not yet display a five-second-old
post is not a defect; it is the definition of eventual consistency. The one person who
would notice — the author — does not, because the client splices their own new post onto
page one locally.

### Cache stampede protection

All TTLs are jittered by ±10%. Without jitter, a thousand keys written by the same
traffic burst all expire in the same second, every read misses simultaneously, and the
resulting herd stampedes MongoDB together — on a perfectly repeating cycle. Jitter
breaks the synchronisation.

---

## 11. Background Job Architecture

Implemented with **BullMQ on Redis**, consumed by a **separate worker process**
(`npm run worker`).

### The rule for what belongs on a queue

> **If the user does not need the result in order to render their next screen, it does
> not belong in their request.**

Creating a post requires exactly one thing to be true before the API can answer: the row
exists. Fanning the post out to followers, notifying them, and generating image variants
are all *consequences* of that write. None of them change the response. Performing them
inline would make the p99 latency of "publish a photo" a function of how many followers
the author has — meaning the most popular users would experience the slowest application.

### The three queues

| Queue | Jobs | Purpose |
| --- | --- | --- |
| `fanout` | `fanout-post`, `fanout-batch`, `fanout-retract` | Distribute a post into follower timelines; retract on delete |
| `notification` | `notify` | Persist notification records for likes, comments, replies, follows |
| `media` | `media-derive` | Pre-generate Cloudinary image variants |

### Reliability

- **Retries:** five attempts with exponential backoff starting at two seconds. The
  correct response to a transient failure is to retry *later* — retrying a database
  already under load merely adds to the load causing the failures.
- **Idempotency:** fan-out deduplicates on read, so at-least-once delivery is safe. This
  matters, because at-least-once is the strongest guarantee a distributed queue can
  actually provide.
- **Retention:** completed jobs are retained for one hour (sufficient to debug); failed
  jobs for seven days (sufficient to detect, investigate and replay). Retaining
  everything indefinitely would grow Redis without bound, and the queue would itself
  become the outage.
- **Graceful shutdown:** on SIGTERM, `worker.close()` drains in-flight jobs and stops
  accepting new ones, so a rolling deployment costs nothing rather than causing a stall
  and a redelivery.
- **Failed jobs are logged at `error` level with their full payload.** A job that has
  exhausted its retries is a genuine incident — a notification nobody received, or a
  cohort of followers who never received a post — and must be loud enough to alert on.
- **Enqueueing can never fail or stall a request.** A like whose notification could not
  be queued is still a like: the user pressed the button and the row is written. The
  correct outcome is a logged warning, not a 500 and not a hung connection. The enqueue
  call is time-bounded and short-circuits when Redis is known to be unavailable.

### Media pre-generation

The image upload itself must remain in the request, because the post row cannot be
written until the image has a name to reference. Everything that happens to the image
*afterwards* need not be.

The client builds a responsive `srcset` from several widths. Cloudinary generates each
variant on **first request**, so without a media worker the first person to scroll past
a new post pays several hundred milliseconds of transform latency — and if the post lands
on a thousand feeds simultaneously, a thousand people race to trigger the same transform.
The media worker pre-generates the entire width ladder in advance, so the first viewer
receives a CDN cache hit like everyone else.

This queue is also the natural home for the work a production platform adds next: content
moderation, perceptual-hash deduplication, and video thumbnail extraction. All of it is
slow, all of it is fallible, and none of it should be capable of failing a user's post —
which is exactly what a queue with a retry policy is for.

---

## 12. Feed Generation Strategy

This is the central design decision in any social feed.

### Fan-out on write (push)

When a user posts, the post ID is copied into **every follower's** timeline immediately.
Reading a feed then consists of reading a pre-built list.

| | |
| --- | --- |
| **Read** | O(1). Trivially fast — a single `LRANGE`. |
| **Write** | O(followers). **This is the problem.** |
| **Storage** | One entry per follower, per post. |

**Appropriate when** the author has few followers — which describes almost everybody. The
write is cheap, and it makes every one of their followers' reads free. Given that reads
outnumber writes by roughly 100:1, paying at write time is paying at the cheaper end.

### Fan-out on read (pull)

Nothing is copied. When a user opens the application, the posts of everyone they follow
are queried and merged on the fly.

| | |
| --- | --- |
| **Read** | O(following). A scatter-gather, paid on **every** refresh. |
| **Write** | O(1). Free, regardless of follower count. |
| **Storage** | No additional storage. |

**Appropriate when** the author has an enormous number of followers, where a push would
constitute millions of writes — most of them performed on behalf of people who will not
open the application today.

### Why neither strategy works alone

Follower counts are a **power law, not a bell curve**. The median user has a handful of
followers, where push is nearly free. A vanishingly small number have millions, where push
is ruinous.

**Any single strategy is therefore wrong for one end of that distribution.** A design tuned
for the median user collapses when a celebrity posts; a design tuned for the celebrity is
wasteful for everyone else.

### The implemented hybrid

The threshold is `FEED_CELEBRITY_THRESHOLD`, defaulting to **10,000 followers**.

```text
Post created
     │
     ▼
followerCount < 10,000 ?
     │
     ├── YES → PUSH.  The fan-out worker copies the post ID into each follower's
     │                Redis timeline, in resumable batches of 1,000.
     │
     └── NO  → PULL.  Write NOTHING. Zero timeline entries, ever.
                      Readers will fetch this author's posts themselves.
```

A read is then the **merge of both halves**:

```text
GET /api/feed
     │
     ├── LRANGE timeline:{uid}          ← ordinary accounts (pushed).   O(1)
     │
     ├── MongoDB: posts by the          ← celebrity accounts (pulled).  1 query
     │            celebrities you follow
     │
     └── merge, sort by _id desc, page  ← ObjectId hex sorts chronologically
```

The merge is safe because an ObjectId's hexadecimal string sorts lexicographically in
exactly the order its bytes do — the leading four bytes being a big-endian timestamp — so
sorting the strings in descending order is precisely sorting newest-first, matching the
order MongoDB itself would produce.

### Cold-start handling

A missing timeline is **not** an empty timeline. Timelines expire, are evicted under memory
pressure, or may never have existed (a brand-new account, or a flushed Redis). None of those
conditions may present the user with an empty feed. A missing timeline therefore means "ask
MongoDB", and the timeline is rebuilt from the posts collection on the next read.

This is also what makes the Redis timeline safely **disposable**: it holds no information
that is not reconstructible from MongoDB, so flushing Redis costs latency, not data — which
is the only acceptable relationship to have with a cache.

A user who follows nobody falls back to the global discovery feed, so a new account sees a
populated application rather than a blank screen.

---

## 13. Handling a User With 1,000,000 Followers

### What must not happen

The naive implementation writes the post, then writes one million timeline entries,
**before answering the HTTP request**. Three things break simultaneously:

1. **The request.** One million writes at even 0.1 ms each is 100 seconds. The client timed
   out 95 seconds ago; the load balancer severed the connection before that. The user taps
   "post" again — and now there are two posts.
2. **The database.** Those million writes arrive as a single undifferentiated burst,
   competing with every read on the platform. Latency spikes for *every* user.
3. **The deployment.** That Express worker is now pinned for 100 seconds. A rolling restart
   either waits for it or terminates it mid-fan-out, leaving 600,000 followers with the post
   and 400,000 without — and nothing that knows where it stopped.

### What this system does instead

**First: the request performs no fan-out at all.**

`createPost` writes the post row, enqueues **one** job, and returns — in approximately 50 ms,
and it is *the same 50 ms whether the author has three followers or three million*. Latency
ceases to be a function of popularity.

**Second, and this is the actual answer: a million-follower author is never fanned out to in
the first place.**

At 1,000,000 followers the author is far above the celebrity threshold, so the worker takes
the **pull** branch and writes **zero** timeline entries.

The alternative is indefensible arithmetic: one million timeline writes to deliver a post to
an audience of whom perhaps 5% will open the application today. That is roughly 950,000
writes performed on behalf of nobody — **and it is paid on every post they ever make**. The
pull costs *one* additional indexed MongoDB query per feed read, and it is paid only by
users who actually arrived.

**Third: fan-out that does occur is batched, bounded and resumable.**

For authors below the threshold, "asynchronous" is not synonymous with "safe". A single job
walking 9,000 followers still loses all of its progress if a worker is redeployed mid-flight.
Fan-out is therefore a **self-chaining batch job**:

```text
fanout-post ──► fanout-batch(after=null)   1,000 followers → pipelined LPUSH
                      │
                      └──► fanout-batch(after=<last _id>)   next 1,000
                                 │
                                 └──► … until the follower list is exhausted
```

Each link in the chain:

- **is bounded** — 1,000 followers, one pipelined Redis round trip, tens of milliseconds;
- **is resumable** — `afterId` is a keyset cursor, so a retried batch re-processes *its own*
  1,000 followers and nothing else. Never a restart from zero;
- **applies back-pressure** — the queue meters work out at the rate the workers can actually
  absorb, rather than dumping a million operations onto Redis and MongoDB at once and taking
  the platform down with the resulting load spike;
- **is idempotent** — the timeline deduplicates on read, so a batch that executed twice is
  indistinguishable from one that executed once.

Pipelining is essential here: 1,000 followers is **one** round trip carrying 2,000 commands,
not 2,000 round trips. Across a 1 ms network hop, the difference between those two is the
difference between two seconds and two milliseconds — per batch. Without pipelining, a
large fan-out would spend over half an hour in network latency alone.

### Verification

This behaviour was verified end-to-end against a live Redis and MongoDB. With the threshold
configured such that the author qualified as a celebrity, the worker logged
`fan-out on READ (no push)`, the follower's Redis timeline remained at `LLEN 0` — confirming
zero timeline writes — and the post nevertheless appeared in that follower's `/api/feed`,
having been pulled live and merged at read time.

---

## 14. Horizontal Scaling

### The API is stateless

Nothing of consequence is retained inside an API process:

| State | Where it does **not** live | Where it lives |
| --- | --- | --- |
| Sessions | In-process memory | JWT (self-verifying) + MongoDB for refresh tokens |
| Rate-limit counters | In-process `Map` | **Redis** |
| Cached feeds | Module-scope object | **Redis** |
| In-flight jobs | The event loop | **Redis (BullMQ)** → worker process |
| Uploaded images | Container disk | **Cloudinary** |

Consequently: **any container can serve any request** (no sticky sessions), a container can
be terminated mid-deployment without losing work, and handling ten times the traffic means
running ten times the containers.

This is a property that must be actively *maintained*, not merely added. A single `Map`
cached at module scope — the most natural optimisation imaginable — would silently break all
three guarantees.

### Authentication is stateless on the hot path

The **access token** is a self-contained JWT: any container verifies it with the shared
secret, having never previously encountered that user. No session lookup occurs on the hot
path.

The **refresh token** is deliberately *not* stateless — its hash is stored server-side and
rotates on every use. A pure JWT cannot be revoked: "log out everywhere" would be impossible,
and a stolen token would remain valid until expiry. Storing the hash makes the refresh path
revocable, and it executes roughly once per day rather than on every request, so it costs the
hot path nothing.

### Graceful shutdown

Both processes handle SIGTERM. The API stops *accepting* new connections while allowing
in-flight requests to complete; the worker drains its current jobs. Without this, every
deployment drops a fraction of live traffic — invisibly, because the errors occur in the
browser rather than in the server logs.

### Health checks report Redis but do not fail on it

`/api/health` reports Redis as `ready`, `degraded` or `disabled`, but continues to return
`200` when Redis is down. A health check that failed on a Redis outage would cause the load
balancer to remove **every** container from rotation simultaneously — converting a cache
outage into a total outage.

---

## 15. Rate Limiting

Rate-limit counters are stored in **Redis**. This is the single change that most directly
enables horizontal scaling.

`express-rate-limit`'s default store is a `Map` in process memory. With one server this is
adequate. Behind a load balancer it is quietly but seriously broken:

- Each of N instances maintains its **own** counter, so a "20 attempts per 15 minutes" login
  limit is in reality **20 × N**. At ten instances an attacker receives 200 attempts — the
  limit that exists to prevent credential stuffing has been multiplied by exactly the number
  of servers added to handle the load.
- Counters die with the process, so a deployment, a crash, or an autoscaler scaling in resets
  every user's budget.
- Which instance a request reaches is effectively random, so the limit any given user actually
  experiences is nondeterministic.

Storing the counters in Redis makes them **shared state**, so the limit becomes a property of
the *system* rather than of whichever container the load balancer happened to select.

| Limiter | Budget | Keyed by |
| --- | --- | --- |
| Authentication | 20 per 15 minutes, **failures only** | IP address |
| Writes | 60 per minute | **User** |
| Global | 600 per minute | User, falling back to IP |

**Authenticated requests are keyed by user, not by IP address.** An office, a university or a
mobile carrier NATs thousands of people behind a single address; rate-limiting them as one
client allows a single heavy user to lock out an entire building. The IP address is retained
for the *anonymous* endpoints (login and registration), where it is the only available key —
and where it is also the *correct* key, since the attack being defended against there is one
machine attempting many accounts.

**Each limiter uses its own Redis key prefix.** Sharing a prefix would mean sharing a
*counter*: every ordinary request would consume part of the same user's login budget, and
whichever limiter touched the key first would set its TTL — so a fifteen-minute authentication
window could be silently reset by a one-minute global window. The effective limits would be
neither of the configured values.

`app.set('trust proxy', 1)` ensures `req.ip` is the real client address rather than the load
balancer's.

Authentication limiting counts **failures only**. A user legitimately signing in and out
throughout the day is not an attacker and must not be locked out for it.

---

## 16. CDN and Media Handling

**No image ever touches the API's disk.** Multer buffers the upload in memory (capped at 5 MB)
and streams it directly to Cloudinary. A container filesystem is ephemeral — wiped on every
redeployment — and is not shared between instances, so a disk-backed upload is simultaneously
a data-loss bug and a horizontal-scaling bug.

**The database stores only the bare file name** — not a path, and not a URL:

```text
posts.image = "l2d1bnbmsxv3yz5qpbfx"

  ↓ resolved against CLOUDINARY_CLOUD_NAME + CLOUDINARY_FOLDER

https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto,c_limit,w_1200/buddyscript/posts/l2d1bnbmsxv3yz5qpbfx
```

The delivery host, the folder and the transformation are **configuration, not data**. Baking
them into every row would mean that changing CDN, renaming the folder, or retuning the delivery
transformation becomes a migration across every post ever written — and would store the same
~100-byte prefix a million times over.

### Optimisation

- **On ingest**, the image is downscaled once to fit within 1600 px. A 12-megapixel phone photo
  is never stored at 12 megapixels, so the cost of pixels nobody will ever see is paid exactly
  zero times rather than on every read. Re-encoding also strips EXIF metadata, which carries the
  GPS coordinates at which the photograph was taken.
- **On delivery**, `f_auto` negotiates the format (AVIF/WebP to browsers that accept them, JPEG
  to those that do not) and `q_auto` tunes quality against the actual image content. A 1194 KB
  source PNG reaches a modern browser as approximately **28 KB of WebP** at the width the feed
  actually renders it.
- **The browser selects the width.** The API returns both a ready-to-use `image` URL and the bare
  `imageId`, so a client that understands Cloudinary can construct its own `srcset`. Only the
  browser knows its viewport and pixel density, so only the browser can choose correctly — a
  phone should not download a 1200 px image in order to paint it 390 px wide.
- **Variants are pre-generated** by the media worker, so the first viewer of a new post receives a
  CDN cache hit rather than paying transform latency.
- **URLs are immutable.** File names are unique and assets are never overwritten, so a given URL
  always resolves to the same bytes — which is what makes it safe to cache them at the edge
  indefinitely. There is consequently no version component in the URL.

### Upload security

The client-supplied filename is never used, as it may carry path traversal (`../../server.js`) or
a double extension (`evil.php.png`). Cloudinary mints a random name, and `overwrite: false`
ensures one upload can never clobber another's asset. `resource_type: 'image'` forces Cloudinary
to decode the bytes — which is the control that actually holds, since the MIME type filtered on
by multer is client-supplied and can be set to anything.

---

## 17. Security

| Concern | Control |
| --- | --- |
| **Password storage** | bcrypt, cost factor 12. Never selected by default, so a stray `User.find()` cannot leak hashes. |
| **Session tokens** | httpOnly cookies — JavaScript, and therefore XSS, cannot read them. |
| **CSRF** | `SameSite=Lax` blocks tokens from riding along on cross-site form posts. |
| **Token revocation** | Refresh tokens are stored **hashed** and rotate on every use. A replayed stolen token fails; logout genuinely revokes. |
| **User enumeration** | Login runs a full bcrypt comparison against a dummy hash even when the email does not exist, so "unknown email" and "wrong password" take the same wall-clock time and return the same message. |
| **Mass assignment** | Zod validation *replaces* the request source, so handlers can only read fields the schema declared. A client sending `{ likeCount: 9999 }` or `{ author: someoneElse }` has those fields silently dropped. |
| **Authorisation** | Ownership is always checked against the *resource*, never against an ID supplied by the client. The caller can only ever act as themselves. |
| **Private post disclosure** | The visibility rule is applied as a **database filter**, not a post-fetch array filter. Another user's private post is reported as `404`, never `403` — a 403 would confirm that a post with that ID exists. |
| **Race conditions** | Unique indexes on `likes` and `follows` let the database arbitrate concurrent writes, rather than application code attempting to win a check-then-write race. |
| **Upload safety** | Memory-buffered, size-capped, MIME-filtered, and validated by Cloudinary decoding the actual bytes. Random server-side filenames. |
| **Secret leakage in logs** | `authorization`, `cookie`, `password` and all `*token*` fields are redacted **at the logger**, not at each call site — a call site can be forgotten. |
| **Error disclosure** | In production, a 500's underlying message is never echoed to the client; it may name internal collections or driver details. |
| **Transport headers** | `helmet` applied; `x-powered-by` disabled. |

---

## 18. Error Handling and Structured Logging

### Structured logging

`console.log` produces a *string*. A string is adequate for a single server being watched in a
terminal, and useless across twenty containers behind a load balancer: it cannot be filtered,
grouped, or alerted upon.

pino emits **one JSON object per line**, so a question such as *"every 5xx on the feed route in
the last hour, grouped by user"* becomes a query rather than a `grep`.

### Correlation IDs

Every request receives an ID — adopted from an incoming `X-Request-Id` if the edge has already
minted one, so that a single ID spans the entire edge-to-database path rather than restarting at
the application boundary.

That ID is carried through `AsyncLocalStorage`, so a repository three calls deep can log and the
line will still carry the request ID — without a logger being threaded through every function
signature in the codebase. It is returned to the client in both the response body and the
`X-Request-Id` header.

The practical benefit: when a user reports "it failed around 3 pm", the exact request can be
retrieved by ID — every query it ran, every cache miss, every job it enqueued, in order — rather
than grepping twenty containers for a plausible-looking stack trace.

### Error handling

A single error handler translates the exception vocabulary of every dependency into **one response
shape**. A client should never need to know that a duplicate email surfaces as a `MongoServerError`
with `code: 11000`, or that an oversized upload is a `MulterError`. Those are implementation
details leaking, and they would become a breaking change the day a library was replaced.

The critical separation:

- **The log** receives the full error — stack, cause, and all — together with the request ID.
- **The response** receives only what is safe to state publicly.

Those two audiences require different things, and confusing them is how a stack trace, a driver
error naming internal collections, or a connection string ends up on a stranger's screen.

**Log level is determined by outcome:** 5xx → `error`, 4xx → `warn`, health checks → not logged at
all. Without this, every 404 produced by a bot probing for `/wp-admin.php` is an ERROR — and a log
full of errors that do not matter is a log nobody reads, which is precisely how the one that does
matter gets missed.

---

## 19. Environment-Based Configuration

All configuration is environment-based and validated **once, at boot**. The process refuses to
start if a required variable is missing — failing at boot is strictly better than failing on the
first request that happens to need it.

### Redis: required in production, optional in development

In production Redis is load-bearing — the rate limiter, the cache and the queues all depend on it —
and running without it would silently fall back to per-instance state that is *wrong* the moment
there is more than one instance. A production boot without `REDIS_URL` therefore **fails loudly**.

In development, requiring a running Redis merely to read the feed would make the project
unnecessarily difficult to run. Without a URL the application boots in **degraded mode** — the cache
becomes a no-op, the rate limiter falls back to in-memory counters, and queued jobs are dropped —
and **every one of those is announced at startup**, so degraded mode can never be mistaken for the
real thing.

### Principal configuration

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | Database connection |
| `REDIS_URL`, `REDIS_KEY_PREFIX` | Cache, queues, rate limits, timelines |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Two distinct signing secrets |
| `JWT_EXPIRY`, `JWT_REFRESH_EXPIRY` | Token lifetimes |
| `CLOUDINARY_*` | Media upload and delivery |
| `CLIENT_ORIGIN` | CORS origin |
| `FEED_CELEBRITY_THRESHOLD` | Push/pull fan-out threshold (default 10,000) |
| `FEED_FANOUT_BATCH_SIZE` | Followers per fan-out batch job (default 1,000) |
| `FEED_TIMELINE_MAX_LENGTH` | Materialised timeline cap (default 800) |
| `CACHE_*_TTL` | Cache lifetimes |
| `RATE_LIMIT_*` | Rate-limit budgets |
| `LOG_LEVEL`, `LOG_PRETTY` | Logging verbosity and format |

A complete, commented template is provided in `.env.example`.

---

## 20. Setup and Running

### Prerequisites

- Node.js 20 or later
- A MongoDB instance (Atlas or local)
- Redis (optional in development; required in production)
- A Cloudinary account

### 1. Configure

```bash
cp .env.example .env
```

Populate `MONGODB_URI`, the two JWT secrets, and the Cloudinary credentials. Generate each JWT
secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Start Redis (recommended)

```bash
brew install redis && redis-server
# or
docker run -p 6379:6379 redis
```

Without `REDIS_URL` the application still runs, in degraded mode, and states so at startup.

### 3. Run

Three terminals:

```bash
# 1. API  → http://localhost:5000
cd server && npm install && npm run indexes && npm run seed && npm run dev

# 2. Background workers (fan-out, notifications, media)
cd server && npm run worker:dev

# 3. Frontend  → http://localhost:5173
cd client && npm install && npm run dev
```

The worker is what consumes the queues. Without it, posts and likes still function correctly — the
jobs simply accumulate in Redis and drain the moment a worker appears.

### Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | The API (with reload) |
| `npm start` | The API (production) |
| `npm run worker:dev` | The job consumers (with reload) |
| `npm run worker` | The job consumers (production) |
| `npm run indexes` | Build and synchronise MongoDB indexes — **a deployment step** |
| `npm run seed` | Populate the database with sample users, posts, comments and likes |

### Demo account

After seeding:

```text
Email:    demo@buddyscript.dev
Password: Passw0rd123
```

---

## 21. Deployment

The system is deployed as **three components**, and that separation *is* the architecture:

| Component | Scaling signal |
| --- | --- |
| **API** (web) | HTTP traffic. Raise the instance count. |
| **Worker** | Fan-out load. Scaled independently — one celebrity with 500,000 followers generates hundreds of batch jobs without a single additional HTTP request. |
| **Redis** | Cache, queues, rate limits, timelines. |

A complete Render blueprint is provided in `render.yaml`, wiring all three together with the Redis
connection string injected into both processes.

Two deployment notes carry real consequences:

**Indexes are built by a pre-deploy step** (`npm run indexes`), never on container boot. See §8.

**Redis must be configured with `maxmemory-policy noeviction`.** The instance holds two very
different kinds of data: the *cache*, which is disposable, and the *queues*, which are not. An
evicted BullMQ job is a post that never reached its followers, and it disappears silently. An LRU
policy cannot distinguish between them, and under memory pressure would begin deleting queued jobs
to make room for cached posts. `noeviction` causes Redis to reject writes rather than lose data —
loud rather than silent.

A serverless deployment (for example Vercel) is also supported for the API, but has one significant
limitation: serverless provides no long-lived process in which to run workers, so the queues have no
consumer and background jobs would enqueue without ever draining. The container-based blueprint is
what makes the full background architecture operational.

---

## 22. API Reference

All routes require an authenticated session except `register`, `login` and `refresh`.

### Authentication Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/register` | First name, last name, email, password |
| `POST` | `/api/auth/login` | |
| `POST` | `/api/auth/refresh` | Rotates the refresh token |
| `POST` | `/api/auth/logout` | Revokes the session server-side |
| `GET` | `/api/auth/me` | Current user |

### Post Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/posts` | Discovery feed. `?cursor&limit&scope=all\|mine` |
| `POST` | `/api/posts` | Multipart: `content`, `visibility`, `image` |
| `GET` | `/api/posts/:id` | |
| `PATCH` | `/api/posts/:id` | Author only |
| `DELETE` | `/api/posts/:id` | Author only; cascades to comments and likes |

### Home Timeline Endpoint

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/feed` | Follower-graph timeline (hybrid fan-out). `?cursor&limit` |

`/api/posts` is the **global discovery feed** — everything public, newest first. `/api/feed` is the
**follower-graph home timeline**. They answer genuinely different questions ("what is happening"
versus "what are the people I follow saying"), and every social product ships both. Their response
shapes are identical.

### Social Graph Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/follows/:id` | Follow a user |
| `DELETE` | `/api/follows/:id` | Unfollow a user |
| `GET` | `/api/follows/:id/followers` | Paginated |

### Comment Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/posts/:id/comments` | Top-level comments, paginated |
| `POST` | `/api/posts/:id/comments` | `parentId` present ⇒ it is a reply |
| `GET` | `/api/comments/:id/replies` | Replies, paginated |
| `DELETE` | `/api/comments/:id` | Comment author, or the post's author |

### Like Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/likes/toggle` | `{ targetType: 'post'\|'comment', targetId }` |
| `GET` | `/api/likes` | `?targetType&targetId` — who liked it, paginated |

### System

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Uptime and Redis status |

### Response shape

Every endpoint returns a consistent envelope:

```jsonc
// Success
{ "success": true, "data": { /* ... */ } }

// Failure
{
  "success": false,
  "message": "Human-readable message.",
  "errors":  { "field": "Reason." },   // present on validation failures
  "requestId": "…"                      // correlates to the server logs
}
```

Paginated endpoints return `{ items, nextCursor, hasMore }`, where `nextCursor` is passed back as
the `cursor` query parameter to fetch the following page.

---

## 23. Verification and Testing

The system was verified end-to-end against a live MongoDB Atlas cluster and a live Redis instance.
The following behaviours were confirmed by direct observation rather than by inspection.

### Functional

| Behaviour | Result |
| --- | --- |
| Registration, login, session refresh, logout | Pass |
| Post creation, editing, deletion (cascading to comments and likes) | Pass |
| Comments, one-level replies, reply counts | Pass |
| Likes on posts and comments; liker lists; liker previews | Pass |
| Post visibility (`public` / `only me`) enforced at the database layer | Pass |
| Cursor pagination, including `hasMore` and `nextCursor` | Pass |
| Follow / unfollow, with denormalised counter updates | Pass |

### Architecture

| Behaviour | Verification |
| --- | --- |
| **Fan-out on write** | A post by a below-threshold author appeared in the follower's Redis timeline (`LRANGE timeline:{uid}`), written by the worker process. |
| **Fan-out on read (celebrity)** | With the author above the threshold, the worker logged `fan-out on READ (no push)`, the follower's timeline remained at `LLEN 0` — **zero timeline writes** — and the post still appeared in `/api/feed`, pulled and merged at read time. |
| **Cache population** | Feed pages cached as ID lists; post bodies cached individually under `post:{id}`. |
| **Cache invalidation** | Liking a post removed `post:{id}` from Redis; the subsequent read returned the updated `likeCount`, `likedByMe` and liker preview, and repopulated the cache. |
| **Queue durability** | Jobs enqueued while no worker was running were consumed correctly the moment a worker started. |
| **Rate limiting** | The authentication limiter returned `429` at precisely its configured budget, with counters stored in Redis and shared across processes. |
| **Index creation** | `npm run indexes` created all declared indexes, including the fan-out walk index and the celebrity-pull index. |
| **Graceful shutdown** | Both the API and the worker drained cleanly on SIGTERM. |

### Resilience

Redis was terminated **while the API was serving traffic**, to confirm that the cache cannot take
the site down:

| Endpoint | With Redis down |
| --- | --- |
| `GET /api/posts` | `200` — served from MongoDB |
| `GET /api/feed` | `200` — served from MongoDB |
| `POST /api/posts` | `201` |
| `POST /api/likes/toggle` | `200` |
| `GET /api/health` | `200`, reporting `redis: degraded` |

All responses returned in under 500 ms, the process remained alive throughout, and the cache
repopulated automatically once Redis was restored.

Achieving this required more than a `try`/`catch` around the cache. Three distinct failure paths had
to be closed:

1. **The rate limiter must fail open.** It executes before every route, and by default
   `express-rate-limit` propagates a store error to the error handler — so a Redis outage would have
   returned `500` on every request, no matter how carefully the cache itself degraded.
2. **Redis commands must be time-bounded.** ioredis buffers commands issued while disconnected and
   replays them on reconnect, so a `GET` during an outage does not fail — it simply never returns,
   and the request waiting on it never answers.
3. **Enqueueing must be time-bounded.** BullMQ requires `maxRetriesPerRequest: null`, meaning
   `queue.add()` retries indefinitely. Since the post row is already written by that point, a queue
   that will not answer must not be permitted to hold the user's request open.

---

## 24. Design Decisions and Trade-offs

### Summary of principal decisions

| Decision | Rationale |
| --- | --- |
| **Refactor, not rewrite** | Cursor pagination, denormalised counters and the separate `Like` collection were already correct. They were retained and built upon. |
| **Layered controller → service → repository** | Prevents the storage decision from leaking into HTTP handlers; enforces business rules exactly once. |
| **Cache IDs and bodies separately** | A post on 10,000 feeds is stored once, and an edit is a single `DEL` rather than 10,000 rewrites. |
| **Separate shared from viewer-specific data** | Keeps the cache key free of the viewer, which is the difference between a ~100% and a ~0% hit rate. |
| **Queue all non-essential work** | Post latency becomes independent of follower count. |
| **Hybrid fan-out (push below 10k, pull above)** | Follower counts are a power law; no single strategy is correct for both ends of the distribution. |
| **Separate worker process** | The API and the workers scale on different signals; keeps the API stateless. |
| **Redis-backed rate limiting** | An in-memory limiter multiplies its own limit by the number of servers behind the load balancer. |
| **Indexes built at deploy, not at boot** | Prevents every container from rebuilding indexes during the traffic spike that triggered the scale-out. |
| **Fail-open cache** | A cache capable of returning a 500 is a liability, not an optimisation. |

### Accepted trade-offs

These are stated explicitly, because a design document listing only its strengths is marketing.

1. **The discovery feed head may be up to ~20 seconds stale.** Deliberate: invalidating it on every
   write would evict it several times per second on a busy platform, so it would never be warm and
   every reader would fall through to MongoDB. The author does not perceive the delay, because the
   client splices their own new post onto page one locally.

2. **Enqueueing is not transactional with the database write.** A crash in the interval between them
   loses the job — a missed notification, or a post that reaches timelines slightly later via the
   read-path rebuild rather than the push. The remedy, when this ceases to be acceptable, is the
   transactional outbox pattern (§25).

3. **Unfollowing does not scrub the existing timeline.** The unfollowed author's prior posts age out
   as new posts arrive, rather than being scanned and removed during a user action. An unfollow takes
   effect immediately for *new* posts and decays for old ones. The alternative — a live "do I still
   follow this author" check on every feed read — would place that cost on the hot path in order to
   correct something users do not notice.

4. **Rate limiting uses a fixed window, not a sliding one.** A user may spend their entire budget in
   the final second of one window and again in the first second of the next. A sliding window costs a
   sorted set per client, which is not yet warranted.

5. **During a Redis outage the API is unprotected against brute force**, because the limiter fails
   open. Serving traffic without a limit is strictly better than serving no traffic at all — but this
   is the correct trade for a social feed and would be the *wrong* trade for, say, a payments
   endpoint. It is recorded here rather than left as an undocumented default.

6. **A user whose follower count sits exactly at the threshold alternates between push and pull** as
   it crosses. This is harmless — the read path merges both halves and deduplicates — but it means a
   post published near the boundary may be delivered by either route.

---

## 25. Future Improvements

Listed approximately in the order in which the current design would begin to strain.

### Read replicas

Every read currently reaches the primary. Routing feed reads, comment lists and liker lists to
secondaries (`readPreference: secondaryPreferred`) is a change confined to the repository layer —
which is precisely the point of having one. Writes and authorisation checks remain on the primary,
since replication lag could otherwise allow a stale read to report a post as public moments after it
was made private.

### Transactional outbox

Eliminates trade-off #2. The job is written into an `outbox` collection **within the same transaction
as the post**, and a relay process publishes it to BullMQ. The database write and the intent to
enqueue become atomic, and the relay retries until the queue accepts it — yielding exactly-once
*effects* (the jobs already being idempotent) rather than at-least-once *delivery*.

### Kafka

BullMQ is a *work queue*: a job is consumed once and is then gone. Kafka is a *durable, replayable
log*, from which many independent consumers read at their own pace.

The time to migrate is when several consumers care about the same event. Today, one component cares
that a post was created. When the answer becomes "fan-out, **and** the search indexer, **and** the
ranking model, **and** the analytics pipeline, **and** the moderation scanner", a work queue is the
wrong shape — the same event would have to be enqueued five times. Kafka additionally permits a new
consumer to **replay history** (rebuilding a search index from the beginning of time), which a work
queue fundamentally cannot do.

### MongoDB sharding

Warranted when the working set outgrows a single replica set's RAM.

- `posts` → shard on `{ author: 1, _id: -1 }`. Author-scoped queries and the celebrity pull remain
  single-shard.
- `follows` → shard on `{ following: 1 }`, so the fan-out walk for a given author stays on one shard.
- `likes` → shard on `{ target: 1 }`, keeping "who liked this post" single-shard.

A monotonically increasing shard key (`_id` alone) must be avoided: every insert would land on the
same shard, making it the write bottleneck for the entire cluster.

### Split Redis instances

The cache and the queues have **opposite eviction requirements**. The cache is disposable and wants an
LRU policy; the queues are not disposable and require `noeviction`. A single instance cannot satisfy
both, so the deployment currently pins `noeviction` and accepts that a cache large enough to fill
memory would begin rejecting writes. The resolution is two instances — an LRU one for the cache, a
`noeviction` one for the queues. The connection layer already returns two separate clients, so this is
a configuration change rather than a refactor.

### Feed ranking

The feed is currently reverse-chronological. Ranking (engagement, affinity, recency decay) is a scoring
stage that reorders the *candidate set* the timeline already produces — which is precisely why the
timeline stores IDs rather than a rendered page. No part of the current design needs to change to
accommodate it.

### Push notifications

The notification worker is the seam. "Write a record" becomes "write a record, look up the recipient's
devices, call APNs and FCM, respect their quiet hours, and collapse the result into 'Alice and 12
others liked your post'" — hundreds of milliseconds across three third-party services, any of which may
be unavailable. All of it can be built behind that boundary without a single millisecond reaching the
request that triggered it.

### Microservices

**Not yet — and the reasoning matters.** The existing layering already delivers the modularity benefit;
splitting into services now would introduce network latency, distributed transactions and independent
deployment overhead for no present gain.

The honest signal to split is **organisational rather than technical**: when separate teams need to
deploy on separate cadences, or when one component's scaling profile genuinely diverges (media
processing requiring GPUs, for instance). The natural seams are already drawn — `media`, `notification`
and `fanout` are separate workers consuming separate queues today, so extracting one is a deployment
change rather than a rewrite. That is the point of having drawn them.

### Smaller improvements

- **Sliding-window rate limiting**, resolving trade-off #4.
- **Cache stampede locking** — a mutex on cache miss, so that one request rebuilds a hot key while the
  remainder wait, rather than a thousand simultaneously querying MongoDB for the same post.
- **`likedByMe` via Redis sets** — a per-user set of liked post IDs would reduce the final per-page
  MongoDB query to a Redis `SMISMEMBER`.
- **WebSockets or SSE** for live like and comment counts.
- **OpenTelemetry tracing** — the request ID already correlates the logs; spans would additionally show
  where the time was spent.
