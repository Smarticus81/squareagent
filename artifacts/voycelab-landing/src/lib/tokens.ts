/**
 * VoyceLab — design tokens and product vocabulary.
 *
 * These tokens drive the product's user-facing language: assistants, allowed
 * actions, approvals, voice options, room settings, connected services. The
 * underlying engineering may use other terms (agents, tools, pipelines, etc.);
 * those names live in code, never in default user-facing UI.
 */

export const voyceTokens = {
  /* Paper backgrounds — pure white */
  cream: "#FFFFFF",
  creamWarm: "#FAFAF9",
  creamDeep: "#F4F4F5",
  paper: "#FFFFFF",

  /* Ink — near-black */
  ink: "#0A0A0B",
  inkSoft: "#27272A",
  inkMuted: "#71717A",
  inkFaint: "#A1A1AA",

  /* Primary CTA — deep ink (chatbase-style) */
  coral: "#0A0A0B",
  coralDeep: "#000000",
  coralSoft: "#3F3F46",
  coralTint: "#F4F4F5",

  /* Accent — violet/indigo signature */
  accent: "#6366F1",
  accentDeep: "#4F46E5",
  accentSoft: "#A5B4FC",
  accentTint: "#EEF2FF",

  /* Painterly pastel washes */
  peach: "#FBCFE8",
  peachSoft: "#FCE7F3",
  sage: "#A7F3D0",
  sageSoft: "#D1FAE5",
  lilac: "#C7D2FE",
  lilacSoft: "#E0E7FF",
  honey: "#FDE68A",
  honeySoft: "#FEF3C7",

  /* Status */
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",

  /* Surface fills */
  glass: "rgba(255, 255, 255, 0.78)",
  glassStrong: "rgba(255, 255, 255, 0.92)",
  line: "rgba(10, 10, 11, 0.08)",
  lineStrong: "rgba(10, 10, 11, 0.16)",

  /* Back-compat aliases used by existing components */
  black: "#0A0A0B",
  graphite: "#18181B",
  graphite2: "#27272A",
  graphite3: "#3F3F46",
  ivory: "#0A0A0B",
  bone: "#27272A",
  sand: "#71717A",
  ash: "#A1A1AA",
  brass: "#000000",
  brass2: "#0A0A0B",
  ember: "#6366F1",
  voice: "#C7D2FE",
  voice2: "#818CF8",
  voiceGlow: "rgba(99, 102, 241, 0.30)",
} as const;

export const voyceCopy = {
  brand: "VoyceLab",
  brandTagline: "Where voice runs hospitality.",
  tagline: "Hospitality, orchestrated by voice.",
  promise:
    "VoyceLab connects voice assistants to the tools that power your venue. Natural conversations turn into real actions across service, inventory, POS, events, and your entire operation.",
  supporting: "Less busywork. More guest magic.",
  conversion: "Let's put your venue in conversation.",
  positioning: "Beyond commands. Beyond systems.",
} as const;

/* ─────────────────────────────────────────────────────────────────
   Room settings
   ───────────────────────────────────────────────────────────────── */

export const roomSettings = [
  {
    value: "quiet_room",
    label: "Quiet room",
    description: "Office, tasting room, private space.",
    listens: "More sensitive",
    asks: "Asks before sensitive actions",
    intensity: 0.25,
  },
  {
    value: "restaurant",
    label: "Restaurant",
    description: "Moderate background noise.",
    listens: "Balanced",
    asks: "Asks before sensitive actions",
    intensity: 0.45,
  },
  {
    value: "bar",
    label: "Bar",
    description: "Loud crowd, fast service.",
    listens: "More controlled",
    asks: "Asks more often",
    intensity: 0.7,
  },
  {
    value: "nightclub",
    label: "Nightclub",
    description: "Very loud — push-to-talk recommended.",
    listens: "Push-to-talk recommended",
    asks: "Asks before every sensitive action",
    intensity: 0.9,
  },
  {
    value: "event_venue",
    label: "Event space",
    description: "Variable noise — adapts to event setup.",
    listens: "Adaptive",
    asks: "Asks before sensitive actions",
    intensity: 0.6,
  },
  {
    value: "manual_push_to_talk",
    label: "Push-to-talk only",
    description: "Hold to speak. No background listening.",
    listens: "Manual only",
    asks: "Asks before sensitive actions",
    intensity: 0.35,
  },
] as const;

export type RoomSettingValue = typeof roomSettings[number]["value"];

/* ─────────────────────────────────────────────────────────────────
   Voice pipeline categories — displayed in plain sight in the wizard.
   The pipeline registry is fetched live from /api/v1/voice-pipelines;
   these tokens drive the section headers, ordering, and copy.
   ───────────────────────────────────────────────────────────────── */

export interface VoicePipelineCategoryDisplay {
  id:
    | "native_realtime_speech_to_speech"
    | "managed_voice_agent_api"
    | "realtime_orchestration_framework"
    | "modular_cascaded_pipeline"
    | "browser_or_manual_fallback";
  label: string;
  blurb: string;
  /** Sort order in the wizard, lowest first. */
  order: number;
}

export const voicePipelineCategories: VoicePipelineCategoryDisplay[] = [
  {
    id: "native_realtime_speech_to_speech",
    label: "Native realtime voice",
    blurb: "End-to-end audio-to-audio models. Lowest latency, best barge-in, the default for most venues.",
    order: 1,
  },
  {
    id: "managed_voice_agent_api",
    label: "Managed voice agent",
    blurb: "Fully hosted voice agent platforms with custom voices and SDKs.",
    order: 2,
  },
  {
    id: "realtime_orchestration_framework",
    label: "Self-hosted orchestration",
    blurb: "Production media infrastructure with full audit, telephony future, and enterprise control.",
    order: 3,
  },
  {
    id: "modular_cascaded_pipeline",
    label: "Modular STT + LLM + TTS",
    blurb: "Pick best-in-class components for each stage. Tunable for very noisy or specialty rooms.",
    order: 4,
  },
  {
    id: "browser_or_manual_fallback",
    label: "Manual & fallback",
    blurb: "Always-on fallbacks. Push-to-talk when networks misbehave or the room is too loud for any AI.",
    order: 5,
  },
];

