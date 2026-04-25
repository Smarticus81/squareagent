/**
 * VoyceLab — design tokens.
 *
 * Brand world: black marble bar top, warm brass edge light, low ambient glow,
 * glass catching neon, a thin strip of live sound. Dark mode is the flagship.
 */

export const voyceTokens = {
  black: "#07080A",
  graphite: "#111318",
  graphite2: "#181B22",
  graphite3: "#242832",

  ivory: "#F5EFE3",
  bone: "#E6D9C3",
  sand: "#C9B894",
  ash: "#8B909A",

  brass: "#C69A52",
  brass2: "#E0B76A",
  ember: "#FF6A2A",

  voice: "#7C6EF5",
  voice2: "#5E56E6",
  voiceGlow: "rgba(124, 110, 245, 0.35)",

  success: "#35C275",
  warning: "#F2B84B",
  danger: "#E05252",

  glass: "rgba(255, 255, 255, 0.065)",
  glassStrong: "rgba(255, 255, 255, 0.12)",
  line: "rgba(245, 239, 227, 0.14)",
  lineStrong: "rgba(245, 239, 227, 0.24)",
} as const;

export const voyceCopy = {
  brand: "VoyceLab",
  tagline: "The voice layer for modern venue operations.",
  promise: "Your team speaks. Your systems move.",
  motto: "Speak. Confirm. Sync.",
} as const;

export const noiseModes = [
  {
    value: "quiet_room",
    label: "Quiet room",
    description: "Office, tasting room, private space.",
    wake: "Wake word listening",
    vad: "Soft VAD",
    confirm: "Light confirmations",
    intensity: 0.25,
  },
  {
    value: "restaurant",
    label: "Restaurant",
    description: "Moderate background noise.",
    wake: "Wake word + voice activity",
    vad: "Balanced VAD",
    confirm: "Standard confirmations",
    intensity: 0.45,
  },
  {
    value: "bar",
    label: "Bar",
    description: "Loud crowd, bartender pace.",
    wake: "Wake word + push-to-talk",
    vad: "Aggressive VAD",
    confirm: "Strict confirmations",
    intensity: 0.7,
  },
  {
    value: "nightclub",
    label: "Nightclub",
    description: "Very loud — push-to-talk dominant.",
    wake: "Push-to-talk only",
    vad: "Very aggressive VAD",
    confirm: "All risky tools confirmed",
    intensity: 0.9,
  },
  {
    value: "event_venue",
    label: "Event venue",
    description: "Variable noise; load event context.",
    wake: "Wake word with event preset",
    vad: "Adaptive VAD",
    confirm: "Per-tool confirmation",
    intensity: 0.6,
  },
  {
    value: "manual_push_to_talk",
    label: "Push-to-talk only",
    description: "Hold to speak. No ambient listening.",
    wake: "Manual trigger",
    vad: "Off",
    confirm: "Strict confirmations",
    intensity: 0.35,
  },
] as const;

export const pipelineOutcomes = [
  {
    id: "fastest_realtime",
    label: "Fastest realtime",
    description: "Lowest latency speech-to-speech for fast service.",
    advanced: ["OpenAI Realtime", "Gemini Live"],
  },
  {
    id: "best_in_noise",
    label: "Best in noise",
    description: "Tuned for bars, clubs, and event floors.",
    advanced: ["Deepgram Voice Agent", "Cartesia + Deepgram"],
  },
  {
    id: "best_voice_quality",
    label: "Best voice quality",
    description: "Studio-grade voice for tasting rooms and front-of-house.",
    advanced: ["ElevenLabs Agents", "Cartesia Sonic"],
  },
  {
    id: "enterprise_control",
    label: "Enterprise control",
    description: "Self-hosted realtime with policy and audit.",
    advanced: ["LiveKit Agents", "Pipecat", "Custom"],
  },
  {
    id: "fallback_manual",
    label: "Fallback / manual",
    description: "Push-to-talk fallback when networks misbehave.",
    advanced: ["WebSocket relay", "Browser STT"],
  },
] as const;

export const connectedProviders = [
  {
    id: "square",
    name: "Square",
    status: "live" as const,
    description: "Catalog, orders, terminal, inventory.",
  },
  {
    id: "toast",
    name: "Toast",
    status: "request" as const,
    description: "Restaurant POS with kitchen display & tabs.",
  },
  {
    id: "clover",
    name: "Clover",
    status: "request" as const,
    description: "Clover Station, Mini, and Flex.",
  },
  {
    id: "lightspeed",
    name: "Lightspeed",
    status: "request" as const,
    description: "Retail and Restaurant K-Series.",
  },
  {
    id: "shopify_pos",
    name: "Shopify POS",
    status: "request" as const,
    description: "In-store and online unified commerce.",
  },
  {
    id: "godaddy_poynt",
    name: "GoDaddy / Poynt",
    status: "request" as const,
    description: "Poynt-based countertop & mobile.",
  },
  {
    id: "revel",
    name: "Revel",
    status: "request" as const,
    description: "Enterprise iPad POS for QSR & retail.",
  },
  {
    id: "rest_webhook",
    name: "REST / Webhook",
    status: "request" as const,
    description: "Generic bridge for custom systems.",
  },
] as const;

export const permissionTools = [
  { id: "read_menu", label: "Read menu", risk: "low" as const },
  { id: "create_order", label: "Create order", risk: "medium" as const },
  { id: "submit_order", label: "Submit order", risk: "high" as const },
  { id: "send_to_terminal", label: "Send to terminal", risk: "high" as const },
  { id: "check_inventory", label: "Check inventory", risk: "low" as const },
  { id: "adjust_inventory", label: "Adjust inventory", risk: "high" as const },
  { id: "run_reports", label: "Run reports", risk: "low" as const },
  { id: "run_workflows", label: "Run workflows", risk: "medium" as const },
] as const;
