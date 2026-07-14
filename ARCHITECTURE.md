# Architecture

How BuddyScript is built to serve millions of users, and — more usefully — *why*
each decision was made and what it costs.

Every claim in this document is implemented in the code, not aspirational. Where
something is deliberately **not** built, it says so and explains the trade.

---

## Table of contents

1. [The shape of the problem](#1-the-shape-of-the-problem)
2. [Request flow](#2-request-flow)
3. [Layered structure](#3-layered-structure)
4. [Feed generation: fan-out on write vs fan-out on read](#4-feed-generation-fan-out-on-write-vs-fan-out-on-read)
5. [The 1,000,000-follower problem](#5-the-1000000-follower-problem)
6. [Redis caching strategy](#6-redis-caching-strategy)
7. [Queue architecture](#7-queue-architecture)
8. [Database indexing strategy](#8-database-indexing-strategy)
9. [Horizontal scaling](#9-horizontal-scaling)
10. [Rate limiting](#10-rate-limiting)
11. [CDN and Cloudinary](#11-cdn-and-cloudinary)
12. [Error handling and structured logging](#12-error-handling-and-structured-logging)
13. [Configuration](#13-configuration)
14. [Failure modes: what happens when each piece dies](#14-failure-modes-what-happens-when-each-piece-dies)
15. [Known trade-offs](#15-known-trade-offs)
16. [Future improvements](#16-future-improvements)

---

## 1. The shape of the problem

A social feed is defined by two facts, and almost every decision below follows
from one of them.

**Fact one: reads dominate.** Users scroll far more than they post — roughly
100:1. So it is right to do expensive work at *write* time if it makes reads
cheap. Work done once on write is amortised over a hundred reads.

**Fact two: followers are a power law, not a bell curve.** The median user has a
handful of followers. A vanishingly small number have millions. This is the fact
that breaks naive designs, because *any single strategy is wrong for one end of
that distribution*. A design tuned for the median user collapses when a celebrity
posts; a design tuned for the celebrity is wasteful for everyone else.

The architecture is therefore **hybrid wherever the power law bites** — most
visibly in feed generation (§4–5).

---

## 2. Request flow

```text
                    ┌──────────────┐
   Browser ───────► │ CDN (static) │  React bundle, images (Cloudinary)
                    └──────────────┘
       │
       │ /api/*
       ▼
┌───────────────────┐
│   Load balancer   │  round-robin; no sticky sessions (the API is stateless)
└─────────┬─────────┘
          │
    ┌─────┴─────┬───────────┬─────────┐
    ▼           ▼           ▼         ▼
┌────────┐ ┌────────┐  ┌────────┐  ┌────────┐
│ API #1 │ │ API #2 │  │ API #3 │  │ API #N │   ← Express, horizontally scaled
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
│  Worker process(es)│  ← fan-out, notifications, media. Scaled SEPARATELY.
└────────────────────┘
```

### A single request, end to end

`GET /api/feed` (home timeline), for a user who follows 200 people, 2 of whom are
celebrities:

1. **Load balancer** → any API container. No sticky session, because the container
   holds no session state.
2. **`requestLogger`** mints an `X-Request-Id` (or adopts the one the edge sent)
   and binds it into `AsyncLocalStorage`, so every log line from here down —
   including inside repositories — carries it.
3. **`globalLimiter`** does one Redis `INCR`. The counter is shared by every
   container, so the limit is a property of the system, not of one process.
4. **`requireAuth`** verifies the JWT with a shared secret. **No database read, no
   session lookup** — this is what makes the container stateless.
5. **`validate`** parses the query with Zod and *replaces* it, so the handler can
   only ever read fields the schema declared (this is what kills mass-assignment).
6. **Controller** → **`feed.service`**:
   - Read the cached follow-split (`follow:split:{uid}`): which of the 200 are
     celebrities, which are not.
   - **Push half**: `LRANGE timeline:{uid}` → post ids already materialized by the
     fan-out worker. O(1).
   - **Pull half**: one indexed Mongo query for the 2 celebrities' recent posts.
   - Merge both id lists, sort descending, take the page.
7. **Hydrate**: `MGET post:{id} …` for the whole page in one round trip. Cache
   misses become **one** `$in` query against Mongo — never one query per post.
8. **Personalize**: one indexed query resolves `likedByMe` for the entire page.
9. **Respond**, and log one structured line with status, duration, and request id.

**Total: ~2 Redis round trips and 1–3 Mongo queries, regardless of page size.**
No N+1 anywhere.

---

## 3. Layered structure

```text
server/src/
├── config/          env, mongo, redis, cloudinary, logger      (wiring)
├── models/          Mongoose schemas + indexes                 (shape of the data)
├── repositories/    data access only — knows Mongo/Redis, nothing else
├── services/        business rules, caching, orchestration
├── controllers/     HTTP only: read request → call service → write response
├── routes/          routing + validation + rate limits
├── middleware/      auth, validation, rate limit, logging, errors
├── queues/          BullMQ queues, producers, and workers
│   └── workers/     fanout, notification, media
├── validators/      Zod schemas (the request contract)
├── utils/           pagination, tokens, errors
├── scripts/         seed, syncIndexes
├── server.js        API entrypoint
└── worker.js        WORKER entrypoint — a separate process
```

The rule is **one direction of dependency**: `controller → service → repository`.
A controller never touches Mongo; a repository never knows what an HTTP status
code is.

This is not aesthetic. It buys three concrete things:

- **The storage decision stops leaking.** Sharding the posts collection, or moving
  like-state reads onto a replica, changes files in `repositories/` and *nothing
  else* — because there is no `Post.find()` in a controller anywhere to update.
- **Business rules are enforced once.** The visibility rule ("you see public posts
  plus your own") lives in exactly one function. It cannot be forgotten on a new
  endpoint, because every endpoint reaches the data through it.
- **The rules are testable without an HTTP server**, and reusable from something
  that is not one — a GraphQL resolver, a CLI, a worker.

---

## 4. Feed generation: fan-out on write vs fan-out on read

This is the central design decision in any social feed.

### Fan-out on write (push)

When you post, copy the post id into **every follower's** timeline immediately.
Reading a feed is then just reading your own pre-built list.

|                   |                                             |
| ----------------- | ------------------------------------------- |
| **Read**    | O(1). Trivially fast. Just`LRANGE`.       |
| **Write**   | O(followers).**This is the problem.** |
| **Storage** | One entry per follower per post.            |

**Use it when** the author has few followers — which is almost everybody. The
write is cheap and it makes all their followers' reads free. Given reads outnumber
writes 100:1, this is the right default.

### Fan-out on read (pull)

Copy nothing. When a user opens the app, query the posts of everyone they follow
and merge on the fly.

|                   |                                                                 |
| ----------------- | --------------------------------------------------------------- |
| **Read**    | O(following). A scatter-gather, paid on**every** refresh. |
| **Write**   | O(1). Free, whatever your follower count.                       |
| **Storage** | Nothing extra.                                                  |

**Use it when** the author has a colossal number of followers, where a push would
be millions of writes — most of them on behalf of people who will not open the app
today.

### Why neither works alone

Because of the power law (§1). Push is right for the median user and catastrophic
for the celebrity. Pull is right for the celebrity and wasteful for everyone else.
**Picking one means being wrong for one end of your user base.**

### The hybrid (what this codebase implements)

The threshold is `FEED_CELEBRITY_THRESHOLD` (default **10,000** followers).

```text
Post created
     │
     ▼
followerCount < 10,000 ?
     │
     ├── YES → PUSH.  Fan-out worker copies the post id into each follower's
     │                Redis timeline, in resumable batches of 1,000.
     │
     └── NO  → PULL.  Write NOTHING. Zero timeline entries, ever.
                      Readers will fetch this author's posts themselves.
```

And a read is the **merge of both halves**:

```text
GET /api/feed
     │
     ├── LRANGE timeline:{uid}          ← everyone normal (pushed).  O(1)
     │
     ├── Mongo: posts by celebrities    ← the few big accounts (pulled). 1 query
     │          you follow
     │
     └── merge, sort by _id desc, page  ← ObjectId hex sorts chronologically
```

`followerCount` is denormalized onto the `User` document precisely so that the
push-vs-pull decision — asked on the write path of every single post — is one
cheap document read rather than a `count()` over millions of edges.

**Implementation:** `services/feed.service.js`, `queues/workers/fanout.worker.js`.

---

## 5. The 1,000,000-follower problem

> *A user with a million followers taps "post". What happens?*

### What must not happen

The naive implementation writes the post, then writes a million timeline entries,
*before answering the HTTP request*. Three things break at once:

1. **The request.** A million writes at even 0.1ms each is 100 seconds. The client
   timed out 95 seconds ago; the load balancer killed the connection before that.
   The user taps "post" again — and now there are two posts.
2. **The database.** A million writes arrive as one undifferentiated burst,
   competing with every read on the site. Latency spikes for *everyone*.
3. **The deploy.** That Express worker is pinned for 100 seconds. A rolling restart
   either waits for it or kills it mid-fan-out, leaving 600,000 followers with the
   post, 400,000 without — and nothing that knows where it stopped.

### What this codebase does

**Step 1 — the request does no fan-out at all.**

`createPost` writes the post row, enqueues **one** job, and returns. Response time
is ~50ms, and it is *the same 50ms whether the author has 3 followers or 3
million*. Latency stops being a function of popularity.

**Step 2 — a million-follower author is never fanned out to in the first place.**

This is the actual answer. At 1,000,000 followers the author is far above the
threshold, so the worker takes the **pull** branch and writes **zero** timeline
entries.

Because the alternative is indefensible arithmetic: a million timeline writes to
deliver a post to an audience of whom maybe 5% will open the app today. That is
~950,000 writes performed on behalf of nobody — **paid on every post they ever
make**. The pull costs *one* extra indexed Mongo query per feed read, and it is
only paid by people who actually showed up.

> Verified end-to-end: with the threshold lowered so the author qualifies as a
> celebrity, the worker logs `using fan-out on READ (no push)`, the follower's
> Redis timeline stays at `LLEN 0`, and the post *still* appears in their
> `/api/feed` — pulled live and merged at read time.

**Step 3 — fan-out that *does* happen is batched, bounded and resumable.**

For authors below the threshold, "asynchronous" is not the same as "safe": a
single job walking 9,000 followers still loses all its progress if a worker is
redeployed mid-flight. So fan-out is a **self-chaining batch job**:

```text
fanout-post ──► fanout-batch(after=null)   1,000 followers → pipelined LPUSH
                      │
                      └──► fanout-batch(after=<last _id>)   next 1,000
                                 │
                                 └──► … until the follower list is exhausted
```

Each link:

- **is bounded** — 1,000 followers, one pipelined Redis round trip, tens of ms;
- **is resumable** — `afterId` is a keyset cursor, so a retried batch redoes *its
  own* 1,000 followers and nothing else. Never a restart from zero;
- **applies back-pressure** — the queue meters work out at the rate workers can
  absorb, instead of dumping a million ops on Redis and Mongo at once;
- **is idempotent** — the timeline dedupes on read, so a batch that ran twice is
  indistinguishable from one that ran once. This is what lets us live with
  BullMQ's *at-least-once* delivery, which is the strongest guarantee a
  distributed queue can actually give.

**Why the batches chain rather than fan out in parallel:** the cursors are not
knowable up front without walking the collection — which is the very work being
batched. Chaining trades a little wall-clock for crash-safety and back-pressure.

---

## 6. Redis caching strategy

### The governing rule

> **The cache is never allowed to take the site down.**

A cache is an optimisation, and an optimisation that can fail the request it was
meant to accelerate is a liability. So **every cache operation fails open**: if
Redis is missing, unreachable, slow, or returns garbage, the call behaves exactly
like a miss and the caller reads Mongo. A degraded site is slower; a site whose
cache can 500 it is *down*.

Consequently no cache **write** is ever awaited on a request's critical path — the
user does not wait to populate a cache they have already been served around.

### The pattern: cache-aside (lazy loading)

```text
read → cache hit?  → return it
     → cache miss? → read Mongo → populate cache → return
```

Mongo stays the single source of truth; Redis is a **disposable accelerator** that
can be flushed at any moment without losing a byte. (Read-through/write-through
would put the cache in the *write* path, where a Redis outage becomes a write
outage.)

### What is cached

| Key                                     | Holds                                                      | TTL                       | Invalidated by                                    |
| --------------------------------------- | ---------------------------------------------------------- | ------------------------- | ------------------------------------------------- |
| `post:{id}`                           | Post**body** — text, author, counters, like preview | 10 min                    | Explicit`DEL` on edit / delete / like / comment |
| `feed:{scope}:{uid}:{cursor}:{limit}` | **Ordered post IDs only**                            | 20s (head) / 5 min (deep) | TTL                                               |
| `timeline:{uid}`                      | Materialized home timeline (list of post ids)              | 30 days                   | Fan-out worker                                    |
| `follow:split:{uid}`                  | Which followees are celebrities                            | 5 min                     | Explicit`DEL` on follow/unfollow                |
| `rl:{limiter}:{key}`                  | Rate-limit counters                                        | window                    | TTL                                               |

### The key trick: IDs and bodies are cached separately

**Feed pages cache post IDs. The post cache holds bodies.** This is the single most
important decision in the caching design.

If a feed page cached the full post *bodies* inside it, then a post appearing on
10,000 different feed pages would be stored 10,000 times — and editing one typo
would require finding and rewriting all 10,000 entries, which you cannot do
without either a reverse index or a `SCAN` of the keyspace.

By splitting them:

- a post is stored **once**, under `post:{id}`, however many feeds it appears on;
- an edit is **one `DEL`** — and every feed page picks the new body up on its next
  hydrate;
- a partial cache hit is still a win: 8 of 10 posts cached means one Mongo query
  for 2 documents, not 10.

The same reasoning applies to the fan-out timeline. It stores **ids, not bodies**:
a post fanned out to a million followers at ~1KB of JSON would be **1GB of Redis
for one post**, and every like would dirty all million copies. At 24 bytes per id
it is 24MB, and a like invalidates exactly one shared key.

> The timeline is an **index** (what should this user see, in what order).
> The post cache is the **content** (what does this post say).
> They change on completely different schedules — which is exactly why they must
> not be the same cache entry.

### The other key trick: shared vs viewer-specific data

Every post is presented in two parts (`services/presenter.js`):

- **Shared** — content, author, counters. Identical for every viewer on Earth →
  **cached once**, read by all of them.
- **Viewer-specific** — `likedByMe`, `isMine` → **never cached**, computed live.

Conflating them is fatal at scale: cache the fully-rendered post *including*
`likedByMe`, and the cache key must include the viewer — so a post on a million
feeds needs a million cache entries. That is an enormous cache with a ~0% hit
rate. Split them, and one `post:{id}` serves all million, while the per-viewer bits
cost **one batched, index-covered query per page**.

### TTL asymmetry: why deep pages cache 15× longer

Under keyset pagination (`sort({_id: -1})`, `_id < cursor`), **a page below the
head is a stable window**. Every post it can ever contain already exists — a new
post gets a *higher* `_id`, so it lands on the head page and *cannot* enter a
lower one. The composition of page 40 is therefore immutable.

So deep pages are cached for **5 minutes**, and the head page — where new posts
actually land — for **20 seconds**.

This is a happy result: **deep scrolling is both the most expensive case and the
most cacheable one.** (In an offset-paginated feed, page 40 is where the database
is scanning and discarding thousands of documents.)

### Why the feed head is *not* explicitly invalidated

It looks like an omission, so it is deliberate and documented in the code. The
head page has a ~20s TTL. If every new post `DEL`'d it, then on a busy site the
head page would be evicted several times a second, never be warm, and every reader
landing on it — *most* readers — would go to Mongo. The cache would do no work
while still costing a round trip.

A 20-second window in which the *discovery* feed does not yet show a 5-second-old
post is not a bug; it is what "eventually consistent" buys. And the one person who
would notice — the author — doesn't, because the client splices their own new post
onto page 1 locally.

### Thundering herds

TTLs are jittered ±10%. Without it, a thousand keys written by the same traffic
burst all expire in the same second, every read misses at once, and the herd
stampedes Mongo together — on a perfect repeating cycle. Jitter breaks the
synchronisation.

---

## 7. Queue architecture

**BullMQ on Redis.** Three queues, consumed by a **separate worker process**
(`npm run worker`).

| Queue            | Job                                                   | Why it is not in the request                                                    |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `fanout`       | `fanout-post`, `fanout-batch`, `fanout-retract` | O(followers) work. Would make post latency a function of popularity.            |
| `notification` | `notify`                                            | Nothing the user sees after liking depends on it existing.                      |
| `media`        | `media-derive`                                      | Pre-generates image variants so the first viewer doesn't pay transform latency. |

### The rule for what belongs on a queue

> **If the user does not need the result to render their next screen, it does not
> belong in their request.**

Creating a post needs exactly one thing to be true before the API can answer: the
row exists. Fanning it out, notifying followers, and generating image variants are
all *consequences* of that write. None of them change the response.

### Reliability

- **Retries**: 5 attempts, exponential backoff from 2s. The right response to a
  transient failure is to try again *later* — retrying a database that is already
  under load merely adds to the load causing the failures.
- **Idempotency**: fan-out dedupes on read, so at-least-once delivery is safe.
- **Retention**: completed jobs kept 1h (enough to debug), failures kept **7 days**
  (enough to notice, investigate, and replay). Keeping everything forever would
  grow Redis without bound — the queue would become the outage.
- **Graceful shutdown**: `worker.close()` drains in-flight jobs on SIGTERM, so a
  rolling deploy costs nothing rather than a stall and a redelivery.
- **Failed jobs are logged at `error`** with full payload — a job that exhausted
  its retries is a real incident (a notification nobody got, a slice of followers
  who never received a post) and must be loud enough to alert on.

### The honest limitation

The DB write and the enqueue are **not one atomic transaction**. A crash in the gap
between them loses the job. At this scale that is an acceptable trade — a missed
notification — and it is called out in the code rather than hidden. The fix, when
it stops being acceptable, is the **transactional outbox** pattern (§16).

---

## 8. Database indexing strategy

Every index follows **ESR: Equality → Sort → Range**.

Because every query here is keyset-paginated (`sort({_id: -1})` with
`_id < cursor`), `_id` is *simultaneously* the sort key and the range key — so it
goes **last** in every compound index. That is what lets Mongo answer a page as a
bounded index seek with **no in-memory sort**, at the same cost on page 50,000 as
on page 1.

| Collection             | Index                                   | Serves                                                                                   |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Post**         | `{visibility: 1, _id: -1}`            | The public discovery feed                                                                |
|                        | `{author: 1, _id: -1}`                | `scope=mine`; profile timeline                                                         |
|                        | `{author: 1, visibility: 1, _id: -1}` | **The celebrity pull** — `author $in [...]`, on the hot path of every feed read |
| **Follow**       | `{follower: 1, following: 1}` unique  | One edge per pair; makes following idempotent                                            |
|                        | `{following: 1, _id: 1}`              | **The fan-out walk** — the only query that ever touches a million rows            |
|                        | `{follower: 1, _id: -1}`              | "Who am I following"                                                                     |
| **Like**         | `{targetType, target, user}` unique   | **The concurrency guarantee** (below)                                              |
|                        | `{targetType, target, _id: -1}`       | "Who liked this", paginated                                                              |
|                        | `{user, targetType, target}`          | **Covered index** for page-wide like-state                                         |
| **Comment**      | `{post: 1, parent: 1, _id: -1}`       | Top-level comments; replies to a comment                                                 |
| **Notification** | `{recipient: 1, _id: -1}`             | "My notifications"                                                                       |
|                        | `{createdAt: 1}` **TTL 30d**    | Mongo reclaims the space itself                                                          |

### Three indexes worth dwelling on

**`Like {user, targetType, target}` is a *covered* index.** Every field the
like-state query needs is *in* the index, so Mongo answers "which of these 10 posts
have I liked" without touching a single document. This is what makes `likedByMe`
free for a whole page.

**The unique index on `Like` is a concurrency control, not a constraint.** Two
rapid clicks both pass a check-then-write and produce a double like. Instead we
*attempt the insert and let the database arbitrate*: a duplicate-key error **is**
the signal that it was already liked. The race is resolved by the storage engine,
not by application code hoping to win it. Same for `Follow`.

**`Follow {following: 1, _id: 1}` is the one that has to survive a million rows.**
Fan-out keyset-walks it in batches, never re-reading a follower. Paging it with
`skip/limit` instead would make batch 1,000 scan and discard the 999,000 rows
before it — quadratic work, on the hottest write path in the system.

### Denormalized counters

`likeCount`, `commentCount`, `replyCount`, `followerCount`, `followingCount` are
maintained with `$inc`. Reading a feed of 20 posts must never fan out into 20
`count()` queries.

They are **clamped at zero by the database itself**, via an aggregation-pipeline
update (`$max: [0, {$add: [...]}]`). A plain `$inc: -1` can drift negative if a
delete is ever replayed; this way no amount of retrying can produce a negative
count.

### Why `Like` is its own collection

An embedded `likes: [ObjectId]` array on the post would grow unbounded (a viral
post has millions of likers), blow past the 16MB document ceiling, drag the entire
liker list over the wire on every post read, and make two concurrent likers contend
on the same document. A separate collection keeps post documents small and makes
"who liked this" a paginated query instead of a document field. The same argument
applies to `Follow` versus a `following: []` array.

### Index builds are a deploy step, not a boot step

`autoIndex` is **off in production**. With it on, every container asks Mongo to
build indexes on every deploy and every autoscale event — invisible at 50
documents, minutes of heavy I/O on the primary at 50 million, triggered by the very
traffic spike that caused the scale-out. Indexes are built once, deliberately, by
`npm run indexes`.

---

## 9. Horizontal scaling

### The API is stateless — and that is a property you *keep*, not one you add

Nothing that matters lives in an API process:

| State               | Where it does**not** live | Where it lives                             |
| ------------------- | ------------------------------- | ------------------------------------------ |
| Sessions            | In-process memory               | JWT (self-verifying) + Mongo for refresh   |
| Rate-limit counters | In-process`Map`               | **Redis**                            |
| Cached feed         | Module-scope object             | **Redis**                            |
| In-flight jobs      | The event loop                  | **Redis (BullMQ)** → worker process |
| Uploaded images     | Container disk                  | **Cloudinary**                       |

Therefore: **any container can serve any request** (no sticky sessions), a
container can be killed mid-deploy without losing work, and handling 10× the
traffic means running 10× the containers.

A single `Map` cached at module scope — the most natural optimisation in the world
— would silently break all three. This is why the layering matters: there is one
obvious place for shared state, and it is not the process.

### Auth is stateless on the hot path, stateful only where it must be

The **access token** is a self-contained JWT: any container verifies it with the
shared secret, having never seen the user before. No session lookup on the hot
path.

The **refresh token** is deliberately *not* stateless — its hash is stored, and it
rotates on every use. A pure JWT cannot be revoked: "log out everywhere" is
impossible and a stolen token is valid until it expires. Storing the hash makes the
refresh path revocable, and it runs roughly once a day rather than on every
request, so it costs the hot path nothing.

### The API and the workers scale independently

They fail differently and scale differently. A traffic spike needs more API
containers; a celebrity posting needs more fan-out workers. Running them in one
process means you cannot buy one without buying the other — and a worker chewing
through a 1,000-batch fan-out would be doing it *on the event loop that is supposed
to be answering HTTP requests*.

### Graceful shutdown

Both processes handle SIGTERM. The API stops *accepting* new connections while
letting in-flight ones finish; the worker drains its current jobs. Without this,
every deploy drops a fraction of live traffic — invisibly, because the errors
happen in the browser and not in your logs.

### Health checks report Redis but do not fail on it

`/api/health` reports Redis as `ready` / `degraded` / `disabled` but stays `200`
when Redis is down. A health check that failed on a Redis blip would have the load
balancer pull **every** container out of rotation simultaneously — converting a
cache outage into a total outage.

---

## 10. Rate limiting

Counters live in **Redis**, and this is the change that most directly makes the API
horizontally scalable.

`express-rate-limit`'s default store is a `Map` in process memory. With one server
that is fine. Behind a load balancer it is quietly, seriously broken:

- Each of N instances keeps its **own** counter, so a "20 attempts / 15 min" login
  limit is really **20 × N**. At ten instances an attacker gets 200 attempts — the
  limit that exists to stop credential stuffing has been multiplied by exactly the
  number of servers you added to handle the load.
- Counters die with the process: a deploy, a crash, or an autoscaler scaling in
  resets everyone's budget.
- Which instance you hit is a coin flip, so the limit a user *experiences* is
  nondeterministic.

| Limiter           | Budget                              | Keyed by                 |
| ----------------- | ----------------------------------- | ------------------------ |
| `authLimiter`   | 20 / 15 min,**failures only** | IP                       |
| `writeLimiter`  | 60 / min                            | **User**           |
| `globalLimiter` | 600 / min                           | User, falling back to IP |

**Authenticated requests are keyed by user, not IP.** An office, a university or a
mobile carrier NATs thousands of people behind one address; rate-limiting them as
one client means a single heavy user can lock out an entire building. The IP is
kept for the *anonymous* endpoints (login, register) — where it is all we have, and
where it is also the *right* key, since the attack being defended against there is
one machine trying many accounts.

**Each limiter has its own Redis prefix** (`rl:auth:`, `rl:write:`, `rl:global:`).
Sharing a prefix would mean sharing a *counter*: every ordinary request would burn a
slice of the same user's login budget, and whichever limiter touched the key first
would set the TTL — so a 15-minute auth window could be silently reset by a
1-minute global one. The effective limits would be neither of the configured
numbers.

`app.set('trust proxy', 1)` is what makes `req.ip` the real client address rather
than the load balancer's.

---

## 11. CDN and Cloudinary

**No image ever touches the API's disk.** Multer buffers the upload in memory (5MB
cap) and streams it straight to Cloudinary. A container filesystem is ephemeral —
wiped on every redeploy — and *not shared between instances*, so a disk-backed
upload is both a data-loss bug and a horizontal-scaling bug.

**The database stores only the bare file name** — not a path, not a URL:

```text
image: "qk3n8x2vp1aw7dyt"   →   https://res.cloudinary.com/<cloud>/image/upload/
                                 f_auto,q_auto,c_limit,w_1200/buddyscript/posts/qk3n8x2vp1aw7dyt
```

The folder and the delivery host are **configuration, not data**. Moving CDN,
renaming the folder, or changing the delivery transformation becomes a config edit
rather than a migration over every post ever written.

**Delivery transformations** (`f_auto,q_auto,c_limit`): AVIF/WebP to browsers that
accept it and JPEG to those that don't; per-image quality tuned against the actual
content; never upscale. The client builds a `srcset` from the same file name, so a
phone requests a 400px image instead of downloading 1200px to paint it 390px wide.

**Downscaled once, on the way in** (1600px limit). A 12MP phone photo is stored at
a size already larger than any slot the feed renders it in — so we pay for pixels
nobody will see exactly *zero* times, rather than on every read. The re-encode also
strips EXIF, which carries the GPS coordinates the photo was taken at.

**Variants are pre-generated by the media worker.** Cloudinary renders a
transformation on *first request*, so without this the first person to scroll past
a new post pays several hundred milliseconds of transform latency — and if the post
lands on a thousand feeds at once, a thousand people race to trigger the same
transform. The worker requests the whole `srcset` ladder up front, so the first
viewer gets a CDN cache hit like everyone else.

**Security**: the client's filename is never used (it can carry `../../server.js`
or `evil.php.png`); Cloudinary mints a random name, `overwrite: false` means one
upload can never clobber another, and `resource_type: 'image'` decodes the bytes —
which is the control that actually holds, since the MIME type multer filtered on is
client-supplied.

**Immutable URLs**: names are unique and assets are never overwritten, so a given
URL always resolves to the same bytes — which is what makes it safe to cache them
at the edge forever.

---

## 12. Error handling and structured logging

### Structured logs (pino)

`console.log` produces a *string*. A string is fine for one server you are watching
in a terminal and useless across twenty containers behind a load balancer: you
cannot filter it, group it, or alert on it. Pino emits **one JSON object per line**,
so *"every 5xx on the feed route in the last hour, grouped by user"* becomes a query
rather than a grep.

### Correlation IDs

Every request gets an id (adopted from `X-Request-Id` if the edge already minted
one, so a single id spans the whole edge-to-database path). It is carried through
`AsyncLocalStorage`, so a **repository three calls deep can log and the line still
carries the request id** — without a logger being threaded through every function
signature in the codebase. It is returned to the client in the response body and
the `X-Request-Id` header.

The payoff: a user says "it failed around 3pm", and instead of grepping twenty
containers for a plausible stack trace, you ask for the id and get *the exact
request* — every query, every cache miss, every job it enqueued, in order.

### Errors

`middleware/error.js` translates the exception vocabulary of every library we
depend on into **one response shape**. A client should never have to know that a
duplicate email surfaces as a `MongoServerError` with `code: 11000` — that is our
implementation leaking, and it would become a breaking change the day we swapped a
library out.

The split that matters:

- **The log** gets the full error — stack, cause, the lot — plus the request id.
- **The response** gets only what is safe to say out loud. In production a 500's
  real message is never echoed: it is written by a library we do not control and
  can name internals we would rather not publish.

Log **level by outcome**: 5xx → `error`, 4xx → `warn`, health checks → not logged.
Without this, every 404 from a bot probing for `/wp-admin.php` is an ERROR — and a
log full of errors that don't matter is a log nobody reads, which is how the one
that *does* matter gets missed.

Secrets (`authorization`, `cookie`, `password`, `*token*`) are **redacted at the
logger**, not at each call site — a call site can be forgotten.

---

## 13. Configuration

All configuration is environment-based, validated once at boot in `config/env.js`.
**The process refuses to start if a required variable is missing** — failing at boot
beats failing on the first request that happens to need it.

**Redis is required in production, optional in development.** In production it is
load-bearing (rate limits, cache, queues), and running without it would silently
fall back to per-instance state that is *wrong* the moment there is more than one
instance — so a production boot with no `REDIS_URL` fails loudly.

In development, demanding a running Redis just to read the feed would make the
project harder to run than it has to be. Without a URL the app boots in **degraded
mode** — cache is a no-op, rate limits are in-memory, jobs are dropped — and *every
one of those is announced at startup*, so degraded mode can never be mistaken for
the real thing.

Key knobs: `FEED_CELEBRITY_THRESHOLD`, `FEED_FANOUT_BATCH_SIZE`,
`FEED_TIMELINE_MAX_LENGTH`, `CACHE_*_TTL`, `RATE_LIMIT_*`, `LOG_LEVEL`.
See `.env.example`.

---

## 14. Failure modes: what happens when each piece dies

| What dies                  | What happens                                                                                                                                                                        | Why                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Redis**            | Site stays**up**, slightly slower. Feeds read from Mongo. Requests pass the rate limiter uncounted. Jobs are dropped (logged loudly). Recovers on its own when Redis returns. | Every cache call fails open. Health check reports`degraded` but stays `200`, so the LB doesn't pull every container at once. |
| **A worker**         | Posts still succeed. Fan-out/notifications queue up and drain when a worker returns.                                                                                                | Jobs are durable in Redis. Verified: a follow notification queued while no worker ran was consumed on worker start.              |
| **All workers**      | Feeds still work — timelines fall back to a**Mongo rebuild** on cold read.                                                                                                   | The timeline holds nothing that isn't reconstructible from the posts collection.                                                 |
| **An API container** | LB routes around it. In-flight requests drain on SIGTERM.                                                                                                                           | The API is stateless; graceful shutdown.                                                                                         |
| **MongoDB**          | Site is down.                                                                                                                                                                       | It is the source of truth. This is the one dependency with no fallback — see §16 (replicas).                                   |
| **Cloudinary**       | Text posts work; image uploads fail with a clear 4xx. Existing images still serve from the CDN.                                                                                     | Upload failure is surfaced, not swallowed; the post row is never written without its image.                                      |

### "Fails open" is harder than it sounds — three bugs that had to be fixed

Writing `try { cache.get() } catch { readMongo() }` does **not** give you a
fail-open cache. Killing Redis against a running server exposed three *separate*
ways the API still died, none of which were visible by reading the code:

1. **The rate limiter 500'd every request.** It runs before every route, and
   `express-rate-limit` propagates a store error to the error handler by default. A
   perfect fail-open cache is worthless if the limiter rejects the request before a
   controller is ever reached. → `passOnStoreError: true`.

2. **Requests hung for 13+ seconds rather than failing.** ioredis *buffers* commands
   issued while disconnected and replays them on reconnect — so a `GET` during an
   outage does not fail, it simply never returns. The limiter's `passOnStoreError`
   never fired, because the store never *errored*. → `commandTimeout`, plus an
   instant reject when the connection is in a known-dead state (`reconnecting` /
   `end` / `close`), so a request costs nothing instead of waiting out a timeout.

3. **Posting hung forever.** BullMQ mandates `maxRetriesPerRequest: null`, so
   `queue.add()` retries *indefinitely* — and `createPost` awaits it. → the enqueue
   is time-bounded and short-circuits on a dead connection. The post row is already
   written; a queue that will not answer must not hold the user's request.

The lesson generalises: **a fallback path that is never exercised is a fallback path
that does not work.** All three of these read as correct on the page.

*Verified: with Redis killed mid-flight, `GET /api/posts`, `GET /api/feed`,
`POST /api/posts` and `POST /api/likes/toggle` all keep answering in under 500ms,
the process stays alive, `/api/health` reports `degraded` (but `200`, so the load
balancer does not evict every container), and the cache repopulates by itself when
Redis returns.*

---

## 15. Known trade-offs

Stated plainly, because a design document that lists only wins is marketing.

1. **The discovery feed head is up to ~20s stale.** Deliberate (§6). The author
   doesn't notice — the client splices their own post in locally.
2. **Enqueue is not transactional with the DB write.** A crash in the gap loses the
   job. Acceptable for a notification; fixed by an outbox (§16).
3. **Unfollowing does not scrub the timeline.** The unfollowed author's existing
   posts age out as new ones arrive, rather than being scanned and removed on a
   user action. An unfollow takes effect immediately for *new* posts and decays for
   old ones.
4. **Fixed-window rate limiting**, not sliding. A user can spend their whole budget
   in the last second of one window and again in the first second of the next. A
   sliding window costs a sorted set per client; not worth it yet.
5. **Fan-out batches chain rather than parallelise.** Trades wall-clock for
   crash-safety and back-pressure (§5).
6. **A user right at the celebrity threshold flip-flops** between push and pull as
   their follower count crosses it. Harmless — the read path merges both halves and
   dedupes — but it means a post made near the boundary may be delivered by either
   route.

---

## 16. Future improvements

The order below is roughly the order in which the current design would actually
start to hurt.

### Read replicas (the first thing that breaks)

Every read currently hits the primary. Route feed reads, comment lists and liker
lists to secondaries with `readPreference: secondaryPreferred` — a `repositories/`
change and nothing else, which is exactly the point of the layer. Writes and
authorization checks stay on the primary (replication lag would let a stale read
say "this post is public" a moment after it was made private).

### Transactional outbox

Removes trade-off #2. Write the job into an `outbox` collection **in the same
transaction as the post**, and have a relay process publish it to BullMQ. The DB
write and the intent-to-enqueue become atomic; the relay retries until the queue
accepts it. Exactly-once *effects* (given the jobs are already idempotent) rather
than at-least-once *delivery*.

### Kafka

BullMQ is a *work queue*: a job is consumed once and gone. Kafka is a *durable,
replayable log* — many independent consumers read the same event at their own pace.

Swap when there are several consumers of the same event. Today one thing cares that
a post was created. When the answer is "fan-out, **and** the search indexer, **and**
the ML ranker, **and** the analytics pipeline, **and** the moderation scanner", a
work queue is the wrong shape: you would be enqueuing the same event five times.
Kafka also lets a new consumer **replay history** — rebuild a search index from the
beginning of time — which a work queue simply cannot do.

### MongoDB sharding

When the working set outgrows one replica set's RAM.

- `posts` → shard on `{author: 1, _id: -1}` (hashed prefix). Author-scoped queries
  and the celebrity pull stay single-shard.
- `follows` → shard on `{following: 1}`, so the fan-out walk for one author stays
  on one shard.
- `likes` → shard on `{target: 1}`, keeping "who liked this post" single-shard.

Avoid a monotonically increasing shard key (`_id` alone): every insert would land
on the same shard, and that shard becomes the write bottleneck for the whole
cluster.

### Feed ranking

The feed is currently reverse-chronological. Ranking (engagement, affinity,
recency-decay) is a scoring service that reorders the *candidate set* the timeline
already produces — which is why the timeline stores ids rather than a rendered page.
The current design does not have to change to accommodate it.

### Push notifications

The `notification` worker is the seam. "Write a row" becomes "write a row, look up
the recipient's devices, call APNs/FCM, respect quiet hours, collapse into 'Alice
and 12 others'" — hundreds of milliseconds across three third-party services, any
of which can be down. All of it can be built behind that boundary without a
millisecond reaching the request that triggered it.

### Microservices

**Not yet, and the reason matters.** The layering here (`controller → service → repository`) already gives the *modularity* benefit; splitting into services would
add network latency, distributed transactions, and independent deploys for no
present gain.

The honest signal to split is **organisational, not technical**: when separate teams
need to deploy on separate cadences, or when one component's scaling profile
genuinely diverges (media processing wanting GPUs, say). The natural first seams are
already drawn — `media`, `notification`, and `fanout` are separate workers with
separate queues today, so extracting one is a deployment change rather than a
rewrite. That is the point of having drawn them.

### Split Redis: cache vs queues

Today one Redis holds both. They have **opposite eviction requirements**, and a
single instance cannot satisfy both:

- The **cache** is disposable. Evicting it costs latency, nothing more — an LRU
  policy is exactly right.
- The **queues** are not. An evicted BullMQ job is a post that never reached its
  followers, and it vanishes silently.

An LRU policy cannot tell them apart: under memory pressure it would delete *queued
jobs* to make room for cached posts. So the deployment pins `maxmemory-policy noeviction` (see `render.yaml`), which makes Redis *reject writes* rather than lose
data — loud instead of silent. That is the correct trade at this size, but it means
a cache big enough to fill memory starts rejecting writes.

The fix is two instances: an **LRU** one for the cache and a **noeviction** one for
the queues. `config/redis.js` already returns two separate clients, so this is a
URL change, not a refactor.

### Smaller wins

- **Sliding-window rate limits** (removes trade-off #4).
- **Cache stampede lock** — a mutex on cache miss so only one request rebuilds a hot
  key while the rest wait, rather than a thousand simultaneously querying Mongo for
  the same post.
- **`likedByMe` via Redis sets** — a per-user set of liked post ids would make the
  last per-page Mongo query a Redis `SMISMEMBER`.
- **WebSockets / SSE** for live like and comment counts.
- **OpenTelemetry traces** — the request id already correlates the logs; spans would
  show *where the time went*.
