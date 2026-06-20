# VoyceLab — Platform & Agent Capabilities

VoyceLab is a voice-powered POS operations platform for hospitality venues (bars, restaurants, event spaces). Users create voice assistants that connect to Square POS and other business systems. Natural voice conversations turn into real actions — adding items, running reports, counting stock, taking payment, triaging email — synced live to Square and back.

This document is the complete reference for **everything the agent can do**, how the **Square integration** works end to end, and the **full list of every command (tool)** the assistant can call.

---

## 1. How the agent works (voice flow)

1. The browser PWA requests an ephemeral session token from `POST /api/realtime/session`. The server builds the persona, selects the voice engine, applies noise-mode VAD settings, gates tools by plan, and returns server-authored instructions.
2. The PWA opens a low-latency realtime connection to the voice model (WebRTC for OpenAI; WebSocket relay for server-relayed engines).
3. The user speaks. The model transcribes, decides intent, and emits **tool calls**.
4. Each tool call is POSTed to `POST /api/realtime/tools`, which executes the action server-side (Square API, email, knowledge base, database, etc.) and returns a spoken-ready result plus an optional UI command.
5. Order/menu state and POS actions are synced live to Square; the live order ticket appears in the Square POS cart in real time.

**The server is authoritative.** Clients never build their own instructions. The server owns persona, confirmation policy, voice-engine selection, noise-mode behavior, order-handling mode, and tool gating.

---

## 2. Voice engines (pipelines)

Selectable per assistant. Plan-gated (see §11).

| Engine | Category | Best for | Credentials |
|--------|----------|----------|-------------|
| **OpenAI Realtime (WebRTC)** `openai_realtime_webrtc` | Native speech-to-speech | Default browser/PWA path. Lowest-latency client voice, server VAD, tool calling over data channel | `OPENAI_API_KEY` |
| **OpenAI Realtime (Server WebSocket)** `openai_realtime_server_ws` | Native speech-to-speech | Native apps, enterprise logging, future telephony | `OPENAI_API_KEY` |
| **Gemini 3.1 Flash Live** `google_gemini_3_1_flash_live` | Native speech-to-speech | Newest native audio-to-audio model: tunable thinking, multilingual, native barge-in, strong noisy-room turn taking | `GOOGLE_GEMINI_API_KEY` |
| **Gemini 2.5 Flash Native Audio** `google_gemini_2_5_flash_native_audio` | Native speech-to-speech | Proactive Audio + Affective Dialog; assistant stays quiet until addressed | `GOOGLE_GEMINI_API_KEY` |
| **Browser Speech API (degraded)** `browser_speech_api_fallback` | Fallback | Emergency offline/degraded | none |
| **Push-to-talk text** `push_to_talk_text_fallback` | Fallback | Loud venue / offline | none |
| **Text only** `text_only_fallback` | Fallback | Accessibility / silent environments | none |

Seven additional providers (LiveKit, Pipecat, Hume, and four modular pipelines) are marked **request-only** and throw `pipeline_not_provisioned` if selected without provisioning.

Realtime sessions default `reasoning.effort` to `minimal` for fastest first-audio latency. The agent is instructed to call tools silently and bridge lookup time with speculative talk instead of announcing "one sec, checking now."

---

## 3. Noise modes

Each assistant has a noise mode that maps to turn-detection (VAD) settings:

| Mode | Turn detection |
|------|----------------|
| `standard` | semantic VAD, eagerness auto (tuned for low latency between commands) |
| `loud` | server VAD, threshold 0.6, 600 ms silence |
| `push_to_talk` | turn detection off (manual mic) |

---

## 4. Order handling modes

Each venue assistant settles submitted orders one of two ways. Configurable in the create/reconfigure wizard **and** live-toggleable in the PWA settings sheet (persists to the assistant).

| Mode | Behavior |
|------|----------|
| **Auto-complete** `auto_complete` (default) | `submit_order` records payment immediately; the order closes (COMPLETED) on the POS. |
| **Hold for review** `hold_for_review` | `submit_order` leaves the order as an **OPEN ticket** on the POS for end-of-day close-out. No payment is taken; the team settles it later. The assistant is instructed to say "Sent to the POS for review" — never "paid". |

Either way, every `add_item` / `remove_item` syncs the live order to the Square POS cart in real time during the conversation.

---

