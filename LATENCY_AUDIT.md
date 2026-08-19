# VoyceLab Latency, Efficiency & Scalability Audit

Rolling audit of the VoyceLab monorepo against three targets:

- **Sub-200ms p95 tool execution** (API → Square → response)
- **Sub-500ms initial WebRTC connection setup**
- **Horizontal scalability on Railway** without rewriting core stateful assumptions

Each phase records findings, the concrete change, before/after (measured or
estimated), risk, and a running **Scale Readiness Score**.

---

## Phase 1 — Critical Path Latency (Voice → Tool → Square → Response)

### Hot path traced

```
PWA  ──POST /api/realtime/session──▶  mint ephemeral OpenAI token + server-built instructions
     ◀──────────────────────────────  client_secret + instructions + greeting
PWA  ══WebRTC (direct to OpenAI)═══▶  user speaks → OpenAI transcribes → tool call on data channel
PWA  ──POST /api/realtime/tools────▶  auth → gating → Square op → ToolResult
     ◀──────────────────────────────  { result, command }
```

The `/session` mint is once-per-conversation; **`/tools` runs on every spoken
command** and is the latency-critical surface for the sub-200ms target.

### Findings

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| 1.1 | `routes/realtime.ts` `POST /tools` | A `sum(usage_events.quantity)` aggregate over a rolling 30-day window ran on **every tool call** for the overage-cap check, *before* Square is touched. | Ever-growing scan on the hot path; DB query rate scales with tool volume per tenant. |
| 1.2 | `routes/realtime.ts` `POST /tools` | `hasGeneralConnectedSystems` fired **three** `... limit 1` existence probes (email / knowledge / external-db) on every tool call, purely for tool gating. | 3 extra DB round trips per spoken command. |
| 1.3 | `routes/realtime.ts` `POST /tools` | `currentOrganizationId(req)` was resolved **twice** per request (overage check + main body), each able to trigger `ensureUserOrganization` (a write on cold path). | Duplicate round trip / redundant work. |
| 1.4 | `lib/secrets.ts` | `encryptionKey()` re-derived the AES-256-GCM key via HMAC-SHA256 on **every** `encrypt`/`decrypt`. Credential-cache decrypt-on-read paid this each miss. | Avoidable synchronous CPU on the credential path. |

The middleware pipeline itself was already sound: `auditMiddleware` is
`setImmediate` fire-and-forget (non-blocking), `confirmationMiddleware` short-
circuits with no Square calls (confirmations disabled by default), and
`errorMiddleware` normalizes throws. No async waterfall to unwind there.

### Changes

1. **`lib/usage-cache.ts` (new)** — short-TTL (`USAGE_CACHE_TTL_MS`, default
   **15s**) per-tenant cache of the 30-day voice-minutes total. Both `/session`
   and `/tools` overage checks now call `getCachedVoiceMinutes()`. Voice minutes
   only accrue via the 60s heartbeat + session-end POST, so ≤15s staleness is
   immaterial to cap enforcement. Session-end and stale-session autoflush call
   `invalidateUsage()` so a just-billed session reflects immediately.
2. **`lib/connected-systems-cache.ts` (new)** — short-TTL
   (`CONNECTED_SYSTEMS_CACHE_TTL_MS`, default **60s**) per-org boolean cache for
   `hasGeneralConnectedSystemsCached()`, replacing the 3 probes per tool call.
   Falls back to `false` on DB error (degrade to venue-only tools, never fail).
3. **`currentOrganizationId(req)`** — memoized on the request object
   (`req._resolvedOrganizationId`) so it resolves at most once per request.
4. **`lib/secrets.ts`** — derived key memoized, keyed by the resolved key
   source, re-deriving only if the env-var source changes (test safety).

Dead code removed from `realtime.ts`: the inline `hasGeneralConnectedSystems`
helper, the now-unused `tenantWhere` helper, and the `sql / gte / isNull / or`
drizzle imports plus three unused table imports.

### Before / After (estimated per `/tools` call, warm caches)

| Cost | Before | After |
|------|--------|-------|
| `usage_events` SUM aggregate | 1 per call (grows w/ table) | ~1 per 15s per tenant |
| connected-systems probes | 3 per call | ~1 per 60s per org |
| org-id resolution | up to 2 per call | 1 per request |
| key derivation (per decrypt) | 1 HMAC per call | 1 per process |

