# Railway Deployment

This repo can run on Railway as a single web service:

- `/` serves the Bevpro landing/dashboard app
- `/agent/` serves the voice-agent PWA
- `/api/*` serves the Express API and WebSocket realtime relay

## Required Railway Variables

- `PORT` — Railway injects this automatically
- `DATABASE_URL`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `SQUARE_APPLICATION_ID`
- `SQUARE_APPLICATION_SECRET`
- `PUBLIC_BASE_URL`

Set `PUBLIC_BASE_URL` to your Railway public URL, for example:

- `https://your-app.up.railway.app`

This is used for the Square OAuth callback URL:

- `https://your-app.up.railway.app/api/square/oauth/callback`

## Railway Setup

1. Create a new Railway project from this repository.
2. Add the environment variables listed above.
3. Make sure your Square OAuth redirect URL matches `PUBLIC_BASE_URL`.
4. Deploy.

The repository includes `railway.json`, so Railway will:

- build the full monorepo
- build the PWA with `BASE_PATH=/agent/`
- start the bundled API server

## Production URLs

- Dashboard: `/`
- Voice Agent PWA: `/agent/`
- API health: `/api/healthz`

## Notes

- The dashboard launches the PWA at `/agent/` in production.
- The API serves both static frontends, so no extra Railway services are required.
- If you change the public domain, update `PUBLIC_BASE_URL` and the Square app redirect URI.