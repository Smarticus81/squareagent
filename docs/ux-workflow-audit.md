# UX Workflow Audit — VoyceLab

Full-journey trace of every surface a user touches: the operator dashboard
(`voycelab-landing`), the voice PWA (`voice-agent-pwa`), the native iOS/Android
wrapper (`mobile/`, an Expo WebView shell around the deployed PWA), and the API
behaviors that shape perceived UX. Each flow was traced through
the code (entry → route → state → API → terminal states), then audited for
step count, state loss, feedback gaps, and unhappy paths.

Severity: **Blocker** (task fails or work is lost) · **Friction** (unnecessary
steps/waits/confusion) · **Polish** (minor but measurable).

Status: ✅ fixed in this change · ⏭ recommended follow-up.

---

## Journey maps (as-built)

### Dashboard: signup → first working assistant
~7 user actions: signup form → 3-step onboarding wizard (name → connect
Square via full-page OAuth round-trip + location pick, skippable → voice
pick) → Launch (creates profile, mints an exchange code, opens the PWA in a
new tab). Assistant name persists across the OAuth redirect via
sessionStorage.

### Dashboard: daily management
Assistants grid → detail modal (launch / reconfigure / remove), Connected
services (venues + Gmail/knowledge/database), Settings (profile, password,
usage meter, billing portal). No route-level auth guard — every gated page
renders, then bounces to `/login` from an effect.

### PWA: voice session
Signed-in boot resolves stored session or `?code=` launch code. Where the
browser supports SpeechRecognition (not iOS Safari), the app auto-enters
ambient wake mode with a pre-warmed standby WebRTC session: 0 taps to speak.
Everywhere else: 1 tap (mic permission probe on first tap). Orders are fully
optimistic client-side; tools execute server-side via `POST
/api/realtime/tools`. Workflows run from the order panel over SSE.

---

## Blockers

| # | Finding | Where | Status |
|---|---------|-------|--------|
| B1 | Raw Square `fetch` calls had **no timeout** — a Square outage hung a spoken command (and the workflow SSE stream) indefinitely; the circuit-breaker `SquareClient` was never used by tools | `api-server/src/lib/square-helpers.ts`, all `tools/*.ts`, connectors | ✅ `squareFetch` wrapper: 10s hard timeout, speakable error ("Square did not respond in time"), applied to all Square call sites |
| B2 | Workflow SSE **buffered the entire run**, then dumped all steps at once — no live progress for end-of-day close etc. | `routes/v1/workflows.ts`, `workflows/engine.ts` | ✅ per-step callback streams each `step` event as it completes |
| B3 | Mid-session WebRTC failure was **silent**: ICE state never observed, UI stuck on "Listening", or silently dropped to wake mode | `voice-agent-pwa/src/contexts/VoiceAgentContext.tsx` | ✅ `pc.onconnectionstatechange` → "Connection lost. Tap the orb to reconnect." + one-tap reconnect on the orb |
| B4 | Dashboard "Open assistant" **swallowed all errors** (`console.error`) — a blocked popup or failed exchange looked like a dead button | `voycelab-landing/src/pages/assistants.tsx` | ✅ inline error in the modal; on popup-block, renders the launch URL as a clickable link |
| B5 | Onboarding "Launch" **silently no-oped** when `organizationId` wasn't provisioned yet | `voycelab-landing/src/pages/onboarding.tsx` | ✅ explicit "workspace still being set up" error |
| B6 | iOS home-screen install showed a **blank icon** (SVG-only manifest icons, no `apple-touch-icon`) | `voice-agent-pwa/public/`, `index.html` | ✅ rendered `icon-512.png` + `apple-touch-icon.png`, added manifest entry + `<link rel="apple-touch-icon">` |
| B7 | Wake word depends on `webkitSpeechRecognition`, which **iOS Safari does not implement** — the ambient/0-tap design silently degrades to tap-only with no messaging | `voice-agent-pwa/src/hooks/useWakeWord.ts` | ✅ (messaging) orb hint now explains hands-free wake is unavailable; ⏭ a server-VAD ambient fallback would restore 0-tap on iOS |

## Friction