For a venue doing back-to-back voice commands, steady-state DB round trips on
the pre-Square portion of `/tools` drop from **~5+ to ~1** (credentials, itself
cached 5m). This is pre-Square overhead removed from the p95 budget; the Square
call itself remains the dominant term and is addressed next.

### Risk

**Low.** All changes are in-process caches with TTL-bounded staleness and
explicit invalidation on the write paths that matter (usage). No response shapes
changed; skills/tier gating untouched; "server authoritative" preserved. New
infra: none — pure Node maps, Railway-compatible. Cap enforcement is preserved
(worst case a tenant is ≤15s late being blocked, already true given 60s
metering). Connected-systems gating can lag a newly-added system by ≤60s
(documented; wire `invalidateConnectedSystems` into the connect/disconnect
routes to close this — deferred, non-blocking).

### Validation

`pnpm typecheck` ✅ · `pnpm build` ✅ (all four artifacts, exit 0).

### Still open in Phase 1 (next iterations)

- Instruction/token-bloat audit of `buildRealtimeSessionConfig` (measure composed
  prompt token count; the demo `MOCK_BAR_PERSONA` + skill segments are large).
- `square-helpers.ts` intra-request redundancy (catalog/location/order fetched
  more than once per tool execution?) — request-lifecycle memoization.
- `catalog-cache.ts` stale-while-revalidate vs. flat 5m TTL for high-traffic venues.

### Scale Readiness Score: **5 / 10**

Blockers for horizontal scaling (unchanged by Phase 1, to be addressed in Phase 3):
- `SessionStore`, `heartbeatMap`, `endedSessions`, demo order/rate-limit maps are
  **per-process in-memory** — multi-instance would split state.
- WebSocket relay pins connections to one process (sticky-session dependency).
- New caches are per-process (acceptable: they degrade to more DB hits, not
  incorrectness, under multi-instance — no coordination required).

_Phase 1 reduces per-call DB load and CPU on the hot path without touching the
scaling blockers, which are structural and gated behind the "ask before infra"
rule._

---

## Phase 2 — Database & Drizzle Efficiency

