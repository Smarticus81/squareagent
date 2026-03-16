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

Ultra-low latency conversational voice agent for Square POS. Features:
- Voice ordering via ElevenLabs STT (scribe_v1) + TTS (eleven_turbo_v2)
- Multi-turn conversation with intent detection
- Square catalog browsing and search
- Real-time order management (add/remove/update items)
- Square API order creation and processing
- Setup screen for Square credentials (access token + location ID)

**Key files:**
- `app/index.tsx` — Main screen with Voice/Order/Catalog tabs
- `app/setup.tsx` — Square connection setup
- `app/_layout.tsx` — Root layout with providers
- `context/VoiceAgentContext.tsx` — Voice recording, STT, AI chat, TTS
- `context/OrderContext.tsx` — Order state management
- `context/SquareContext.tsx` — Square API + catalog management
- `components/WaveformVisualizer.tsx` — Animated waveform
- `components/MicButton.tsx` — Animated mic button
- `components/OrderCard.tsx` — Order line item card

**Integration:** ElevenLabs connected via `@replit/connectors-sdk`

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes:
- `GET /api/healthz` — Health check
- `POST /api/voice/transcribe` — STT via ElevenLabs
- `POST /api/voice/chat` — AI agent streaming response (SSE)
- `POST /api/voice/synthesize` — TTS via ElevenLabs
- `GET /api/square/locations` — Square locations
- `GET /api/square/catalog` — Square catalog items
- `POST /api/square/orders` — Create Square order

**Integration:** ElevenLabs via `@replit/connectors-sdk` (server-side proxy)

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
