# Landing page design notes

Working log for the marketing landing page (`src/pages/landing.tsx`). Future
passes: read this first, build on it, don't re-litigate.

## Conversion spine

> This page exists to get bar/restaurant operators to start a free trial.

Section order: plain claim (hero) → what it does for staff → how it works
(scroll theater) → live demo → what it does for the business → proof →
risk-reversed ask (name your assistant).

## Direction: light, on-brand, plain-spoken

**Owner feedback (v2): dark theme rejected — "too cliché"; v1 copy rejected —
"too markety." Do not bring either back.** The page uses the site's existing
light system (white paper, pastel washes, near-black ink, indigo accent,
Inter) and straightforward copy written from the owner's own advantages
list: sub-second responses, hands-free ordering, accurate modifiers, live
Square inventory, fast onboarding, tab integration, pour-cost control,
voice-queried sales data. Claims are concrete and literal; example commands
use real bar vocabulary ("Two old fashioneds, one no cherry", "Is the IPA
keg tapped?").

## Motion (kept from v1, reskinned)

- **Voice-field hero** (`src/components/landing/voice-field.tsx`): GPU
  particle "sound horizon" in brand pastels — lilac → indigo → pink by wave
  amplitude, NormalBlending (additive washes out on white). Single draw
  call, DPR ≤ 2, idle-loaded, paused offscreen, disposed on unmount, never
  mounted under `prefers-reduced-motion`. three.js stays in its own lazy
  chunk.
- **Command theater**: pinned 390vh scroll scrub — a spoken sentence fills
  word-by-word while the Square result (tab, inventory, report) assembles
  row-by-row. Static cards on mobile and reduced motion.
- **Hero ticker**: auto-cycling command→result card, desktop only.
- Magnetic hover on the primary CTA; whileInView fades on cards
  (≤ 0.07s stagger, transform+opacity only).
- H1 renders statically — LCP never waits on JS animation.

## Burned fingers (keep these fixes)

- **`overflow-x: hidden` on html/body silently breaks `position: sticky`**
  (body becomes a nested scroll container). Fixed with `overflow-x: clip`
  under `@supports`. If the theater ever stops pinning, look for a new
  overflow ancestor first.
- Theater scene crossfades must overlap (`s − 0.012 → s + 0.028`) —
  sequential fades leave a dead-blank viewport between scenes.
- JSX comments can't precede the root element of a `return` (esbuild error).

## History

- v1 (PR #34, merged then superseded): dark "last call cinema" theme, amber
  palette, Fraunces display, punchy copy ("Speak. It's rung in."). Owner
  rejected the dark aesthetic and the copy tone; v2 keeps v1's motion
  system and structure on the original light theme with literal copy.
- Higgsfield stills generated for v1 (dark bar imagery) don't fit the light
  direction; URLs are in the PR #34 description if ever wanted.
