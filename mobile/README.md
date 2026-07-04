# VoyceLab Mobile (Expo)

Native iOS/Android shell around the deployed voice PWA
(`https://www.voycelab.com/agent/`). Because the app renders the live site,
web-side fixes ship to installed apps on every server deploy — a new store
build is only needed when this wrapper itself changes.

## What the shell adds

- Keep-awake for the always-on venue screen
- Mic capture auto-granted to the WebView (`NSMicrophoneUsageDescription` set)
- Auto-recovery when iOS/Android kills the WebView process (no dead white screen)
- Deep links: `voycelab://…?code=…` and `https://voycelab.com/agent/?code=…`
  open the app with the dashboard's launch params
- Square OAuth completes inside the app; other third-party auth (Clerk,
  Google) opens in the system browser
- Status bar and chrome follow the PWA's light/dark theme

## TestFlight release

```bash
cd mobile
npm ci
npx tsc --noEmit                 # sanity check
npm run build:ios                # eas build --platform ios --profile production
npm run submit:ios               # eas submit --platform ios --profile production
```

Requires an Expo account with access to the `smarticus1` org (EAS project
`36043f11-c509-458e-8706-e049d231ec29`) and App Store Connect credentials the
first time `eas submit` runs. `production` builds auto-increment the build
number (`appVersionSource: remote`). Bump `version` in `app.json` for
user-facing releases.

Internal testing without the store: `npm run build:ios:preview` produces an
ad-hoc build installable on registered devices.

## Universal links (one-time server setup)

The API server serves the association files once these env vars are set on the
deployment:

- `APPLE_TEAM_ID` — your Apple Developer Team ID →
  `/.well-known/apple-app-site-association` (covers `/agent/*`)
- `ANDROID_CERT_SHA256` — the app's signing-cert SHA-256 fingerprint
  (`eas credentials` shows it) → `/.well-known/assetlinks.json`

Until they're set the endpoints return 404 and links simply keep opening in
the browser; nothing breaks.

## Changing the target URL

The PWA URL comes from `expo.extra.pwaUrl` in `app.json`. Point it at a
staging deployment for preview builds if needed.