## 5. Confirmation policy & risk

Confirmations are **disabled by default** — the user's spoken command is itself the confirmation, so actions (including `submit_order`, `send_to_terminal`, `refund_payment`, `delete_item`, `cancel_payment`) execute immediately with no "are you sure?" loop.

The machinery remains for venues that supply a custom policy. Every tool still carries a **risk level** used for telemetry/audit and any custom gating:

| Risk | Tools |
|------|-------|
| **destructive** | `submit_order`, `send_to_terminal`, `delete_item`, `batch_adjust_inventory`, `refund_payment`, `cancel_payment` |
| **high** | `create_item`, `update_item`, `adjust_inventory`, `set_inventory`, `transfer_inventory`, `trash_email` |
| **medium** | `clear_order`, `apply_discount`, `create_category`, `update_customer`, `send_email`, `archive_email` |
| **low** | all reads + `add_item`, `remove_item`, `create_customer`, `clock_in`, `clock_out`, `list_inbox`, `search_email`, `read_email`, `mark_email_read`, `create_email_draft`, `search_knowledge`, `list_knowledge`, `web_search`, `fetch_url`, `query_database`, `list_database_connections` |

Reads and routine reversible writes are explicitly never-confirm so they never interrupt the flow.

---

## 6. Square integration (deep dive)

**OAuth & credentials**
- OAuth flow at `/api/square/oauth/authorize` → `/api/square/oauth/callback` → `/api/square/oauth/token`.
- Tokens are **AES-256-GCM encrypted** per venue (`secrets.ts`), decrypted on read via a 5-minute credential cache.
- Credentials are resolved server-side on every voice session/tool call — users never paste tokens into the client.

**Live order sync**
- Adding/removing items calls `syncLiveOrderToSquare`, creating/updating an **OPEN order** with a ticket name so it appears live in the Square POS cart.
- `submit_order` (auto-complete) records an `EXTERNAL` payment to close the order; (hold-for-review) detaches the session and leaves the OPEN ticket for close-out.
- `send_to_terminal` pushes a **Terminal Checkout** to Square Terminal hardware for card payment; if no terminal exists, the order stays live on the iPad/POS for tap-to-pay.

**Performance layer**
- `SquareClient` — fetch wrapper with exponential-backoff retry (3 attempts) and a per-venue circuit breaker (opens after 5 failures in 60s).
- Catalog cache — 5-minute per-venue cache to avoid re-fetching the menu.
- Session store — in-memory + DB write-through so order state survives restarts.

**Relevant Square REST endpoints used by the agent**: orders, payments, refunds, catalog (items/categories/modifiers), inventory counts/changes/batch-change, customers, team members, labor shifts, devices, terminal checkouts, locations.

---

## 7. Skills & subscription tiers

Tools are grouped into **skills**. A session loads only the skills its plan allows, plus the always-on meta skill.

| Skill | Tier | Commands |
|-------|------|----------|
| **Conversation Control** (`meta`) | always-on | `wait_for_user` |
| **POS** (`pos`) | core | `add_item`, `remove_item`, `get_order`, `clear_order`, `submit_order`, `send_to_terminal`, `search_menu` |
| **Orders & Reporting** (`orders-reporting`) | core | `list_orders`, `sales_report`, `list_open_orders`, `get_order_details`, `hourly_sales`, `item_performance`, `daily_summary`, `list_locations` |
| **Inventory** (`inventory`) | standard | `check_inventory`, `check_all_inventory`, `adjust_inventory`, `set_inventory`, `transfer_inventory`, `get_inventory_changes`, `low_stock_report`, `get_item_details`, `batch_adjust_inventory`, `inventory_summary` |
| **Catalog Management** (`catalog-management`) | standard | `create_item`, `update_item`, `delete_item`, `list_categories`, `create_category`, `list_modifiers`, `apply_discount` |
| **Customers & Payments** (`customers-payments`) | standard | `search_customer`, `create_customer`, `get_customer`, `update_customer`, `list_payments`, `refund_payment`, `cancel_payment` |
| **Team & Labor** (`team-labor`) | premium | `list_team`, `current_shifts`, `clock_in`, `clock_out` |
| **General Assistant** (`general-assistant`) | core (non-venue / merged) | web, knowledge, email, database commands (see §9) |
| **Workflows** (multi-step) | n/a | `end_of_day_close`, `opening_checklist`, `stock_take` |

