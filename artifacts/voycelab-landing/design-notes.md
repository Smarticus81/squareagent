# Landing page design notes

Working log for the marketing landing page (`src/pages/landing.tsx`). Future
passes: read this first, build on it, don't re-litigate.

## Conversion spine

> This page exists to get bar/restaurant operators to start a free trial,
> because every trip to the touchscreen is time the bar isn't making money.

Narrative order: promise (hero) → felt cost (fourteen taps) → mechanism shown
(command theater) → proof by experience (live voice demo) → capability
vocabulary → social proof → risk-reversed ask (name your assistant).

## Direction: "Last call cinema"

The product lives behind a bar at 11pm, so the landing page does too.
Dark warm near-black, back-bar amber, ivory type. The interior app stays
light — this theme is scoped to the landing route only (`.vl-nx` in
`index.css`, dark chrome via `vl-header-dark` / `vl-footer-dark`).

Tokens (roles, not decoration):

- `--nx-bg #0B0A09` closing-time black (surface)
- `--nx-ink #F3EADC` back-bar ivory
- `--nx-amber #E8A33D` pour amber — signal/data accent only
- `--nx-ember #FF5A2D` ember — **primary CTA only**, appears nowhere else
- Display face: Fraunces (opsz 144, weights 420/560 + italics); body Inter;
  commands JetBrains Mono

## Signature moment

`src/components/landing/voice-field.tsx` — a GPU particle "sound horizon"
behind the hero: concentric voice ripples + carrier swell, amber→ember ramp
by amplitude, lifts under the pointer. Single draw call (Points +
ShaderMaterial), DPR ≤ 2, pauses offscreen/tab-hidden, disposes on unmount.
Lazy-loaded on `requestIdleCallback`; never mounted under
`prefers-reduced-motion` (static gradient atmosphere instead). three.js is
its own vite chunk, so the hero-critical bundle stays small (landing route
~12 KB gz + motion ~14 KB gz).

Second moment: the **command theater** — a pinned 390vh scroll scrub where a
spoken sentence fills word-by-word and the Square result (ticket / stock
count / closeout) assembles row-by-row. Desktop only; mobile and
reduced-motion get the same three scenes as static cards.

## Choices made (and kept)

- H1 renders statically — LCP is never gated on JS animation. Entrance
  animation only on secondary hero elements.
- One ember CTA per viewport. Header CTA on landing is a quiet outline.
- Copy is capability-first ("rings orders, splits checks, 86's items"),
  never setup-ease ("15 minutes to deploy" copy from the old page was cut).
- Hero right column: auto-cycling command→ticket card (mechanism proof above
  the fold), desktop only.
- Live demo section reuses the real OpenAI Realtime WebRTC demo
  (`useVoycelabDemoRealtime` + `VoiceOrb`) — proof by experience, not a video.
- Stats kept to claims the old page already made (200+ venues, 4.9 rating).
- Brand logos sit on ivory chips so native logo colors survive the dark bg.
- Logo PNG has a black wordmark; `.vl-logo-invert`
  (invert + hue-rotate) lifts it to ivory while keeping the bars orange.

## Killed / burned fingers

- **`overflow-x: hidden` on html/body silently breaks `position: sticky`**
  (body becomes a nested scroll container). Fixed globally with
  `overflow-x: clip` under `@supports`. If the theater ever stops pinning,
  look for a new overflow ancestor first.
- Scene crossfades must overlap (`s − 0.012 → s + 0.028`) — sequential
  fades left a dead-black viewport between scenes.
- Killed a planned parallax layer on the vocabulary cards — it fought the
  mono command lists. Cards get a whileInView fade only.
- JSX comments can't precede the root element of a `return` — esbuild error.

## Higgsfield assets (generated, not yet in repo)

Two soul_cinematic stills were generated and approved but this environment's
egress policy blocks downloading from the Higgsfield CDN. To add them later
(download, convert to WebP ~1600w/q80, drop in `public/atmos/`):

- Back-bar 21:9 hero backdrop:
  `https://d8j0ntlcm91z4.cloudfront.net/user_3FvUSDWlpMZmeo552NjYHGJ67RL/hf_20260705_230502_3f69ddf6-f3e8-4476-b5aa-edec46e13e25.png`
  → intended as a ~25%-opacity photographic layer under the hero particle
  field (add behind `<VoiceField>`, `loading="lazy"`, fade in on load).
- Whiskey-pour macro 3:4:
  `https://d8j0ntlcm91z4.cloudfront.net/user_3FvUSDWlpMZmeo552NjYHGJ67RL/hf_20260705_230513_f0e87b23-9a0b-4cac-bd4d-1fbc94a6e0ff.png`
  → candidate art for the proof band's right column.

Prompt recipe that worked: name the palette hexes, "near-black frame, warm
amber highlights", "lower half dark and uncluttered for text", "35mm film
still". The page currently ships with procedural atmosphere (gradients +
SVG-turbulence grain) and loses nothing structural without the photos.