> Phase 1 merged to `master` (PR #56). This phase branches fresh from the updated
> `master`, per the merged-PR workflow.

### Findings

| # | Location | Issue | Verdict |
|---|----------|-------|---------|
| 2.1 | `routes/v1/usage.ts` `GET /usage/current` | Three **independent** reads (voice-minutes SUM, top-tools GROUP BY, recent-errors) ran **serially** — three round trips of wall-clock for a dashboard render. | **Fixed** — `Promise.all`. |
| 2.2 | `lib/db/src/index.ts` | `pg.Pool` `max` hard-coded to 20 with no saturation visibility. On multi-instance Railway, `instances × 20` can blow the Postgres `max_connections` budget silently. | **Fixed** — env-tunable `DATABASE_POOL_MAX` + opt-in `waitingCount`/`idle`/`total` metrics. |
| 2.3 | `tools/middleware.ts` `auditMiddleware` | `tool_calls` write. | **OK** — already `setImmediate` fire-and-forget, off the response path. |
| 2.4 | `routes/realtime.ts` `usage_events` writes | Session-end + stale-session autoflush inserts. | **OK** — not on the tool hot path (session lifecycle only); await is fine there. |
| 2.5 | `tools/general/knowledge.ts` vector search | HNSW `<=>` cosine search with `ORDER BY distance LIMIT` — uses the index correctly. Index built out-of-band (`scripts/enable-pgvector.ts`) with `m=16, ef_construction=200` (sound). Query-time `hnsw.ef_search` is **unset** (defaults to 40). | **OK / documented** — see proposals. |
| 2.6 | `routes/realtime.ts` | Agent-profile + service-connection + credentials fetched as separate reads on the hot path. | **Mitigated in Phase 1** (all cached). Folding the `service_connections.provider` read into the profile cache via a join is a further win — proposed below. |

### Changes

1. **`routes/v1/usage.ts`** — the three dashboard queries now run under a single
   `Promise.all`. Response shape unchanged. Wall-clock ≈ slowest single query
   instead of the sum of all three (~3× fewer serial round trips on this route).
2. **`lib/db/src/index.ts`** — `max` reads `DATABASE_POOL_MAX` (default 20);
   added opt-in pool-saturation logging (`DATABASE_POOL_METRICS=1`,
   interval `DATABASE_POOL_METRICS_MS`, default 60s; timer `unref`'d). This is
   the instrument needed before any horizontal-scale decision on pool sizing.

### Proposals (no infra change made — flagged for approval)

- **Usage rollup / counter cache (2.3-scale).** `GET /usage/current` and the
  hot-path cap check both `SUM` over a growing `usage_events` window. Phase 1
  caches the hot-path total (15s TTL); at higher scale a **PostgreSQL-only**
  daily rollup table (or a per-organization `voice_minutes_used` counter column
  updated on each usage-event insert) removes the aggregate entirely. No Redis
  required — this is the Railway-compatible fallback path. **Deferred pending
  approval** (schema change + migration).
- **`ef_search` tuning (2.5).** If recall on knowledge search needs raising,
  wrap the query in a transaction with `SET LOCAL hnsw.ef_search = 64` (a plain
  pooled `query` can't carry a session `SET`). `ivfflat` is **not** recommended
  unless HNSW memory pressure appears — HNSW gives better recall/latency at this
  corpus size. Measurement-gated; no change made.
- **Profile-join for service provider (2.6).** Extend `agent-profile-cache` to
  carry the bound connection's `provider`, eliminating the per-`/session` and
  per-`/tools` `service_connections` lookup. Small cache-shape change; deferred
  to keep this phase incremental.

### Risk

**Low.** `Promise.all` parallelization is behavior-preserving (independent
queries, same result assembly). Pool `max` defaults to the previous value 20
when the env var is unset; metrics are opt-in and `unref`'d so they never hold
the process open. No response shapes, gating, or server-authoritative behavior
changed. No new infrastructure.

### Validation

`pnpm typecheck` ✅ · `pnpm build` ✅ (all four artifacts, exit 0).

### Scale Readiness Score: **6 / 10**

Up from 5: pool sizing is now tunable **and observable** (the prerequisite for a
safe horizontal-scale cutover), and the dashboard read path is parallelized.
Unchanged blockers remain the in-memory session/heartbeat state and the
single-process WS relay (Phase 3), plus the still-growing `usage_events`
aggregate whose scale-proof fix (rollup/counter) is proposed above and awaits
approval.

---

## Phase 3 — Scalability & State Assumptions

> **Audit + documentation phase.** Per the project rule ("no new infrastructure
> without asking first"), this phase makes **no infra change** — it maps the
> stateful assumptions, flags each horizontal-scaling blocker, and proposes both
> a **PostgreSQL-only** path and a Redis alternative for approval. The current
> single-instance Railway deployment is correct as-is; everything below is about
> what a *multi-instance* cutover would require.

### Two distinct runtime surfaces

The platform has two voice transports with **different** state profiles:

1. **WebRTC (browser PWA)** — `POST /session` mints a token (stateless), then
   the browser talks **directly** to OpenAI. Tool calls come back to
   `POST /tools`. This surface is *almost* stateless per request; its only
   server state is `SessionStore` (the live order being built).
2. **WS relay (native / Expo)** — `ws-relay.ts` holds the entire session
   (catalog, order, upstream provider socket) in a **per-process closure** for
   the connection's lifetime.

### Findings — per-process state inventory

| State | Location | Under multi-instance | Severity |
|-------|----------|----------------------|----------|
| `SessionStore.memoryStore` | `lib/session-store.ts` | Write-through to `voice_sessions` exists, but `getSession()` is **memory-only** ("no DB fallback for now"). A `/tools` call routed to a different instance — or any instance after a restart — sees an empty session and rebuilds the order from scratch, losing the in-flight `squareOrderId` / items. | **Blocker** |
| WS relay closure | `routes/ws-relay.ts` | The client WS is pinned to the instance that accepted the `upgrade`. Inherent to WS relays — needs **load-balancer session affinity**; not a code defect. | **Blocker (affinity)** |
| `heartbeatMap` + autoflush sweeper | `routes/realtime.ts` | Voice-minute accrual is per-process; heartbeats for one session landing on different instances **split/undercount** minutes, and each sweeper only flushes its own map. | **High (metering)** |
| `endedSessions` dedup | `routes/realtime.ts` | Per-process; a duplicate `/end` (pagehide + beforeunload) hitting a *different* instance can **double-bill**. | **Moderate** |
| `demoSessionHits` | `routes/realtime.ts` | Per-process demo rate-limit → effective limit multiplies by instance count. | **Low** |
| `mockBarOrders` | `routes/realtime.ts` | Demo-only order store; demo tool calls must hit the same instance. | **Low (demo)** |
| New Phase 1/2 caches | `usage-cache`, `connected-systems-cache`, credential/catalog/profile caches | Per-process, but **degrade to extra DB reads, never incorrectness** — no coordination needed. | **None** |

**Filesystem / local state:** none required to serve a request. Static asset
serving (landing at `/`, PWA at `/agent/`) is read-only and horizontally safe.
Express sessions use `connect-pg-simple` (Postgres-backed), not local memory —
good.

### State-tier map

```
Request-serving state
├── Stateless (horizontally safe today)
│   ├── POST /session mint (token + instructions)
│   ├── Static file serving (landing, PWA)
│   ├── Auth / plan gating (JWT + Postgres session table)
│   └── L1 caches (credential/catalog/usage/connected-systems/profile)
│         → per-process, self-healing: miss = DB read, never wrong
├── Per-process, correctness-affecting under multi-instance
│   ├── SessionStore live order   → needs DB rehydrate (see proposal)
│   ├── heartbeatMap metering     → needs shared counter / sticky
│   └── endedSessions dedup       → needs shared set / sticky
└── Connection-pinned by nature
    └── WS relay session          → needs LB session affinity
```

### Proposals (nothing implemented — awaiting approval)

**PostgreSQL-only path (no new infrastructure — preferred for Railway):**
1. **Rehydrate `SessionStore` from `voice_sessions` on memory miss.** The
   write-through already persists `state` + `squareOrderId`; add an async
   `getSessionOrRehydrate(sessionId)` that falls back to a single indexed
   `SELECT` when `memoryStore` misses. Wiring it into `/tools` (that call site
   becomes `await`) makes the WebRTC surface **restart-safe and instance-
   agnostic** with zero new infra. *Cost:* one DB read on cold-session tool
   calls (rare — only first call after a restart / on a new instance).
2. **Session affinity for the WS relay.** Enable sticky sessions at the Railway
   edge / LB keyed on the session identifier so a native voice connection stays
   on one instance. No code change; a deploy-config change.
3. **Metering via usage_events, not `heartbeatMap`.** Flush heartbeat deltas to
   `usage_events` on a short cadence (or rely on the existing session-end write)
   and dedup `/end` via a short-TTL `voice_sessions.ended_at` column instead of
   the in-memory `endedSessions` set. Removes the split-metering and double-bill
   risks with a Postgres-only mechanism.

**Redis alternative (only if approved):** a shared KV for SessionStore + a
pub/sub fan-out for the WS relay would remove the affinity requirement entirely
and give O(1) shared counters for metering/rate-limit/dedup. **Not recommended
as the first step** — the Postgres-only path above unblocks horizontal scaling
without adding a dependency, and the rule requires a Railway-compatible fallback
regardless.

### Bundle audit (`artifacts/api-server/build.ts`)

`bundle: true` + `minify: true` + `define process.env.NODE_ENV="production"`
means esbuild tree-shakes and dead-code-eliminates by default. The `external`
list is computed as *all deps + devDeps minus a curated runtime allowlist minus
workspace packages*, so **dev dependencies (typescript, tsx, esbuild) are marked
external and never enter the bundle**. Output is a single ~2.0 MB minified
`index.cjs`. No type-definition or dev-tool leakage found. Minor future option:
prune the runtime `external` set further to bundle a few more hot deps for fewer
`openat(2)` syscalls at cold start — marginal, not pursued.

### Changes

**None (code).** Documentation + proposals only, per the "ask before infra"
rule. No files modified outside this audit entry.

### Risk

**None** — no code changed. The proposals are sequenced so the Postgres-only
path can land incrementally (rehydration first, then metering) behind approval,
each independently testable, with no rewrite of the existing single-instance
behavior.

### Scale Readiness Score: **8 / 10** (implemented)

Phase 3 PostgreSQL-only proposals landed:
- `SessionStore` DB rehydration on memory miss (`getSessionOrRehydrate`)
- Immediate persist on every tool mutation (`persistSessionNow`)
- Command idempotency ledger via `tool_calls.call_id`
- Exactly-once metering via `voice_sessions.finalized_at` + unique `usage_events.session_id`
- PostgreSQL-backed OAuth state and pending token claims
- Readiness probe at `/api/readyz`; Railway healthcheck updated
- Graceful shutdown drains relays and flushes dirty sessions
