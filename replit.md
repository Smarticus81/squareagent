# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── square-voice-agent/ # Expo mobile app - Square POS Voice Agent
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/square-voice-agent` (Expo Mobile App)

Ultra-low latency (~700ms) conversational voice agent for Square POS. No push-to-talk — VAD-driven continuous listening. Features:
- Voice ordering via gpt-4o-audio-preview (speech-in → tools → speech-out, single API call)
- VAD (Voice Activity Detection) via expo-av metering — auto-triggers after 14 silent frames at -35dB
- Multi-turn conversation history (text-only, no audio blobs in history)
- Square catalog browsing and search
- Real-time order management (add/remove/update items) via OrderCommand[]
- Square API order creation and processing
- Setup screen for Square credentials (access token + location ID)

**Key files:**
- `app/index.tsx` — Main screen with Voice/Order/Catalog tabs; handleCommands(OrderCommand[])
- `app/setup.tsx` — Square connection setup
- `app/_layout.tsx` — Root layout with providers (3s font-load timeout fallback)
- `context/VoiceAgentContext.tsx` — expo-av recording + metering VAD → POST multipart to server → expo-av playback
- `context/OrderContext.tsx` — Order state management
- `context/SquareContext.tsx` — Square API + catalog management
- `components/WaveformVisualizer.tsx` — Animated waveform
- `components/OrderCard.tsx` — Order line item card

**Recording:** iOS=WAV PCM16, Android=MP4/AAC, Web=WebM. Server detects from mimetype.
**Audio playback:** data URI (`data:audio/wav;base64,...`) — no expo-file-system needed.
**Integration:** Replit OpenAI integration (AI_INTEGRATIONS_OPENAI_BASE_URL + API_KEY auto-provisioned)

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server (port 8080). Routes:
- `GET /api/health` — Health check
- `POST /api/voice/chat` — Multipart audio + session/catalog/order JSON → gpt-4o-audio-preview → {user_transcript, agent_text, audio_b64, audio_format, order_commands}
- `GET /api/square/locations` — Square locations
- `GET /api/square/catalog` — Square catalog items (ITEM type, first variation)
- `POST /api/square/orders` — Create Square order

**Tools (server-side):** add_item, remove_item, get_order, clear_order, submit_order, search_menu
**Session management:** In-memory Map keyed by session_id; text-only history (≤40 messages)
**Integration:** Replit OpenAI integration via `openai` npm package

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec and Orval codegen config.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package.

## Square Integration

To use with Square POS:
1. Get credentials from developer.squareup.com
2. Open the app and tap the Settings icon
3. Enter your Access Token and Location ID
4. Tap "Connect Square" to load your catalog
5. Use voice or text to place orders

Use Sandbox credentials for testing, Production for live use.
