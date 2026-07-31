# VoyceLab interface design system

This is the single visual direction for the marketing site, account UI, and
voice PWA. New work should extend these rules instead of introducing another
theme or compatibility layer.

## Brand language

- Warm paper background: `#FBF7F1`
- Deep navy ink: `#0E1B2C`
- Coral action color: `#FF6B47`
- Violet voice accent: `#7C6EF5`
- Sage and honey are supporting atmospheric colors
- Fraunces is reserved for display headings; Inter is used for controls and body copy
- Surfaces are translucent warm paper with navy borders and restrained depth

## Motion

- The shared premium background uses slow watercolor drift, contour rings,
  a voice horizon, and subtle paper grain.
- The landing voice field maps amplitude from honey through coral to violet.
- The PWA voice waveform uses the same hospitality spectrum.
- All decorative motion must stop under `prefers-reduced-motion`.
- Motion may communicate live voice state, hierarchy, or transition; it should
  not imitate speech when no audio is present.

## Product language

Use “assistant,” “commands,” and “connected systems.” Keep copy concrete and
hospitality-specific. Do not expose provider or protocol terminology in the UI.

## Layout safeguards

- Use `overflow-x: clip` where supported so sticky landing scenes keep working.
- Keep touch targets at least 44px on phone and tablet layouts.
- PWA panels remain full-width bottom sheets on phones and centered floating
  sheets on tablets and desktops.