| # | Finding | Where | Status |
|---|---------|-------|--------|
| F1 | Signed-in PWA users **flashed "Voice Terminal Offline / Sign in"** during boot (no loading state before credentials resolve) | `App.tsx` / `SquareContext.tsx` | ✅ exposed `credentialsReady`; boot shows "Waking up…" until resolved |
| F2 | A second tap while "Connecting" **cancelled the connect** | `App.tsx` | ✅ taps during connect are ignored |
| F3 | Confirmation banner rendered **twice** when the order panel was open | `App.tsx` + `OrderPanel.tsx` | ✅ floating banner suppressed while panel is open; also now respects iOS safe-area |
| F4 | Cart, i.e. the live order ticket, was **lost on refresh / iOS tab eviction** | `OrderContext.tsx` | ✅ draft order persists to sessionStorage per tab |
| F5 | Session minutes: `/end` was **not idempotent** (pagehide+beforeunload double-fire = double billing); iOS often skips `beforeunload` so sessions never finalized | `routes/realtime.ts`, `VoiceAgentContext.tsx` | ✅ server dedupes ended sessions (incl. after sweeper autoflush); client also listens to `pagehide` |
| F6 | Ambient-mode **mic denial showed nothing** — orb stuck at "Waking up" | `useWakeWord.ts` / `App.tsx` | ✅ `onPermissionDenied` surfaces "Microphone blocked…" and stops the retry loop |
| F7 | Deep link into a gated dashboard page **lost the destination** after login (always landed on `/assistants`) | all gated pages + `login.tsx` | ✅ `post-login-redirect` helper stores and consumes the intended path |
| F8 | Venue "Disconnect" deleted **without confirmation** (assistant delete has one) | `connected-services.tsx` | ✅ confirm dialog |
| F9 | Edit-assistant load failure left an **editable empty form** — saving would overwrite the live profile | `create-assistant.tsx` | ✅ save disabled with explanatory error until reload |
| F10 | Landing hero "See it in action" scrolled to an **unmounted section** (`#voice-demo` never renders) | `landing.tsx` | ✅ anchor retargeted to the live hero demo orb |
| F11 | Square OAuth redirect-mode token-exchange failure landed users on an **orphan popup page** with no way back | `routes/square.ts` | ✅ redirect mode now returns to the app with `oauth_error` |
| F12 | Workflow steps whose executor failed were reported **✓ ok** (errorMiddleware converts throws into "Tool error:" strings) | `workflows/engine.ts` | ✅ error-shaped results now mark the step failed |
| F13 | `theme-color` meta (`#FFFFFF`) vs manifest (`#07080A`) mismatch — splash/status-bar flash | `index.html`, `manifest.json`, `OrderPanel.tsx` | ✅ aligned; meta now tracks the theme toggle |
| F14 | `POST /api/realtime/session` runs 5+ **serial DB round trips** before minting the OpenAI token — all of it in front of the "Connecting" spinner | `routes/realtime.ts:696-918` | ⏭ parallelize the independent lookups (usage aggregate, profile, ownership, service connections) |
| F15 | Every spoken command re-runs a **full usage aggregate query** | `routes/realtime.ts:949-979` | ⏭ cache the snapshot per session |
| F16 | Billing failures split across 402 and 403 with **no machine code** — clients can't distinguish "re-auth" from "upgrade" | `routes/auth.ts`, `routes/realtime.ts` | ⏭ unify on 402 + `code` field, deep-link to billing |
| F17 | Pending OAuth state is **in-memory** — a redeploy mid-OAuth forces the user to restart the connect flow | `routes/square.ts:92` | ⏭ persist pending state alongside the existing DB-backed claims |
| F18 | No **unsaved-changes guard** on any dashboard CRUD form | `create-assistant.tsx` etc. | ⏭ `beforeunload` guard when dirty |
| F19 | Workflow one-tap buttons exist only in the PWA, **not the operator dashboard** | — | ⏭ product decision |

## Native mobile wrapper (`mobile/`)

The Expo app is a WebView shell around `https://www.voycelab.com/agent/`, so
every PWA fix above reaches native users automatically on deploy. Wrapper-level
findings:

| # | Finding | Status |
|---|---------|--------|
| M1 | iOS reclaims the WKWebView content process under memory pressure (routine for an always-on venue screen) — the app was left showing a **dead white view** until force-quit; same for Android render-process death | ✅ `onContentProcessDidTerminate` / `onRenderProcessGone` now auto-reload |
| M2 | Square/Clerk OAuth started inside the WebView is routed to the **system browser**, but the OAuth return then lands in Safari's copy of the web app, not back in the native app — the user's in-app session never learns the connection succeeded | ⏭ needs universal links (AASA) or in-app OAuth completion; connect Square from the dashboard in the meantime |
| M3 | The `voycelab://` scheme is declared in `app.json` but **incoming deep links are never handled** — the dashboard's "Open assistant" launch codes (`?code=…&agentProfileId=…`) can't target the native app | ⏭ handle `Linking` initial/updated URLs and append the query to the WebView source |
| M4 | Status bar is hard-coded dark-on-light; the PWA's dark theme will mismatch | ⏭ read the WebView theme (postMessage) or follow system appearance |

## Polish

- ✅ Hashed Vite assets now served `immutable, max-age=1y`; `index.html`/`sw.js`/`manifest.json` `no-cache` (`app.ts`) — previously every chunk revalidated on every load.
- ⏭ Voice "submit" trusts the model blindly (`markVoiceOrderSubmitted`) — gate the SUBMITTED receipt on a success flag from the tool result.
- ⏭ Heartbeat failures are swallowed client-side; a 402 mid-session should update the overage banner / end the session.
- ⏭ Live OpenAI sessions are never recycled before the provider's max session age (only standby is) — long conversations drop without warning.
- ⏭ Demo rate limit is keyed on first `x-forwarded-for` hop — corporate NAT shares one bucket.
- ⏭ "Push to talk" noise mode labels a hold-to-talk interaction the UI doesn't implement (it's tap-to-toggle).
