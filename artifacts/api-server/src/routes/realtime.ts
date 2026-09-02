/**
 * Unified VoyceLab Agent — REST endpoints for WebRTC-based Realtime API
 *
 * POST /session  → Mint ephemeral OpenAI token, return tools + instructions
 * POST /tools    → Execute a tool call server-side, return result + optional order command
 *
 * The client connects directly to OpenAI via WebRTC using the ephemeral token.
 * Tool calls arrive on the data channel, the client POSTs here, then sends the
 * result back to OpenAI via the data channel.
 *
 * All tool definitions and executors live in ../tools/ — this file only handles
 * HTTP routing, session management, and the OpenAI session handshake.
 */

import { Router } from "express";
import { requireAuth, requirePlan } from "./auth";
import {
  db,
  serviceConnectionsTable,
} from "@workspace/db";
import {
  PLANS,
  listConnectedServiceProviders,
  listVoicePipelineProviders,
} from "@workspace/voicelab-core";
import { getPlan, planAllowsPipeline, buildUsageLimitSnapshot } from "@workspace/voicelab-core/pricing";
import { getNoiseModeBehavior, type NoiseMode } from "@workspace/voicelab-core/noise";
import { normalizeOrderHandlingMode } from "@workspace/voicelab-core/agent-profile";
import { eq, and } from "drizzle-orm";
import {
  type CatalogItem,
  type OrderItem,
  type SessionOrderItem,
} from "../lib/square-helpers";
import { getSquareClient } from "../lib/square-client";
import { getCachedCredentials } from "../lib/credential-cache";
import { getCachedCatalog } from "../lib/catalog-cache";
import { getCachedAgentProfile } from "../lib/agent-profile-cache";
import { ensureUserOrganization, userOwnsOrganization } from "./v1/_helpers";
import { executeToolCall } from "../tools";
import {
  getSkillsForSession,
  buildToolsFromSkills,
  buildInstructionsFromSkills,
  skillSummary,
} from "../skills";
import {
  getSession,
  getSessionOrRehydrate,
  markDirty,
  persistSessionNow,
  removeSession,
  withSessionLock,
} from "../lib/session-store";
import { readServerApiKey, requiredApiKeyEnv } from "../lib/api-keys";
import { OPENAI_REALTIME_MODEL, buildRealtimeSessionPayload } from "../lib/openai-realtime";
import { getCachedVoiceMinutes } from "../lib/usage-cache";
import { hasGeneralConnectedSystemsCached } from "../lib/connected-systems-cache";
import { beginCommandExecution, completeCommandExecution } from "../lib/command-ledger";
import {
  registerVoiceSession,
  recordVoiceHeartbeat,
  finalizeVoiceSessionUsage,
  startVoiceSessionSweeper,
} from "../lib/voice-session-metering";
import { sendSanitizedError } from "../lib/error-sanitizer";

const router = Router();

// Start PostgreSQL-backed stale session sweeper
startVoiceSessionSweeper();

// Master switch for acoustic (full-duplex) barge-in. Off by default because
// browser echo cancellation does not reliably suppress the agent's own voice
// on external speakers / Bluetooth, which made the agent interrupt itself
// after a word or two. When false, the server never auto-cancels on detected
// speech and the client runs half-duplex (mic gated during playback) with
// tap-to-interrupt. Set ACOUSTIC_BARGE_IN=1 to opt back in.
const ACOUSTIC_BARGE_IN_ENABLED = process.env.ACOUSTIC_BARGE_IN === "1";

function includedVoiceMinutesForPlan(planId: string | null | undefined): number {
  if (planId === "admin") return -1;
  return getPlan(planId ?? "trial")?.includedVoiceMinutes ?? getPlan("trial")?.includedVoiceMinutes ?? 60;
}

async function currentOrganizationId(req: any): Promise<string | null> {
  const existing = req.organization?.id;
  if (existing) return existing;
  if (!req.user) return null;
  // Memoize on the request: the /tools handler resolves the org id in both the
  // overage check and the main body, and ensureUserOrganization can write on a
  // cold path. Resolving once per request avoids the duplicate round trip.
  if (req._resolvedOrganizationId !== undefined) return req._resolvedOrganizationId;
  const org = await ensureUserOrganization(req.user);
  req._resolvedOrganizationId = org.id;
  return org.id;
}

function parseOptionalVenueId(raw: unknown): number | null | "invalid" {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : "invalid";
}

function orderSnapshotToSessionItems(rawOrder: unknown, catalog: CatalogItem[]): SessionOrderItem[] {
  if (!Array.isArray(rawOrder)) return [];

  const items = new Map<string, SessionOrderItem>();
  for (const raw of rawOrder) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const itemId = typeof item.item_id === "string" ? item.item_id : typeof item.id === "string" ? item.id : undefined;
    const itemName = typeof item.item_name === "string" ? item.item_name : typeof item.name === "string" ? item.name : "";
    const quantity = Number(item.quantity ?? 0);
    if (!itemName || !Number.isFinite(quantity) || quantity <= 0) continue;

    const normalizedName = itemName.toLowerCase();
    const match = catalog.find((catalogItem) => itemId && catalogItem.id === itemId)
      ?? catalog.find((catalogItem) => catalogItem.name.toLowerCase() === normalizedName)
      ?? catalog.find((catalogItem) => catalogItem.name.toLowerCase().includes(normalizedName) || normalizedName.includes(catalogItem.name.toLowerCase()));
    const catalogItemId = match?.id ?? itemId ?? itemName;
    const variationId = match?.variationId ?? (typeof item.variationId === "string" ? item.variationId : undefined);
    const price = Number(item.price ?? match?.price ?? 0);

    const existing = items.get(catalogItemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.set(catalogItemId, {
        catalogItemId,
        variationId,
        name: match?.name ?? itemName,
        price: Number.isFinite(price) ? price : 0,
        quantity,
      });
    }
  }

  return [...items.values()];
}

function formatLimit(value: number, label: string): string {
  if (value === -1) return `unlimited ${label}`;
  return `${value.toLocaleString()} ${label}`;
}

function formatPlanPrice(monthly: number, yearly: number): string {
  if (monthly === 0 && yearly === 0) return "contact sales or free";
  return `$${monthly}/mo, or $${yearly}/mo when billed yearly`;
}