Tier inclusion by plan: **trial → core only**; **Starter / Professional / Premium / Enterprise (and admin) → core + standard + premium**. General-assistant tools (email/knowledge/web/db) merge into a venue session when the org has those systems connected.

---

## 8. Full command catalog (Square / venue)

Every command below is a tool the assistant can call. `*` marks a required parameter.

### POS (core)

| Command | What it does | Parameters | Example phrases |
|---------|--------------|------------|-----------------|
| `add_item` | Add an item to the current order (syncs to POS cart) | `item_name*`, `quantity` (default 1), `item_id`, `price` | "Two margaritas", "Tab a Modelo", "Add a case of Coronas" |
| `remove_item` | Remove an item from the order | `item_name*`, `quantity` (default 1) | "86 the nachos", "Take off one IPA" |
| `get_order` | Read back the current order and total | — | "What's on the ticket?", "Read that back" |
| `clear_order` | Clear all items (removes from POS) | — | "Clear the order", "Start over" |
| `submit_order` | Submit to Square POS (pay now, or hold as open ticket per mode) | — | "Ring it up", "Close it out", "Send it" |
| `send_to_terminal` | Send the order to Square Terminal for card payment | — | "Send it to the terminal", "Card payment" |
| `search_menu` | Search the catalog for available items | `query*` | "Do we have prosecco?", "What IPAs do we carry?" |

### Orders & Reporting (core)

| Command | What it does | Parameters | Example phrases |
|---------|--------------|------------|-----------------|
| `list_orders` | List recent orders with totals and status | `limit` (default 10) | "Show the last ten orders" |
| `sales_report` | Revenue, order count, average ticket, top items for a period | `period` (`today`/`yesterday`/`this_week`/`last_7_days`/`this_month`/`last_30_days`) | "How are sales today?", "Sales this week" |
| `list_open_orders` | List currently open/in-progress tickets | — | "What's still open?" |
| `get_order_details` | Full details of one order | `order_id*` | "Pull up that order" |
| `hourly_sales` | Hour-by-hour sales breakdown | `date` (YYYY-MM-DD, default today) | "What were our busiest hours?" |
| `item_performance` | Best-selling items ranked by revenue or quantity | `period`, `sort_by` (`revenue`/`quantity`), `limit` | "Top sellers this week" |
| `daily_summary` | Complete daily summary: orders, revenue, top items, busiest hours | `date` | "Give me today's summary" |
| `list_locations` | List Square locations/venues | — | "What locations do we have?" |

### Inventory (standard)

| Command | What it does | Parameters | Example phrases |
|---------|--------------|------------|-----------------|
| `check_inventory` | Stock level of one item | `item_name*` | "How many Coronas left?" |
| `check_all_inventory` | Stock levels for all catalog items | — | "Run a full count" |
| `adjust_inventory` | Add (+) or remove (−) stock | `item_name*`, `quantity*`, `reason` | "We got a case of Tito's", "Mark two kegs as kicked" |
| `set_inventory` | Set absolute stock count (after a physical count) | `item_name*`, `quantity*` | "Set Coronas to 48" |
| `transfer_inventory` | Move stock between locations | `item_name*`, `quantity*`, `to_location_id*` | "Move 12 IPAs to the patio bar" |
| `get_inventory_changes` | Recent inventory history for an item | `item_name*` | "What happened with the vodka stock?" |
| `low_stock_report` | Items below a threshold | `threshold` (default 5) | "What's running low?" |
| `get_item_details` | Full item details: variations, pricing, category | `item_name*` | "Details on the house red" |
| `batch_adjust_inventory` | Adjust many items at once (e.g. a delivery) | `adjustments[]*` (each `item_name*`, `quantity*`, `reason`) | "Log the delivery: 2 cases Modelo, 1 case Corona" |
| `inventory_summary` | Overview: items tracked, units in stock, zero-stock, low-stock | — | "How's our inventory looking?" |

### Catalog Management (standard)

