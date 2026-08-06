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