function buildVoycelabDemoInstructions(): string {
  const publicServices = listConnectedServiceProviders()
    .filter((service) => service.provider !== "mock")
    .map((service) => {
      const availability =
        service.status === "available"
          ? "live now"
          : service.status === "needs_configuration"
            ? "available with configuration"
            : "available by request";
      return `- ${service.displayName}: ${availability}. ${service.description}`;
    })
    .join("\n");

  const voiceEngines = listVoicePipelineProviders()
    .filter((provider) => !provider.isFallback)
    .map((provider) => `- ${provider.displayName}: ${provider.shortDescription}`)
    .join("\n");

  const fallbackVoiceOptions = listVoicePipelineProviders()
    .filter((provider) => provider.isFallback)
    .map((provider) => provider.displayName)
    .join(", ");

  const planSummary = PLANS.map((plan) => {
    const trial = plan.trialDays ? `${plan.trialDays}-day trial. ` : "";
    const minutes = plan.includedVoiceMinutes === -1
      ? "custom voice minutes"
      : `${plan.includedVoiceMinutes.toLocaleString()} voice minutes/month`;
    return `- ${plan.name}: ${plan.tagline} ${trial}${formatPlanPrice(
      plan.monthlyPriceUsd,
      plan.yearlyPriceUsdPerMonth,
    )}. Includes ${formatLimit(plan.maxVenues, "venues")}, ${formatLimit(
      plan.maxAssistants,
      "assistants",
    )}, ${minutes}. ${plan.bullets.map((bullet) => bullet.text).join(" ")}`;
  }).join("\n");

  return `You are Bev, the VoyceLab voice guide on the public website. You answer customer questions about VoyceLab, the business, the site, plans, setup, integrations, voice options, and how hospitality teams use the service.

Conversation style:
- Be warm, confident, plain-spoken, and natural.
- Keep most answers to one or two short sentences. Use three or four sentences only when the customer asks for detail.
- Do not sound like a brochure. Do not use bullets in spoken answers unless the customer asks you to compare options.
- Say "assistant" or "voice assistant", not "agent". Say "commands" or "actions", not "tools". Say "connected systems", not "APIs".
- If you are uncertain, say so briefly and point them to the relevant page or sales@voycelab.com.

Core positioning:
- VoyceLab is a voice-powered operations platform for hospitality and service businesses: wedding venues, bars, restaurants, event spaces, retail hospitality, and multi-location hospitality groups.
- It gives owners and teams voice assistants they can speak to anywhere, especially while on the floor or on the go.
- Assistants connect to the systems a venue already uses, then answer questions and take approved actions across POS, orders, inventory, catalog, payments, customers, team/labor, bookings, reports, and daily operations.
- The promise is less busywork and more time with guests. Staff can ask natural questions like "What are my top-selling cocktails?", "Do we have enough tequila for tonight?", "Run end-of-day close", or "Walk me through the Johnson wedding".
- The website calls this "The Voice Assistant that helps you run your business" and "Where voice runs hospitality."

How it works:
- Owners create an account, start a 14-day free trial, connect Square or another supported service, create an assistant, choose what it can do, choose room/noise behavior, pick a voice experience, test it, then launch.
- Setup is intentionally lightweight: name the assistant, set a wake phrase such as "Hey Bev", connect a system, choose allowed actions, tune the room, choose the voice engine, test, and launch.
- Assistants can be configured for a venue assistant, POS assistant, inventory assistant, or a general business assistant.
- Permission controls matter: owners choose which actions are allowed, which require approval first, and which are not allowed. Sensitive actions such as refunds, catalog changes, item deletion, and team-status changes start locked down.
- Room modes include standard, loud venue, and push-to-talk. Noisy rooms can use more controlled listening or push-to-talk.
- The public demo you are speaking through is a sandbox FAQ. It does not connect to a real venue, access a POS, read customer accounts, or execute business actions.

What VoyceLab can do:
- POS and orders: search the menu, add or remove items, check an order, clear an order, submit an order, send to terminal, and sync live orders.
- Reporting: list orders, show sales reports, list open orders, get order details, hourly sales, item performance, daily summaries, and locations.
- Inventory: check stock, check all inventory, adjust or set inventory, transfer inventory, view inventory changes, create low-stock reports, get item details, batch adjustments, and inventory summaries.
- Catalog: create, update, or delete items, list and create categories, list modifiers, and apply discounts where allowed.
- Customers and payments: search, create, get, and update customers; list payments; refund or cancel payments where allowed.
- Team and labor on higher tiers: list team members, view current shifts, clock in, and clock out.
- Workflows include end-of-day close, opening checklist, and stock take.
- General business assistants can use uploaded knowledge documents, a read-only database connection, and configured email sending.

Connected services:
${publicServices}

Square details:
- Square is the primary live integration today.
- Square powers location selection, catalog/menu lookup, orders, terminal checkout, inventory reads and adjustments, reports, customers, payments, and team data where the plan and permissions allow it.
- Users connect Square through OAuth, pick the Square location the assistant should control, and can add more locations later.
- If Square is down, the product is designed to fall back gracefully to the voice or push-to-talk surface and cached menu where possible; writes wait until the connection is back.

Voice experiences:
${voiceEngines}
- Fallback options are always available for resilience: ${fallbackVoiceOptions}.
- Trial includes OpenAI Realtime voice. Pro and Business add Gemini-class native voice and all engines.
- Customers can change an assistant's voice engine later from assistant settings.

Pricing and trial:
${planSummary}
- Yearly billing saves about 17%.
- The trial is 14 days, no card required, with 100 voice minutes and core POS commands for testing.
- Billing is platform fee plus spoken voice minutes. Idle screens and dashboard work cost nothing.
- Overage is a soft cap, not a hard stop. Assistants keep working; the overage rate drops on higher tiers.
- For enterprise needs like SSO, SCIM, IP allowlists, custom audit logs, or dedicated deployments, contact sales@voycelab.com.

Who should use each plan:
- Trial: any venue that wants to test voice POS with core commands before committing.
- Pro: multi-venue operators that need every skill including inventory, catalog, customers, payments, team & labor, and Gemini-class voice.
- Business: hospitality groups and event venues that need unlimited venues and assistants, every voice engine, and dedicated support.

Good answers to common questions:
- "What is VoyceLab?" Answer: VoyceLab lets hospitality teams run parts of their business by voice, connecting assistants to Square and other systems so staff can ask questions and take approved actions without stopping service.
- "How does Square connect?" Answer: Users authorize Square, pick a location, and VoyceLab lets the assistant use only the actions the owner allows, such as menu lookup, orders, stock checks, reporting, and payments.
- "Can it make real changes?" Answer: Yes, in a connected venue it can make approved changes like orders or inventory updates, but owners decide what requires confirmation and what is blocked.
- "Is this only for bars?" Answer: No. Bars are a core use case, but it is built for restaurants, wedding venues, event spaces, retail hospitality, and groups running multiple locations.
- "How do I start?" Answer: Start the free trial, connect Square, create an assistant, choose allowed actions and voice settings, then test it before launching.
- "Can it answer questions about my documents or database?" Answer: Yes, the general business assistant can use uploaded knowledge files, a read-only database connection, and configured email.
- "What does the demo do?" Answer: This website demo only explains VoyceLab; it is not connected to a real POS or account.

Guardrails:
- Stay focused on VoyceLab and related customer buying questions. If asked unrelated questions, say you can only help with VoyceLab questions on this line.
- Never claim this public demo can access the user's venue, pricing account, POS, private data, or payment system.
- Never invent customer-specific numbers, integrations, compliance certifications, or contract terms.
- For exact checkout issues, Clerk Billing setup, custom enterprise terms, or unsupported integrations, direct them to the website or sales@voycelab.com.
- Never be pushy. Help the customer understand whether VoyceLab is useful for them.`;
}