/** Default pipeline if the API hasn't responded yet — keeps the wizard usable offline. */
export const DEFAULT_PIPELINE_PROVIDER = "openai_realtime_webrtc" as const;

/* ─────────────────────────────────────────────────────────────────
   Connected services
   ───────────────────────────────────────────────────────────────── */

export const connectedServices = [
  { id: "square", name: "Square", status: "live" as const, description: "Catalog, orders, terminal, stock checks." },
  { id: "custom", name: "Custom connection", status: "request" as const, description: "Bridge your own system. Available on request." },
  { id: "toast", name: "Toast", status: "request" as const, description: "Restaurant POS with kitchen display and tabs." },
  { id: "clover", name: "Clover", status: "request" as const, description: "Clover Station, Mini, and Flex." },
  { id: "lightspeed", name: "Lightspeed", status: "request" as const, description: "Retail and Restaurant K-Series." },
  { id: "shopify_pos", name: "Shopify POS", status: "request" as const, description: "In-store and online unified commerce." },
  { id: "godaddy_poynt", name: "GoDaddy / Poynt", status: "request" as const, description: "Poynt-based countertop and mobile." },
  { id: "revel", name: "Revel", status: "request" as const, description: "Enterprise iPad POS for QSR and retail." },
] as const;

/* ─────────────────────────────────────────────────────────────────
   Allowed actions — grouped in human language.
   Approval levels: no_approval | ask_first | not_allowed
   ───────────────────────────────────────────────────────────────── */

export type ApprovalLevel = "no_approval" | "ask_first" | "not_allowed";

export interface AssistantAction {
  id: string;
  label: string;
  defaultApproval: ApprovalLevel;
  internalTool: string; // engineering reference; never user-facing.
}

export interface ActionGroup {
  id: "lookup" | "prepare" | "act" | "sensitive";
  label: string;
  description: string;
  actions: AssistantAction[];
}

export const actionGroups: ActionGroup[] = [
  {
    id: "lookup",
    label: "Look up",
    description: "Information your assistant can read but never change.",
    actions: [
      { id: "search_menu", label: "Search the menu", defaultApproval: "no_approval", internalTool: "search_menu" },
      { id: "check_order", label: "Check an order", defaultApproval: "no_approval", internalTool: "get_order" },
      { id: "check_stock", label: "Check stock", defaultApproval: "no_approval", internalTool: "check_inventory" },
      { id: "sales_summary", label: "Get a sales summary", defaultApproval: "no_approval", internalTool: "daily_summary" },
    ],
  },
  {
    id: "prepare",
    label: "Prepare",
    description: "Help build something the user will confirm.",
    actions: [
      { id: "add_item", label: "Add an item", defaultApproval: "no_approval", internalTool: "add_item" },
      { id: "remove_item", label: "Remove an item", defaultApproval: "no_approval", internalTool: "remove_item" },
      { id: "prepare_checkout", label: "Prepare checkout", defaultApproval: "ask_first", internalTool: "submit_order" },
      { id: "start_routine", label: "Start a routine", defaultApproval: "ask_first", internalTool: "run_workflow" },
    ],
  },
  {
    id: "act",
    label: "Act",
    description: "Real changes in the connected service.",
    actions: [
      { id: "submit_order", label: "Submit an order", defaultApproval: "ask_first", internalTool: "submit_order" },
      { id: "send_to_terminal", label: "Send to terminal", defaultApproval: "ask_first", internalTool: "send_to_terminal" },
      { id: "adjust_stock", label: "Adjust stock", defaultApproval: "ask_first", internalTool: "adjust_inventory" },
      { id: "run_routine", label: "Run a routine", defaultApproval: "ask_first", internalTool: "run_workflow" },
    ],
  },
  {
    id: "sensitive",
    label: "Sensitive",
    description: "Changes that affect money, catalog, or your team.",
    actions: [
      { id: "refund_payment", label: "Refund a payment", defaultApproval: "not_allowed", internalTool: "refund_payment" },
      { id: "delete_item", label: "Delete an item", defaultApproval: "not_allowed", internalTool: "delete_item" },
      { id: "change_catalog", label: "Change catalog details", defaultApproval: "not_allowed", internalTool: "update_item" },
      { id: "change_team_status", label: "Change team status", defaultApproval: "not_allowed", internalTool: "update_team" },
    ],
  },
];

export const approvalLabels: Record<ApprovalLevel, string> = {
  no_approval: "No approval needed",
  ask_first: "Ask first",
  not_allowed: "Not allowed",
};

/* Default approval map for a fresh assistant — everyone starts with the
   safe defaults defined alongside each action. */
export function defaultApprovals(): Record<string, ApprovalLevel> {
  const out: Record<string, ApprovalLevel> = {};
  for (const group of actionGroups) {
    for (const action of group.actions) out[action.id] = action.defaultApproval;
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────
   Voice surface states — user-facing labels.
   ───────────────────────────────────────────────────────────────── */

export const voiceStateLabels = {
  ready: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  waitingApproval: "Waiting for approval",
  acting: "Acting",
  synced: "Synced",
  needsAttention: "Needs attention",
  offline: "Offline",
} as const;
