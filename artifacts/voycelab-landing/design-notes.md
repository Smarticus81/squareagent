# VoyceLab interface design system — "Presence"

VoyceLab is an always-on assistant that runs a venue. The interface is built
the way such an assistant should feel: one living light, a few words, and
nothing else competing for attention. This is the single visual direction for
the surface (the PWA), the dashboard, and the marketing site. New work should
extend these rules instead of adding chrome.

## Principles

- **The assistant is the interface.** The presence is the only element on any
  screen that is allowed to glow or move. Everything else holds still.
- **Say less.** One headline, one line of support, one action. If a screen
  needs a paragraph to explain itself, the screen is wrong.
- **Silence is still.** The presence only animates with the assistant's real
  state and real audio. There is no fake waveform and no idle theatre.
- **Controls appear when needed.** Sign-in, reconnect, the ticket and the
  settings live in a sheet that opens on demand and gets out of the way.

## Tokens

- Canvas: `#09090B`, with a faint pool of light low on the page (`#0E0E11`)
- Surface: `#121215` solid, or white at 5–9% over the canvas
- Ink: `#F4F3F0` at 100 / 82 / 56 / 36 / 25 / 10 / 6 percent
- Ember (accent): `#FF7A4D`. Used only by the presence while the assistant
  speaks, and never for decoration.
- Listening: `#CFE1FF`. The presence while the mic is open.
- Status: success `#8FE3B4`, warning `#FFD58A`, danger `#FF6B6B`
- Type: Inter only, weights 400–600. No serif display face, no gradient text.
- Radius: pills (999px) for controls, 14–24px for surfaces.

## The presence

A soft sphere with a highlight at the upper left, a bloom behind it, and a
thin ring. Its state is a class on the root (`is-dormant`, `is-ready`,
`is-listening`, `is-thinking`, `is-speaking`, `is-connecting`, `is-error`):

- dormant: dim grey, bloom off
- ready: pale, slow six-second breath
- listening: cool blue-white, ring pulses outward
- thinking / connecting: pale with a slow rotating sheen
- speaking: ember, bloom and scale driven by `--lvl` (0..1) from
  `createPresenceMeter` in `@workspace/voicelab-client/presence-meter`
- error: muted red

The same component exists in the PWA (`components/Presence.tsx`) and the
dashboard (`components/presence.tsx`), styled by the same rules.

## Surface layout (PWA)

Three rows: a status line at the top, the presence with the current words in
the middle, and a quiet ledger of what the assistant just did at the bottom,
with a ticket pill and a three-dot handle that opens the sheet. The sheet is
a bottom sheet on phones and a right-hand drawer at 900px and up.

## Product language

Say "assistant," "ticket," "connected systems." Never expose providers,
protocols or tool names. Copy is short, concrete and spoken-sounding.

## Motion

Everything respects `prefers-reduced-motion`. The presence breathes when ready
and pulses when listening; nothing else loops.