/** Public landing-page voice demo: answers questions about VoyceLab only (no connected actions). */
const VOYCELAB_DEMO_INSTRUCTIONS = buildVoycelabDemoInstructions();

/** Simple sliding-window rate limit for unauthenticated demo minting (per IP). */
const demoSessionHits = new Map<string, number[]>();
function demoRateLimitOk(ip: string, recordHit = true): boolean {
  const windowMs = Number(process.env.VOYCELAB_DEMO_RATE_WINDOW_MS ?? 900000); // 15 min
  const maxHits = Number(process.env.VOYCELAB_DEMO_RATE_MAX ?? 12);
  const now = Date.now();
  const prev = demoSessionHits.get(ip) ?? [];
  const fresh = prev.filter((t) => now - t < windowMs);
  if (fresh.length >= maxHits) return false;
  if (recordHit) fresh.push(now);
  demoSessionHits.set(ip, fresh);
  return true;
}

function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }) {
  const xf = req.headers["x-forwarded-for"];
  const raw = typeof xf === "string" ? xf.split(",")[0]?.trim() : Array.isArray(xf) ? xf[0]?.trim() : "";
  return raw || req.socket.remoteAddress || "unknown";
}

function buildDemoRealtimeSessionConfig(voice: string, speed: number) {
  return buildRealtimeSessionPayload({
    instructions: VOYCELAB_DEMO_INSTRUCTIONS,
    voice,
    speed,
    // semantic_vad uses a model to detect natural turn ends rather than
    // a fixed silence timer. eagerness="auto" commits the turn as soon
    // as the model judges the user finished — "low" added a long silence
    // tail that made every exchange feel laggy, while semantic detection
    // still tolerates mid-sentence pauses far better than the old
    // server_vad 180ms timer that clipped every breath.
    // interrupt_response follows ACOUSTIC_BARGE_IN_ENABLED: off by default
    // so the agent's own audio on speaker / Bluetooth can't truncate the
    // reply. The demo client half-duplex-gates the mic during playback.
    turnDetection: {
      type: "semantic_vad",
      eagerness: "auto",
      create_response: true,
      interrupt_response: ACOUSTIC_BARGE_IN_ENABLED,
    },
  });
}

function buildTurnDetection(noiseMode: NoiseMode): Record<string, unknown> | null {
  switch (noiseMode) {
    case "standard":
      // interrupt_response is gated by ACOUSTIC_BARGE_IN_ENABLED. With it off
      // (default), the agent's own audio bleeding into the mic on speaker /
      // Bluetooth no longer truncates the response — the client half-duplex
      // gates the mic during playback and offers tap-to-interrupt instead.
      // See VoiceAgentContext "mic gating".
      // eagerness="auto" lets semantic detection commit the turn the moment
      // the user sounds finished — "low" waited out a long silence tail and
      // made back-to-back commands feel laggy.
      return {
        type: "semantic_vad",
        eagerness: "auto",
        create_response: true,
        interrupt_response: ACOUSTIC_BARGE_IN_ENABLED,
      };
    case "loud":
      return {
        type: "server_vad",
        threshold: 0.6,
        prefix_padding_ms: 400,
        silence_duration_ms: 600,
        create_response: true,
        interrupt_response: ACOUSTIC_BARGE_IN_ENABLED,
      };
    case "push_to_talk":
      return null;
  }
}

function buildRealtimeSessionConfig(voice: string, speed: number, catalog: CatalogItem[], order: OrderItem[], plan?: string, assistantKind: "venue" | "general" = "venue", noiseMode: NoiseMode = "standard", includeGeneralTools = false, profileDisplayName = "", profilePersonality = "", orderHandlingMode: "auto_complete" | "hold_for_review" = "auto_complete") {
  const skills = getSkillsForSession(plan ?? "trial", { kind: assistantKind, includeGeneralTools });
  const tools = buildToolsFromSkills(skills);
  let instructions = buildInstructionsFromSkills(skills, catalog, order, assistantKind);

  // Prepend agent identity and custom personality when configured on the profile.
  if (profileDisplayName || profilePersonality) {
    const identity = profileDisplayName ? `You are ${profileDisplayName}. ` : "";
    const personality = profilePersonality ? `${profilePersonality}\n\n` : "";
    instructions = `${identity}${personality}${instructions}`;
  }

  // Order-handling behavior: in hold-for-review mode, the assistant must never
  // imply a payment was taken — the ticket is parked on the POS for later review.
  if (assistantKind === "venue" && orderHandlingMode === "hold_for_review") {
    instructions = `${instructions}\n\nORDER HANDLING: This venue reviews orders at close-out. When you submit an order, it is held as an open ticket on the POS for the team to settle later — payment is NOT taken now. After submitting, confirm with phrasing like "Sent to the POS for review" or "Added to the tab for close-out". Never say it was paid, charged, or completed.`;
  }

  return buildRealtimeSessionPayload({
    instructions,
    tools,
    voice,
    speed,
    turnDetection: buildTurnDetection(noiseMode),
    noiseMode,
  });
}

