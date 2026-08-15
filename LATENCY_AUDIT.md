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