| Command | What it does | Parameters | Example phrases |
|---------|--------------|------------|-----------------|
| `create_item` | Create a catalog item | `item_name*`, `price*`, `category` | "Add a new cocktail, Paloma, eleven dollars" |
| `update_item` | Rename or reprice an item | `item_name*`, `new_name`, `new_price` | "Bump the margarita to thirteen" |
| `delete_item` | Permanently remove an item | `item_name*` | "Delete the seasonal IPA" |
| `list_categories` | List catalog categories | — | "What categories do we have?" |
| `create_category` | Create a category | `name*` | "Make a category called Mocktails" |
| `list_modifiers` | List modifier lists (sizes, add-ons) | — | "What modifiers exist?" |
| `apply_discount` | Apply a % or fixed discount to the order or an item | `name*`, `type*` (`percentage`/`fixed`), `amount*`, `item_name` | "Twenty percent happy hour", "Comp the wings" |

### Customers & Payments (standard)

| Command | What it does | Parameters | Example phrases |
|---------|--------------|------------|-----------------|
| `search_customer` | Find a customer by name/email/phone | `query*` | "Look up John Smith" |
| `create_customer` | Create a customer profile | `given_name*`, `family_name`, `email`, `phone`, `note` | "Add a new customer, Sarah Lee" |
| `get_customer` | Full customer details | `customer_id*` | "Pull up that customer" |
| `update_customer` | Update customer info | `customer_id*`, `given_name`, `family_name`, `email`, `phone`, `note` | "Update her phone number" |
| `list_payments` | Recent payments with amounts/status | `limit` (default 10) | "Show recent payments" |
| `refund_payment` | Refund a payment (full or partial) | `payment_id*`, `amount`, `reason` | "Refund that last card payment" |
| `cancel_payment` | Cancel an incomplete payment | `payment_id*` | "Cancel that pending payment" |

### Team & Labor (premium)

| Command | What it does | Parameters | Example phrases |
|---------|--------------|------------|-----------------|
| `list_team` | Active team members at this location | — | "Who's on the team?" |
| `current_shifts` | Who's currently clocked in | — | "Who's working right now?" |
| `clock_in` | Clock a team member in | `team_member_id*` | "Clock in Marcus" |
| `clock_out` | End a team member's shift | `shift_id*` | "Clock out Marcus" |

---

## 9. Full command catalog (General Assistant — non-Square)

Available to the general (non-POS) assistant, and merged into venue sessions when Gmail / knowledge / database / web systems are connected.

### Web

| Command | What it does | Parameters |
|---------|--------------|------------|
| `web_search` | Live web search (Tavily, DuckDuckGo fallback) | `query*`, `max_results` (default 5, max 10) |
| `fetch_url` | Fetch a page and return readable text | `url*` |

### Knowledge base

| Command | What it does | Parameters |
|---------|--------------|------------|
| `search_knowledge` | Semantic search over uploaded docs (SOPs, contracts, recipes, handbooks) with citations | `query*`, `top_k` (default 4, max 8) |
| `list_knowledge` | List documents in the knowledge base | — |

### Email (Gmail / Resend / SMTP)

| Command | What it does | Parameters |
|---------|--------------|------------|
| `send_email` | Send from the configured outbound address (sends immediately) | `to*`, `subject*`, `body*`, `cc` |
| `list_inbox` | List recent inbox emails (Gmail search syntax filter) | `query`, `max` |
| `search_email` | Search Gmail with search syntax | `query*` |
| `read_email` | Read the full body of a message | `message_id*` |
| `create_email_draft` | Create a draft (does not send) | recipient/subject/body |
| `mark_email_read` | Mark a message as read | `message_id*` |
| `archive_email` | Archive a message (removes INBOX label) | `message_id*` |
| `trash_email` | Move a message to Trash | `message_id*` |

Outbound sends are rate-limited to 15 per user per rolling hour.

### Database

| Command | What it does | Parameters |
|---------|--------------|------------|
| `query_database` | Run a read-only SQL `SELECT` against a connected database (writes blocked, max 100 rows) | `sql*` |
| `list_database_connections` | List available database connections | — |

---

## 10. Workflows (multi-step routines)

Registered as callable tools and exposed as one-tap buttons in the dashboard and PWA. Each runs a sequence of the commands above. Streamed via `POST /v1/workflows/:slug/run` (SSE).

| Workflow | Steps |
|----------|-------|
| `end_of_day_close` | `daily_summary` → `list_open_orders` → `low_stock_report` (threshold 5) |
| `opening_checklist` | `inventory_summary` → `low_stock_report` (threshold 10) → `current_shifts` → `list_locations` |
| `stock_take` | `check_all_inventory` → `inventory_summary` (then use `set_inventory` to correct discrepancies) |