// ── Mock bar demo data ────────────────────────────────────────────────────────

const MOCK_BAR_CATALOG = [
  { name: "Margarita", price: 12, category: "Cocktails" },
  { name: "Ranch Water", price: 11, category: "Cocktails" },
  { name: "Old Fashioned", price: 14, category: "Cocktails" },
  { name: "Moscow Mule", price: 12, category: "Cocktails" },
  { name: "Paloma", price: 11, category: "Cocktails" },
  { name: "Modelo Especial", price: 7, category: "Beer" },
  { name: "Corona", price: 7, category: "Beer" },
  { name: "Dos Equis", price: 7, category: "Beer" },
  { name: "Shiner Bock", price: 6, category: "Beer" },
  { name: "IPA (House)", price: 8, category: "Beer" },
  { name: "Bud Light", price: 6, category: "Beer" },
  { name: "Budweiser", price: 6, category: "Beer" },
  { name: "Miller Lite", price: 6, category: "Beer" },
  { name: "Coors Light", price: 6, category: "Beer" },
  { name: "Michelob Ultra", price: 7, category: "Beer" },
  { name: "Heineken", price: 8, category: "Beer" },
  { name: "Stella Artois", price: 8, category: "Beer" },
  { name: "Guinness", price: 9, category: "Beer" },
  { name: "House Red", price: 13, category: "Wine" },
  { name: "House White", price: 12, category: "Wine" },
  { name: "Prosecco", price: 14, category: "Wine" },
  { name: "Coke", price: 3, category: "Non-Alcoholic" },
  { name: "Sprite", price: 3, category: "Non-Alcoholic" },
  { name: "Topo Chico", price: 4, category: "Non-Alcoholic" },
  { name: "Chips & Salsa", price: 8, category: "Food" },
  { name: "Queso", price: 10, category: "Food" },
  { name: "Wings (12)", price: 16, category: "Food" },
  { name: "Loaded Nachos", price: 14, category: "Food" },
] as const;

const catalogList = MOCK_BAR_CATALOG.map((i) => `${i.name} ($${i.price}, ${i.category})`).join(", ");

const MOCK_BAR_PERSONA = `You are Voyce, the voice bartender running the floor at The Den — a demo bar. Someone is trying VoyceLab on the marketing site, so this needs to feel fast, sharp, and human. You are the reason they want it.

Persona:
- Professional and warm, with real personality — a sharp bartender who runs a tight bar. Confident, efficient, easy to talk to. Never robotic, never a canned script.
- NO compliments or flattery. Never tell the guest their order is a "good call", "nice", "great choice", "solid pick", or "good one". Just take the order like a pro.
- Speak in short, natural sentences. One line is usually right; two only when it earns it. Vary your wording constantly — never reuse the same phrasing twice in a session.
- Don't recite the entire running ticket unless the guest asks ("what's on the ticket?", "what's my total?") — the ticket is on screen.
- Never ask "is that right?" or "sound good?" after an order. You heard them; just ring it in.

Menu at The Den: ${catalogList}

Confirming an order — do this every time, and speak it WHILE the tool runs so there is never dead air:
- The moment you understand what they want, start talking as you ring it in. State back just the items you added, plainly, and invite the next one. Shape it like "Okay, that's a Heineken and four Bud Lights — anything else?" — but vary the wording every single time. Never repeat the same sentence twice.
- Confirm ONLY what was just added, not the whole ticket. You already know the items and counts from what they said, so say them immediately — do not wait for the tool to finish.
- Prices and totals come ONLY from the tool result — never say a dollar figure from memory. If you give a total, speak the frame ("That brings you to...") and let the result land the number.
- NEVER announce the mechanics — no "one sec", "let me add that", "checking now", or "give me a moment". Just do it while you talk.

Sending the order:
- When the guest signals they're done — "that's it", "send it", "process the order", "ring it up", "close it out", "fire it", "that'll do it" — call submit_order. It sends the ticket to the bar and clears it. Confirm plainly and naturally ("Sent — that's in. Ticket's clear.").

Other flow:
- If you mishear, ask one quick, natural clarification ("Was that two or ten?") instead of guessing. Only when it's genuinely unclear.
- Keep the pace of a real bar in service: fast, direct, professional.`;

const MOCK_BAR_TOOLS = [
  {
    type: "function" as const,
    name: "add_item",
    description: `Add item(s) to the order. Available items: ${catalogList}`,
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item name from the menu" },
        quantity: { type: "number", description: "How many to add (default 1)" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function" as const,
    name: "remove_item",
    description: "Remove item(s) from the current order.",
    parameters: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Item name to remove" },
        quantity: { type: "number", description: "How many to remove (default 1)" },
      },
      required: ["item_name"],
    },
  },
  {
    type: "function" as const,
    name: "get_order",
    description: "Show the current order with all items and running total.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function" as const,
    name: "clear_order",
    description: "Clear all items from the current order without sending it.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function" as const,
    name: "submit_order",
    description:
      "Process/send the order to the bar and clear the ticket. Call this when the guest is done ('that's it', 'send it', 'process the order', 'ring it up', 'close it out', 'fire it').",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function" as const,
    name: "search_menu",
    description: "Search the menu by name or category.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (item name or category)" },
      },
      required: ["query"],
    },
  },
];

interface MockOrderItem {
  name: string;
  price: number;
  quantity: number;
  category: string;
}

const mockBarOrders = new Map<string, { items: MockOrderItem[]; lastAccess: number }>();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, entry] of mockBarOrders) {
    if (entry.lastAccess < cutoff) mockBarOrders.delete(id);
  }
}, 60_000);

