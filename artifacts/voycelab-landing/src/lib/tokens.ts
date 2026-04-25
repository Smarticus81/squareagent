/**
 * VoyceLab — design tokens and product vocabulary.
 *
 * These tokens drive the product's user-facing language: assistants, allowed
 * actions, approvals, voice options, room settings, connected services. The
 * underlying engineering may use other terms (agents, tools, pipelines, etc.);
 * those names live in code, never in default user-facing UI.
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
  tagline: "Create a voice assistant for the systems you already use.",
  promise:
    "Name your assistant, connect Square or another service, choose what it can do, and test a command before you launch.",
  conversion: "I named my assistant, connected my service, tested a command, and saw it work.",
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
   Voice options — outcome-based, no provider names by default.
   ───────────────────────────────────────────────────────────────── */

export const voiceOptions = [
  {
    id: "fastest_realtime",
    label: "Fastest live voice",
    description: "Quickest replies, ideal for fast service.",
    advancedNote: "OpenAI Realtime · Gemini Live",
  },
  {
    id: "best_in_noise",
    label: "Best for loud rooms",
    description: "Prioritizes clear listening, shorter responses, and extra approvals before sensitive actions.",
    advancedNote: "Deepgram Voice Agent · Cartesia + Deepgram",
  },
  {
    id: "best_voice_quality",
    label: "Most natural voice",
    description: "Studio-grade voice for tasting rooms and front-of-house.",
    advancedNote: "ElevenLabs Agents · Cartesia Sonic",
  },
  {
    id: "enterprise_control",
    label: "Most controlled setup",
    description: "Self-hosted live voice with team access and full audit history.",
    advancedNote: "LiveKit Agents · Pipecat · Custom",
  },
  {
    id: "fallback_manual",
    label: "Text and push-to-talk fallback",
    description: "When networks misbehave or the room is too loud, your team can fall back to push-to-talk.",
    advancedNote: "WebSocket relay · Browser STT",
  },
] as const;

export type VoiceOptionId = typeof voiceOptions[number]["id"];

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
