# Railway Deployment

This repo can run on Railway as a single web service:

- `/` serves the VoyceLab landing/dashboard app
- `/agent/` serves the voice-agent PWA
- `/api/*` serves the Express API and WebSocket realtime relay

## Required Railway Variables

- `PORT` - Railway injects this automatically
- `DATABASE_URL`
- `JWT_SECRET`
- `SECRETS_ENCRYPTION_KEY` (or legacy `ENCRYPTION_KEY`)
- `OPENAI_API_KEY`
- `GOOGLE_GEMINI_API_KEY`
- `SQUARE_APPLICATION_ID`
- `SQUARE_APPLICATION_SECRET`
- `PUBLIC_BASE_URL`

Set `PUBLIC_BASE_URL` to your Railway public URL, for example:

- `https://your-app.up.railway.app`

This is used for the Square OAuth callback URL:

- `https://your-app.up.railway.app/api/square/oauth/callback`

`SECRETS_ENCRYPTION_KEY` must be a dedicated random value of at least 32
characters. Do not reuse `JWT_SECRET`; it signs sessions and should rotate
independently from encrypted connected-service credentials.

Generate one locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If Railway healthchecks fail immediately with a startup error mentioning
`SECRETS_ENCRYPTION_KEY` or `ENCRYPTION_KEY`, set this variable and redeploy.

## API Key Variables

VoyceLab resolves provider API keys through one server-side key manager:

- OpenAI: set `OPENAI_API_KEY` (`AI_INTEGRATIONS_OPENAI_API_KEY` is accepted only as a compatibility alias)
- Gemini: set `GOOGLE_GEMINI_API_KEY` (`GOOGLE_API_KEY` is accepted only as a compatibility alias)

Prefer the canonical names above for new deployments. Provider keys live only
on the API server; browsers receive ephemeral OpenAI tokens or VoyceLab relay
handshakes, never the long-lived provider keys.

## Demo Booking Variables

Set `VITE_DEMO_BOOKING_URL` to your scheduling page, such as a Calendly,
Cal.com, or SavvyCal booking URL. The dashboard's "Book a demo" links route to
`/book-demo`, which opens that scheduler and also provides a direct scheduler
button for providers that block embedded calendars.

Set `VITE_SALES_EMAIL` if you want the fallback request link to use a different
sales inbox. If `VITE_DEMO_BOOKING_URL` is not set, `/book-demo` falls back to a
pre-filled email request instead of exposing setup details to visitors.

## Clerk Billing Variables

VoyceLab's current paid plans are `Pro` and `Business`. For embedded Clerk
checkout, set `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`CLERK_WEBHOOK_SECRET`, then configure matching organization plans in Clerk with
slugs `pro` and `business`.

If you use server-side checkout redirects instead of Clerk's embedded
`PricingTable`, configure checkout URLs for every paid plan exposed on the
pricing page:

- `CLERK_CHECKOUT_PRO_MONTHLY_URL`
- `CLERK_CHECKOUT_PRO_YEARLY_URL`
- `CLERK_CHECKOUT_BUSINESS_MONTHLY_URL`
- `CLERK_CHECKOUT_BUSINESS_YEARLY_URL`

Set `CLERK_BILLING_PORTAL_URL` only when using an external Clerk billing portal.
Otherwise `/billing` hosts the embedded organization billing page.

## Railway Setup

1. Create a new Railway project from this repository.
2. Add the environment variables listed above.
3. Make sure your Square OAuth redirect URL matches `PUBLIC_BASE_URL`.
4. Deploy.

The repository includes `railway.json`, so Railway will:

- build the full monorepo
- build the PWA with `BASE_PATH=/agent/`
- start the bundled API server

## Node Version

This repo requires Node 22 on Railway.

- Nixpacks will detect this from the root `package.json` `engines.node` field.
- The root `.nvmrc` also pins the same version for local and CI builds.
- The root `nixpacks.toml` sets `NIXPACKS_NODE_VERSION=22` as an extra safeguard for Railway builds.

If your Railway service still shows Node 18 in the build logs, clear the previous deployment cache and redeploy.

## Production URLs

- Dashboard: `/`
- Voice Agent PWA: `/agent/`
- API health: `/api/healthz`
- Sanitized config health: `/api/healthz/config`

`/api/healthz/config` requires an authenticated VoyceLab session and reports
booleans only. It never returns secret values. Use it after a successful deploy
to confirm provider keys, Square OAuth, Clerk Billing, database, JWT, and
encryption-key readiness.

## Notes

- The dashboard launches the PWA at `/agent/` in production.
- The API serves both static frontends, so no extra Railway services are required.
- If you change the public domain, update `PUBLIC_BASE_URL` and the Square app redirect URI.