function fuzzyMatch(input: string): (typeof MOCK_BAR_CATALOG)[number] | undefined {
  const q = input.toLowerCase().trim();
  const exact = MOCK_BAR_CATALOG.find((i) => i.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = MOCK_BAR_CATALOG.find((i) => i.name.toLowerCase().includes(q));
  if (partial) return partial;
  return MOCK_BAR_CATALOG.find((i) => q.includes(i.name.toLowerCase()));
}

function getMockOrder(sessionId: string): MockOrderItem[] {
  let entry = mockBarOrders.get(sessionId);
  if (!entry) {
    entry = { items: [], lastAccess: Date.now() };
    mockBarOrders.set(sessionId, entry);
  }
  entry.lastAccess = Date.now();
  return entry.items;
}

function executeMockBarTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): { result: string; order: MockOrderItem[] } {
  const items = getMockOrder(sessionId);

  switch (toolName) {
    case "add_item": {
      const match = fuzzyMatch(String(args.item_name ?? ""));
      if (!match) return { result: `Item "${args.item_name}" not found on menu.`, order: items };
      const qty = Math.max(1, Math.min(20, Number(args.quantity) || 1));
      const existing = items.find((i) => i.name === match.name);
      if (existing) {
        existing.quantity += qty;
      } else {
        items.push({ name: match.name, price: match.price, quantity: qty, category: match.category });
      }
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      return { result: `Added ${qty}x ${match.name}. Total: $${total}.`, order: items };
    }
    case "remove_item": {
      const match = fuzzyMatch(String(args.item_name ?? ""));
      if (!match) return { result: `Item "${args.item_name}" not found on menu.`, order: items };
      const qty = Math.max(1, Number(args.quantity) || 1);
      const idx = items.findIndex((i) => i.name === match.name);
      if (idx === -1) return { result: `${match.name} is not on the order.`, order: items };
      items[idx].quantity -= qty;
      if (items[idx].quantity <= 0) items.splice(idx, 1);
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      return { result: `Removed ${qty}x ${match.name}. Total: $${total}.`, order: items };
    }
    case "get_order": {
      if (items.length === 0) return { result: "Order is empty.", order: items };
      const lines = items.map((i) => `${i.quantity}x ${i.name} ($${i.price * i.quantity})`);
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      return { result: `Order: ${lines.join(", ")}. Total: $${total}.`, order: items };
    }
    case "clear_order": {
      items.length = 0;
      return { result: "Order cleared.", order: items };
    }
    case "submit_order": {
      if (items.length === 0) return { result: "There's nothing on the ticket to send yet.", order: items };
      const count = items.reduce((s, i) => s + i.quantity, 0);
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      items.length = 0;
      return {
        result: `Order sent to the bar — ${count} item${count === 1 ? "" : "s"}, $${total}. Ticket cleared.`,
        order: items,
      };
    }
    case "search_menu": {
      const q = String(args.query ?? "").toLowerCase();
      const matches = MOCK_BAR_CATALOG.filter(
        (i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q),
      );
      if (matches.length === 0) return { result: `No items matching "${args.query}".`, order: items };
      const list = matches.map((i) => `${i.name} ($${i.price})`).join(", ");
      return { result: `Found: ${list}`, order: items };
    }
    default:
      return { result: `Unknown tool: ${toolName}`, order: items };
  }
}

// ── POST /demo — Unified public demo endpoint (no auth, rate-limited) ─────────
// Accepts optional `mode` parameter: "faq" (VoyceLab FAQ) or "bar" (mock bar demo).
// Defaults to "bar". Legacy paths /demo-session and /demo-bar-session are aliases.