---

## 11. Conversation control & meta

| Command | What it does |
|---------|--------------|
| `wait_for_user` | No-op turn-ender. Called on silence, background noise, hold music, TV audio, side conversations, or speech not addressed to the assistant — so the agent stays quiet instead of saying "I'm here" / "I didn't catch that". |

**Voice style the agent is trained on**: short, natural, varied acknowledgements; never reads the order back unless asked; never asks "are you sure?"; understands bar/hospitality slang — "86 it" (remove/out of stock), "ring it up"/"close it out" (submit), "tab it" (add), "what's on the ticket" (get order), "a case of" (add 24), "count" (check levels), plus FOH/BOH, pars, comp, covers, line check.

---

## 12. Plans & limits

| Plan | Voice minutes | Overage | Engines | Skill tiers |
|------|---------------|---------|---------|-------------|
| Trial (14d) | 100 | none | OpenAI WebRTC + fallbacks | core |
| Starter ($79/mo) | 250 | $0.20/min | OpenAI WebRTC + WS | core + standard + premium |
| Professional ($199/mo) | 1,000 | $0.17/min | + Gemini | core + standard + premium |
| Premium ($499/mo) | 4,000 | $0.14/min | All engines | core + standard + premium |
| Enterprise | Custom | Custom | All engines | core + standard + premium |

All paid plans enforce a **1.5× overage hard cap** (returns HTTP 402 past the cap). Voice minutes are metered via a 60s PWA heartbeat plus a session-end POST. Every tool execution writes one `tool_calls` audit row.

---

## 13. Key API endpoints

**Realtime / voice**
- `POST /api/realtime/session` — create a voice session (returns ephemeral token, instructions, greeting, order-handling mode)
- `POST /api/realtime/tools` — execute a tool call (accepts `orderHandlingMode` override)
- `POST /api/realtime/session/:id/heartbeat` — voice-minute metering heartbeat
- `POST /api/realtime/session/:id/end` — finalize metering
- `POST /api/realtime/demo-bar-session` / `demo-bar-tools` — public mock-bar landing demo (same code path, mock connector)

**Square**
- `GET /api/square/oauth/authorize` · `GET /api/square/oauth/callback` · `GET /api/square/oauth/token`
- `GET /api/square/locations` · `GET /api/square/catalog` · `GET /api/square/orders/recent` · `POST /api/square/orders`
- `GET /api/square/devices` · `POST /api/square/terminal/checkout` · `GET /api/square/terminal/checkout/:id`

**Assistants & workflows**
- `GET/POST/PATCH/DELETE /api/v1/agent-profiles` — manage assistants (includes `orderHandlingMode`, `noiseMode`, wake phrase, voice engine)
- `POST /v1/workflows/:slug/run` — run a workflow (SSE streaming)
- `GET /v1/usage/current` — voice minutes, top tools, recent errors

Auth is JWT-based; `requireAuth` and `requirePlan` gate API routes, with the organization attached alongside the user. Clerk Billing (B2B, organization-level) manages subscriptions.

---

## 14. Environment variables

**Required**: `DATABASE_URL`, `JWT_SECRET`, `SECRETS_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `PUBLIC_BASE_URL`, `PORT`

**Optional**: `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `CLERK_PLAN_PRO_ID`, `CLERK_PLAN_BUSINESS_ID`, `SESSION_SECRET`, `LOG_LEVEL`, `TAVILY_API_KEY` (web search), `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (Gmail), `AUTH_RESEND_API_KEY` / `AUTH_SMTP_*` (password-reset email), `OPENAI_REALTIME_REASONING_EFFORT`, `ACOUSTIC_BARGE_IN_ENABLED`, `AGENT_PROFILE_CACHE_TTL_MS`.

---

### Command count summary

| Group | Count |
|-------|-------|
| POS | 7 |
| Orders & Reporting | 8 |
| Inventory | 10 |
| Catalog Management | 7 |
| Customers & Payments | 7 |
| Team & Labor | 4 |
| General Assistant — web (2), knowledge (2), email (8), database (2) | 14 |
| Conversation control (meta) | 1 |
| Workflows | 3 |
| **Total directly-callable commands** | **61** |

All commands execute server-side against live Square and connected systems — no mocks, no client-built instructions.
