# CLAUDE.md

## Project Overview

**BevPro** is a voice-powered POS and inventory management system for beverage venues. Staff place orders via voice commands (OpenAI Realtime API), which sync live to Square POS terminals. Includes multi-platform support (web PWA, native iOS/Android, browser dashboard) with Stripe billing.

## Repository Structure

This is a **pnpm monorepo** (pnpm 9.15.9, Node 22).

```
artifacts/           # Deployable applications
  api-server/        # Express 5 REST + WebSocket server
  bevpro-landing/    # Dashboard/landing React app (Vite)
  voice-agent-pwa/   # Voice interface PWA (Vite, React 19)
  square-voice-agent/# Native iOS/Android app (Expo)
lib/                 # Shared libraries
  api-zod/           # Zod schemas for API types
  api-client-react/  # React hooks for API calls (TanStack Query)
  db/                # Database layer (Drizzle ORM, PostgreSQL)
scripts/             # Build scripts (build-railway.mjs)
```

## Tech Stack

- **Backend**: Node 22, Express 5, WebSockets (ws), esbuild bundling
- **Frontend**: React 19, Vite 7, Tailwind CSS 4, Radix UI, Wouter router, Framer Motion
- **Database**: PostgreSQL + Drizzle ORM + drizzle-zod
- **Auth**: JWT (jsonwebtoken) + bcryptjs, session-based
- **External APIs**: OpenAI (Realtime + Whisper), Square (OAuth + Orders + Catalog), Stripe (Subscriptions + Webhooks)
- **Validation**: Zod throughout (runtime + type inference)
- **Formatting**: Prettier

## Common Commands

```bash
# Install dependencies
pnpm install

# Typecheck everything
pnpm run typecheck

# Build for production (Railway)
pnpm run build:railway

# Start production server
pnpm run start

# Typecheck just shared libraries
pnpm run typecheck:libs

# Run a specific artifact's dev server
pnpm --dir artifacts/api-server run dev
pnpm --dir artifacts/bevpro-landing run dev
pnpm --dir artifacts/voice-agent-pwa run dev
```

## Build Pipeline

The Railway build (`scripts/build-railway.mjs`) runs sequentially:
1. Typecheck shared libs (`tsc --build`)
2. Typecheck api-server, bevpro-landing, voice-agent-pwa
3. Build bevpro-landing (Vite)
4. Build voice-agent-pwa (Vite, with `BASE_PATH=/agent/`)
5. Bundle api-server (esbuild -> `dist/index.cjs`)

The API server serves all frontends in production:
- `/` -> bevpro-landing
- `/agent/` -> voice-agent-pwa
- `/api/*` -> REST endpoints

## Database

PostgreSQL with 5 tables defined in `lib/db/src/schema/index.ts`:
- `users` - email, password hash, name
- `venues` - Square OAuth credentials, location info (FK -> users)
- `subscriptions` - Stripe subscription status, trial tracking (FK -> users)
- `sessions` - JWT session management (FK -> users)
- `exchange_codes` - Temporary venue access codes for native app pairing

Tables are auto-created on server start via `CREATE TABLE IF NOT EXISTS`. Drizzle ORM is used for all queries.

## API Routes

All routes in `artifacts/api-server/src/routes/`:
- `auth.ts` - signup, login, logout, session validation
- `venues.ts` - CRUD, Square credential storage, catalog proxy
- `realtime.ts` - OpenAI ephemeral tokens, tool execution for voice agent
- `ws-relay.ts` - WebSocket relay for native app <-> OpenAI Realtime
- `square.ts` - OAuth flow (authorize, callback, token exchange)
- `subscriptions.ts` - Stripe checkout, portal, webhooks
- `voice.ts` - Audio transcription (file upload)
- `health.ts` - Health check

## Environment Variables

**Required**:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret (must not use default in production)
- `OPENAI_API_KEY` - OpenAI API key
- `SQUARE_APPLICATION_ID` / `SQUARE_APPLICATION_SECRET` - Square OAuth
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` - Stripe integration
- `PUBLIC_BASE_URL` - Public domain for OAuth callbacks

**Optional**:
- `PORT` - Server port (default varies)
- `NODE_ENV` - `development` or `production`

## Code Conventions

- **Files**: kebab-case (`ws-relay.ts`, `square-helpers.ts`)
- **Variables/functions**: camelCase
- **React components**: PascalCase
- **DB columns**: snake_case in SQL, camelCase in TypeScript
- **Imports**: Use `@workspace/*` for monorepo cross-references
- **Auth pattern**: `requireAuth` and `requirePlan` middleware on protected routes
- **Error responses**: JSON `{ error: "message" }` with appropriate status codes
- **Rate limiting**: Applied per-route on sensitive endpoints (login, signup, realtime)

## Deployment

Deployed on **Railway** using nixpacks:
- Config in `nixpacks.toml` (installs ffmpeg, openssl, pnpm)
- Node 22 pinned via `.nvmrc` and nixpacks config
- Single service serves API + both frontends
- Auto-deploy on push to `master`

## Key Architectural Notes

- The voice agent uses **WebRTC** for direct browser-to-OpenAI connection (low latency). Native apps use a **WebSocket relay** through the server.
- Square integration uses **live order sync** - orders appear on POS terminals in real-time as items are added via voice.
- The PWA is served under `/agent/` with `BASE_PATH` set at build time.
- Connection pooling: max 20 DB connections, 30s idle timeout.
- Audio processing requires ffmpeg (installed via nixpacks).