async function handleDemoSession(req: any, res: any) {
  if (process.env.VOYCELAB_DEMO_ENABLED === "0" || process.env.VOYCELAB_DEMO_ENABLED === "false") {
    res.status(503).json({ error: "demo_disabled", detail: "Voice demo is temporarily unavailable." });
    return;
  }

  const apiKey = readServerApiKey("openai")?.value ?? "";
  if (!apiKey) {
    res.status(503).json({ error: "demo_unavailable", detail: "Voice demo is not configured." });
    return;
  }

  const ip = clientIp(req);
  if (!demoRateLimitOk(ip, false)) {
    res.status(429).json({
      error: "too_many_requests",
      detail: "Too many demo sessions from this network. Try again in a few minutes.",
    });
    return;
  }

  const { voice = "coral", speed = 1.05, mode: rawMode } = req.body ?? {};
  // Resolve mode: explicit body param > path-based inference > default "bar"
  let mode: "faq" | "bar" = "bar";
  if (rawMode === "faq" || rawMode === "bar") {
    mode = rawMode;
  } else if (req.path === "/demo-session") {
    mode = "faq";
  }

  const voiceStr = typeof voice === "string" ? voice : "coral";
  const speedNum =
    typeof speed === "number" && Number.isFinite(speed) && speed >= 0.75 && speed <= 1.35 ? speed : 1.05;

  const isBar = mode === "bar";
  const instructions = isBar ? MOCK_BAR_PERSONA : VOYCELAB_DEMO_INSTRUCTIONS;
  const sessionConfig = isBar
    ? buildRealtimeSessionPayload({
        instructions,
        tools: MOCK_BAR_TOOLS,
        voice: voiceStr,
        speed: speedNum,
        turnDetection: {
          type: "semantic_vad",
          eagerness: "auto",
          create_response: true,
          interrupt_response: true,
        },
      })
    : buildDemoRealtimeSessionConfig(voiceStr, speedNum);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ session: sessionConfig }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Realtime] Demo (${mode}) ephemeral token failed:`, errText);
      res.status(response.status).json({ error: "demo_session_failed", detail: errText });
      return;
    }

    const data = (await response.json()) as any;
    demoRateLimitOk(ip);

    const payload: Record<string, unknown> = {
      id: data.session?.id ?? "",
      client_secret: { value: data.value, expires_at: data.expires_at },
    };
    if (isBar) {
      payload.model = OPENAI_REALTIME_MODEL;
      payload.instructions = instructions;
      payload.catalog = MOCK_BAR_CATALOG;
    }
    res.json(payload);
  } catch (e: any) {
    console.error(`[Realtime] Demo (${mode}) session error:`, e.message);
    res.status(500).json({ error: e.message });
  }
}

router.post("/demo", handleDemoSession);
/** @deprecated Alias for POST /demo?mode=faq — kept for backward compat with landing page. */
router.post("/demo-session", handleDemoSession);
/** @deprecated Alias for POST /demo?mode=bar — kept for backward compat with landing page. */
router.post("/demo-bar-session", handleDemoSession);

router.post("/demo-bar-tools", async (req: any, res: any) => {
  const ip = clientIp(req);
  if (!demoRateLimitOk(ip, false)) {
    res.status(429).json({ error: "too_many_requests", detail: "Rate limited." });
    return;
  }

  const { session_id, tool_name, arguments: args = {} } = req.body ?? {};
  if (!tool_name || !session_id) {
    res.status(400).json({ error: "session_id and tool_name are required" });
    return;
  }

  const { result, order } = executeMockBarTool(String(session_id), String(tool_name), args as Record<string, unknown>);
  res.json({ result, order });
});

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const apiKey = readServerApiKey("openai")?.value ?? "";
  if (!apiKey) {
    res.status(500).json({ error: `${requiredApiKeyEnv("openai")} not configured` });
    return;
  }

  const plan = req.subscription?.plan ?? "trial";
  const organizationId = await currentOrganizationId(req);

  let usedMinutes = 0;
  let usageLimits: any = null;

  try {
    usedMinutes = await getCachedVoiceMinutes(req.user.id, organizationId);
    usageLimits = buildUsageLimitSnapshot(req.isAdmin ? "admin" : plan, usedMinutes);

    if (!req.isAdmin && usageLimits.risk === "blocked") {
      res.status(402).json({
        error: "usage_limit_exceeded",
        detail: `Your voice assistants are currently suspended because you've reached your absolute plan overage cap (${usageLimits.hardCapMinutes} min). Please upgrade on the Billing page to resume.`,
      });
      return;
    }
  } catch {
    if (process.env.USAGE_CHECK_FAIL_OPEN !== "1") {
      res.status(503).json({ error: "usage_check_unavailable", code: "usage_check_unavailable" });
      return;
    }
  }

  const { voice = "ash", speed = 1.0, catalog = [], order = [], venueId, agentProfileId } = req.body ?? {};
  const requestedVenueId = parseOptionalVenueId(venueId);
  if (requestedVenueId === "invalid") {
    res.status(400).json({ error: "invalid_venue", detail: "venueId must be a positive integer" });
    return;
  }

  let provider = "openai_realtime_webrtc";
  let providerConfig: Record<string, unknown> = {};
  let assistantKind: "venue" | "general" = "venue";
  let effectiveVenueId = requestedVenueId;

  let noiseMode: NoiseMode = "standard";

  let profileDisplayName = "";
  let profilePersonality = "";
  let profileConnectedServiceId: string | null = null;
  let profileUsesSquareService = true;
  let orderHandlingMode: "auto_complete" | "hold_for_review" = "auto_complete";

  if (agentProfileId) {
    const profile = await getCachedAgentProfile(String(agentProfileId));
    if (!profile) {
      res.status(404).json({ error: "agent_profile_not_found" });
      return;
    }
    if (!(await userOwnsOrganization(req.user.id, profile.organizationId))) {
      res.status(403).json({ error: "agent_profile_forbidden" });
      return;
    }
    provider = profile.voicePipelineProvider;
    providerConfig = (profile.voicePipelineConfig as Record<string, unknown>) ?? {};
    orderHandlingMode = normalizeOrderHandlingMode(profile.orderHandlingMode);
    if (profile.venueId !== null && requestedVenueId !== null && profile.venueId !== requestedVenueId) {
      res.status(400).json({ error: "profile_venue_mismatch", detail: "Assistant is not linked to this venue." });
      return;
    }
    if (profile.venueId !== null && requestedVenueId === null) effectiveVenueId = profile.venueId;
    if (profile.noiseMode) noiseMode = profile.noiseMode as NoiseMode;
    profileDisplayName = profile.displayName || "";
    profilePersonality = profile.personality || "";
    if (profile.connectedServiceId) {
      profileConnectedServiceId = profile.connectedServiceId;
      const [conn] = await db
        .select({ provider: serviceConnectionsTable.provider })
        .from(serviceConnectionsTable)
        .where(
          and(
            eq(serviceConnectionsTable.id, profile.connectedServiceId),
            eq(serviceConnectionsTable.organizationId, profile.organizationId),
          ),
        )
        .limit(1);
      if (!conn) {
        res.status(403).json({ error: "connected_service_forbidden" });
        return;
      }
      if (conn.provider !== "square") {
        assistantKind = "general";
        profileUsesSquareService = false;
      }
    }
  }

  // Look up credentials server-side if a venue is in scope. The effective
  // venue may come from the launch request or from the bound assistant profile.
  let squareToken = "";
  let squareLocationId = "";
  if (effectiveVenueId !== null && profileUsesSquareService) {
    const creds = await getCachedCredentials(req.user.id, effectiveVenueId, organizationId, profileConnectedServiceId);
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  // Without an agent profile (or with no connected service), fall back to
  // "general" if the venue has no Square credentials — that way the assistant
  // never pretends to be a bar manager when there's no POS to talk to.
  const isAdmin = Boolean(req.isAdmin);
  if (!isAdmin && !planAllowsPipeline(plan, provider as import("@workspace/voicelab-core/voice-pipeline").VoicePipelineProvider)) {
    res.status(402).json({
      error: "pipeline_not_in_plan",
      detail: `The "${provider}" voice engine is not included in your "${plan}" plan. Upgrade to unlock it.`,
      provider,
    });
    return;
  }

  if (assistantKind === "venue" && !squareToken) assistantKind = "general";

  // The server owns the catalog: the prompt lists what the venue actually
  // sells, straight from Square (cached), not whatever the client sent. A
  // client-supplied catalog is only a fallback for when Square is unreachable.
  let sessionCatalog: CatalogItem[] = Array.isArray(catalog) ? catalog : [];
  if (squareToken) {
    const loaded = await getCachedCatalog(getSquareClient(squareToken, squareLocationId));
    if (loaded.items.length > 0) sessionCatalog = loaded.items;
  }

  // When general connected systems are configured, merge those commands into
  // venue sessions so Square plus email/knowledge/database workflows can run
  // in one assistant.
  const includeGeneralTools =
    assistantKind === "venue" && (await hasGeneralConnectedSystemsCached(req.user.id, organizationId));

  const skills = getSkillsForSession(plan, { kind: assistantKind, includeGeneralTools });

  if (provider !== "openai_realtime_webrtc") {
    res.status(409).json({
      error: "pipeline_requires_relay",
      detail: `${provider} is saved on this assistant. Open it in the Expo/web relay client path; this browser WebRTC surface only supports OpenAI Realtime today.`,
      provider,
    });
    return;
  }

  console.log(`[Realtime] Creating session: plan=${plan}, provider=${provider}, skills=[${skillSummary(skills)}], venue=${effectiveVenueId || "none"}`);

  const sessionConfig = buildRealtimeSessionConfig(
    String(providerConfig.voice ?? voice),
    Number(providerConfig.speed ?? speed),
    sessionCatalog,
    order,
    plan,
    assistantKind,
    noiseMode,
    includeGeneralTools,
    profileDisplayName,
    profilePersonality,
    orderHandlingMode,
  );

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ session: sessionConfig }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Realtime] Ephemeral token failed:", errText);
      res.status(response.status).json({ error: "Failed to create session", detail: errText });
      return;
    }

    const data = (await response.json()) as any;
    const transportSessionId = data.session?.id ?? "";
    const ephemeralExpiresAt = data.expires_at ?? null;

    // Register durable voice session for metering and order recovery
    const logicalSessionId = transportSessionId;
    try {
      await registerVoiceSession({
        id: logicalSessionId,
        userId: req.user.id,
        organizationId,
        venueId: effectiveVenueId,
        agentProfileId: agentProfileId ? String(agentProfileId) : null,
        pipelineProvider: provider,
      });
    } catch (regErr: any) {
      console.warn("[Realtime] Session registration failed:", regErr.message);
    }

    const behavior = getNoiseModeBehavior(noiseMode);
    const acousticBargeIn = ACOUSTIC_BARGE_IN_ENABLED && behavior.bargeInEnabled;
    // Server-authoritative wake greeting: the client fires this verbatim as
    // response.create instructions the moment the wake word lands, so the
    // assistant speaks first with minimal time-to-first-token.
    const greetingPersona = profileDisplayName ? ` You are ${profileDisplayName}.` : "";
    const greeting = `The user just summoned you with your wake phrase.${greetingPersona} Immediately say one short, warm greeting — under eight words, e.g. "Hey! What can I do for you?". Do not list capabilities or mention commands. Then stop speaking and wait for their request.`;
    res.json({
      id: transportSessionId,
      client_secret: { value: data.value, expires_at: ephemeralExpiresAt },
      instructions: sessionConfig.instructions,
      greeting,
      assistantKind,
      voicelab: {
        noiseMode,
        bargeIn: acousticBargeIn,
        pushToTalk: behavior.pushToTalkRequired,
        orderHandlingMode,
        logicalSessionId,
        sessionRotateRecommendedMs: 420_000,
        ephemeralExpiresAt,
        usage: usageLimits ? {
          used: usedMinutes,
          limit: usageLimits.includedMinutes,
          hardCap: usageLimits.hardCapMinutes,
          risk: usageLimits.risk,
        } : null,
      },
    });
  } catch (e: any) {
    console.error("[Realtime] Session error:", e.message);
    sendSanitizedError(res, 500, "session_mint_failed", e);
  }
});

// ── POST /tools — Execute a tool call ─────────────────────────────────────────
// Session state is managed by the shared session-store (in-memory + DB write-through).

router.post("/tools", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const {
    session_id,
    call_id,
    tool_name,
    arguments: args = {},
    catalog = [],
    order = [],
    venueId,
    confirmed,
    confirmationToken,
    agentProfileId,
    orderHandlingMode: orderHandlingModeOverride,
  } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }

  const requestedVenueId = parseOptionalVenueId(venueId);
  if (requestedVenueId === "invalid") {
    res.status(400).json({ error: "invalid_venue", detail: "venueId must be a positive integer" });
    return;
  }

  if (!req.isAdmin) {
    try {
      const plan = req.subscription?.plan ?? "trial";
      const organizationId = await currentOrganizationId(req);
      const used = await getCachedVoiceMinutes(req.user.id, organizationId);
      const limits = buildUsageLimitSnapshot(plan, used);
      if (limits.risk === "blocked") {
        res.json({
          result: `This command was blocked because this assistant has exceeded its absolute voice minutes overage cap (${limits.hardCapMinutes} min). Please upgrade your subscription on the Billing page to resume using commands.`,
        });
        return;
      }
    } catch {
      if (process.env.USAGE_CHECK_FAIL_OPEN !== "1") {
        res.status(503).json({ error: "usage_check_unavailable", code: "usage_check_unavailable" });
        return;
      }
    }
  }

  let squareToken = "";
  let squareLocationId = "";
  const organizationId = await currentOrganizationId(req);
  let noiseMode: import("@workspace/voicelab-core/noise").NoiseMode = "standard";
  let profileAllowedTools: string[] | null = null;
  let profileConnectedServiceId: string | null = null;
  let profileUsesSquareService = true;
  let effectiveVenueId = requestedVenueId;
  let profileOrderHandlingMode: "auto_complete" | "hold_for_review" = "auto_complete";
  if (agentProfileId) {
    const profile = await getCachedAgentProfile(String(agentProfileId));
    if (!profile) {
      res.status(404).json({ error: "agent_profile_not_found" });
      return;
    }
    if (!(await userOwnsOrganization(req.user.id, profile.organizationId))) {
      res.status(403).json({ error: "agent_profile_forbidden" });
      return;
    }
    if (profile.venueId !== null && requestedVenueId !== null && profile.venueId !== requestedVenueId) {
      res.status(400).json({ error: "profile_venue_mismatch", detail: "Assistant is not linked to this venue." });
      return;
    }
    if (profile.venueId !== null && requestedVenueId === null) effectiveVenueId = profile.venueId;
    if (profile.noiseMode) {
      noiseMode = profile.noiseMode as typeof noiseMode;
    }
    profileOrderHandlingMode = normalizeOrderHandlingMode(profile.orderHandlingMode);
    profileConnectedServiceId = profile.connectedServiceId;
    if (profile.connectedServiceId) {
      const [conn] = await db
        .select({ provider: serviceConnectionsTable.provider })
        .from(serviceConnectionsTable)
        .where(
          and(
            eq(serviceConnectionsTable.id, profile.connectedServiceId),
            eq(serviceConnectionsTable.organizationId, profile.organizationId),
          ),
        )
        .limit(1);
      if (!conn) {
        res.status(403).json({ error: "connected_service_forbidden" });
        return;
      }
      if (conn.provider !== "square") profileUsesSquareService = false;
    }
    if (Array.isArray(profile.allowedTools) && profile.allowedTools.every((name: unknown): name is string => typeof name === "string")) {
      profileAllowedTools = profile.allowedTools;
    }
  }

  if (effectiveVenueId !== null && profileUsesSquareService) {
    const creds = await getCachedCredentials(req.user.id, effectiveVenueId, organizationId, profileConnectedServiceId);
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  const sessionId = String(session_id || `rt-${req.user.id}-${effectiveVenueId ?? "general"}`);
  const callId = typeof call_id === "string" ? call_id : "";
  const numericVenueId = effectiveVenueId ?? 0;

  // Server-owned catalog (cached per venue) so every command resolves item
  // names against what Square actually has. Loaded before the session lock so
  // a cold cache never holds the lock while Square is paged.
  const squareClient = squareToken ? getSquareClient(squareToken, squareLocationId) : undefined;
  let toolCatalog: CatalogItem[] = Array.isArray(catalog) ? catalog : [];
  if (squareClient) {
    const loaded = await getCachedCatalog(squareClient);
    if (loaded.items.length > 0) toolCatalog = loaded.items;
  }

  const existingSession = getSession(sessionId);
  if (
    existingSession &&
    (existingSession.userId !== req.user.id || existingSession.venueId !== numericVenueId)
  ) {
    res.status(403).json({ error: "session_forbidden" });
    return;
  }

  // Command idempotency ledger
  const ledger = await beginCommandExecution({
    sessionId,
    callId,
    toolName: String(tool_name),
    args: args as Record<string, unknown>,
    userId: req.user.id,
    organizationId,
    venueId: effectiveVenueId ?? undefined,
    agentProfileId: agentProfileId ? String(agentProfileId) : null,
  });

  if (ledger.action === "replay" && ledger.entry) {
    res.json({ result: ledger.entry.result ?? "Command completed.", command: ledger.entry.command ?? null });
    return;
  }
  if (ledger.action === "wait") {
    res.status(409).json({ error: "command_in_progress", code: "command_in_progress" });
    return;
  }

  const toolStart = Date.now();

  try {
    const result = await withSessionLock(sessionId, async () => {
      const session = await getSessionOrRehydrate(
        sessionId,
        squareToken,
        squareLocationId,
        { userId: req.user.id, organizationId, venueId: numericVenueId },
        agentProfileId ? String(agentProfileId) : null,
      );

      if (session.items.length === 0) {
        const initialItems = orderSnapshotToSessionItems(order, toolCatalog);
        if (initialItems.length > 0) {
          session.items.push(...initialItems);
          markDirty(sessionId);
        }
      }

      const assistantKind: "venue" | "general" = squareToken ? "venue" : "general";
      const includeGeneralTools =
        assistantKind === "venue" && (await hasGeneralConnectedSystemsCached(req.user.id, organizationId));
      const toolDefinitions = buildToolsFromSkills(getSkillsForSession(
        (req.subscription?.plan as string | undefined) ?? "trial",
        { kind: assistantKind, includeGeneralTools },
      ));
      const allowedToolSet = new Set(toolDefinitions.map((tool) => tool.name));
      if (profileAllowedTools && profileAllowedTools.length > 0) {
        const profileAllowedSet = new Set(profileAllowedTools);
        for (const name of [...allowedToolSet]) {
          if (name !== "wait_for_user" && !profileAllowedSet.has(name)) allowedToolSet.delete(name);
        }
      }
      if (!allowedToolSet.has(String(tool_name))) {
        throw Object.assign(new Error("tool_not_allowed"), { statusCode: 403 });
      }

      return executeToolCall(
        tool_name,
        args,
        {
          catalog: toolCatalog,
          order,
          squareToken,
          squareLocationId,
          session,
          squareClient,
          requestId: sessionId,
          callId,
          userId: req.user.id,
          userRole: req.organization?.role,
          organizationId,
          venueId: effectiveVenueId ?? undefined,
          assistantKind,
          noiseMode,
          orderHandlingMode:
            orderHandlingModeOverride === "auto_complete" || orderHandlingModeOverride === "hold_for_review"
              ? orderHandlingModeOverride
              : profileOrderHandlingMode,
          confirmed: confirmed === true,
          confirmationToken: typeof confirmationToken === "string" ? confirmationToken : undefined,
        },
      );
    });

    const managed = getSession(sessionId);
    if (managed && managed.session.items.length === 0 && !managed.session.squareOrderId) {
      removeSession(sessionId);
    } else {
      await persistSessionNow(sessionId);
    }

    const durationMs = Date.now() - toolStart;
    await completeCommandExecution({
      sessionId,
      callId,
      status: "succeeded",
      result: result.result,
      command: result.command,
      durationMs,
    });

    res.json({ result: result.result, command: result.command ?? null });
  } catch (e: any) {
    const durationMs = Date.now() - toolStart;
    await completeCommandExecution({
      sessionId,
      callId,
      status: "failed",
      result: `Tool error: ${e.message}`,
      durationMs,
      errorMessage: e.message,
    }).catch(() => {});

    console.error(`[Realtime] Tool error (${tool_name}):`, e.message);
    if (e.statusCode === 403) {
      res.status(403).json({ error: "tool_not_allowed", code: "tool_not_allowed" });
      return;
    }
    sendSanitizedError(res, 500, "tool_execution_failed", e);
  }
});

// ── Voice-minute metering (PostgreSQL-backed) ─────────────────────────────────

router.post("/session/:id/heartbeat", requireAuth as any, async (req: any, res: any) => {
  const sessionId = req.params.id;
  const { elapsedMs, provider, agentProfileId } = req.body ?? {};
  const organizationId = await currentOrganizationId(req);

  const ok = await recordVoiceHeartbeat({
    sessionId,
    userId: req.user.id,
    organizationId,
    elapsedMs: typeof elapsedMs === "number" ? elapsedMs : 0,
    venueId: Number(req.body?.venueId ?? 0),
    provider: typeof provider === "string" ? provider : undefined,
    agentProfileId: typeof agentProfileId === "string" ? agentProfileId : null,
  });

  if (!ok) {
    res.status(403).json({ error: "session_forbidden", code: "session_forbidden" });
    return;
  }

  res.sendStatus(200);
});

router.post("/session/:id/end", requireAuth as any, async (req: any, res: any) => {
  const sessionId = req.params.id;
  const { durationMs, provider, agentProfileId } = req.body ?? {};
  const organizationId = await currentOrganizationId(req);

  await finalizeVoiceSessionUsage({
    sessionId,
    userId: req.user.id,
    organizationId,
    durationMs: typeof durationMs === "number" ? durationMs : 0,
    provider: typeof provider === "string" ? provider : undefined,
    venueId: Number(req.body?.venueId ?? 0),
    agentProfileId: typeof agentProfileId === "string" ? agentProfileId : null,
  });

  res.sendStatus(200);
});

export default router;
