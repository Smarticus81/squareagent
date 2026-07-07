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
  usageEventsTable,
  emailCredentialsTable,
  knowledgeDocumentsTable,
  externalDbConnectionsTable,
} from "@workspace/db";
import {
  PLANS,
  listConnectedServiceProviders,
  listVoicePipelineProviders,
} from "@workspace/voicelab-core";
import { getPlan, planAllowsPipeline, buildUsageLimitSnapshot } from "@workspace/voicelab-core/pricing";
import { getNoiseModeBehavior, type NoiseMode } from "@workspace/voicelab-core/noise";
import { normalizeOrderHandlingMode } from "@workspace/voicelab-core/agent-profile";
import { eq, sql, and, gte, isNull, or } from "drizzle-orm";
import {
  type CatalogItem,
  type OrderItem,
  type SessionOrderItem,
} from "../lib/square-helpers";
import { SquareClient } from "../lib/square-client";
import { getCachedCredentials } from "../lib/credential-cache";
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
  getOrCreateSession,
  getSession,
  markDirty,
  removeSession,
} from "../lib/session-store";
import { readServerApiKey, requiredApiKeyEnv } from "../lib/api-keys";

const router = Router();

const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
// gpt-realtime-2 — GA speech-to-speech model with reasoning support.
// We default reasoning.effort to "minimal" for the lowest first-audio
// latency; bump via OPENAI_REALTIME_REASONING_EFFORT if tool-call quality
// ever needs the extra thinking time.
const OPENAI_REALTIME_REASONING_EFFORT =
  (process.env.OPENAI_REALTIME_REASONING_EFFORT as "minimal" | "low" | "medium" | "high" | undefined) ?? "minimal";

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
  const org = await ensureUserOrganization(req.user);
  return org.id;
}

function tenantWhere(table: { organizationId: any; userId: any }, userId: number, organizationId: string) {
  return or(
    eq(table.organizationId, organizationId),
    and(eq(table.userId, userId), isNull(table.organizationId)),
  );
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

async function hasGeneralConnectedSystems(userId: number, organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const [[email], [document], [database]] = await Promise.all([
      db
        .select({ id: emailCredentialsTable.id })
        .from(emailCredentialsTable)
        .where(tenantWhere(emailCredentialsTable, userId, organizationId))
        .limit(1),
      db
        .select({ id: knowledgeDocumentsTable.id })
        .from(knowledgeDocumentsTable)
        .where(tenantWhere(knowledgeDocumentsTable, userId, organizationId))
        .limit(1),
      db
        .select({ id: externalDbConnectionsTable.id })
        .from(externalDbConnectionsTable)
        .where(tenantWhere(externalDbConnectionsTable, userId, organizationId))
        .limit(1),
    ]);
    return Boolean(email || document || database);
  } catch {
    return false;
  }
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
  return {
    type: "realtime" as const,
    model: OPENAI_REALTIME_MODEL,
    instructions: VOYCELAB_DEMO_INSTRUCTIONS,
    output_modalities: ["audio" as const],
    // Realtime prompting guide: keep reasoning low for snappy demo Q&A.
    reasoning: { effort: OPENAI_REALTIME_REASONING_EFFORT },
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        transcription: { model: "gpt-realtime-whisper" },
        // semantic_vad uses a model to detect natural turn ends rather than
        // a fixed silence timer. eagerness="auto" commits the turn as soon
        // as the model judges the user finished — "low" added a long silence
        // tail that made every exchange feel laggy, while semantic detection
        // still tolerates mid-sentence pauses far better than the old
        // server_vad 180ms timer that clipped every breath.
        // interrupt_response follows ACOUSTIC_BARGE_IN_ENABLED: off by default
        // so the agent's own audio on speaker / Bluetooth can't truncate the
        // reply. The demo client half-duplex-gates the mic during playback.
        turn_detection: {
          type: "semantic_vad" as const,
          eagerness: "auto" as const,
          create_response: true,
          interrupt_response: ACOUSTIC_BARGE_IN_ENABLED,
        },
      },
      output: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        voice,
        speed,
      },
    },
  };
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

  const turnDetection = buildTurnDetection(noiseMode);

  return {
    type: "realtime" as const,
    model: OPENAI_REALTIME_MODEL,
    instructions,
    tools,
    tool_choice: "auto" as const,
    output_modalities: ["audio" as const],
    reasoning: { effort: OPENAI_REALTIME_REASONING_EFFORT },
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        transcription: { model: "gpt-realtime-whisper" },
        turn_detection: turnDetection,
      },
      output: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        voice,
        speed,
      },
    },
  };
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

const MOCK_BAR_PERSONA = `You are Voyce, a bartender assistant for The Den, a demo bar. The user is trying VoyceLab on the marketing site. Help them try natural commands like 'two margaritas and a Modelo'.

Sound like real bar staff, not a command line. Keep replies short and natural — a quick sentence, with a little warmth or personality. Vary how you acknowledge ("Got it, two margs going up.", "Nice — Modelo's on there.", "Cool, what else?"); never repeat the same phrase twice and never give bare one-word replies. When you ring something in, keep talking through it instead of going silent — start the reply as you add the item and let it land, but never announce with canned fillers like "one sec" or "adding that now". Be warm and quick.`;

const catalogList = MOCK_BAR_CATALOG.map((i) => `${i.name} ($${i.price}, ${i.category})`).join(", ");

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
    description: "Clear all items from the current order.",
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
    ? {
        type: "realtime" as const,
        model: OPENAI_REALTIME_MODEL,
        instructions,
        tools: MOCK_BAR_TOOLS,
        tool_choice: "auto" as const,
        output_modalities: ["audio" as const],
        reasoning: { effort: OPENAI_REALTIME_REASONING_EFFORT },
        audio: {
          input: {
            format: { type: "audio/pcm" as const, rate: 24000 as const },
            transcription: { model: "gpt-realtime-whisper" },
            turn_detection: {
              type: "semantic_vad" as const,
              eagerness: "auto" as const,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: { type: "audio/pcm" as const, rate: 24000 as const },
            voice: voiceStr,
            speed: speedNum,
          },
        },
      }
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
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [usage] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
      .from(usageEventsTable)
      .where(and(
        organizationId
          ? or(
              eq(usageEventsTable.organizationId, organizationId),
              and(eq(usageEventsTable.userId, req.user.id), isNull(usageEventsTable.organizationId)),
            )
          : eq(usageEventsTable.userId, req.user.id),
        eq(usageEventsTable.kind, "voice_minutes"),
        gte(usageEventsTable.occurredAt, periodStart),
      ));
    usedMinutes = Number(usage?.total ?? 0);
    usageLimits = buildUsageLimitSnapshot(req.isAdmin ? "admin" : plan, usedMinutes);

    if (!req.isAdmin && usageLimits.risk === "blocked") {
      res.status(402).json({
        error: "usage_limit_exceeded",
        detail: `Your voice assistants are currently suspended because you've reached your absolute plan overage cap (${usageLimits.hardCapMinutes} min). Please upgrade on the Billing page to resume.`,
      });
      return;
    }
  } catch {
    // non-critical — allow session to proceed if usage check fails
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

  // When general connected systems are configured, merge those commands into
  // venue sessions so Square plus email/knowledge/database workflows can run
  // in one assistant.
  const includeGeneralTools =
    assistantKind === "venue" && (await hasGeneralConnectedSystems(req.user.id, organizationId));

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
    catalog,
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
    // Tell the client how to drive the mic. Acoustic (full-duplex) barge-in is
    // opt-in per noise mode AND gated by ACOUSTIC_BARGE_IN_ENABLED; the safe
    // default is half-duplex mic gating during playback with tap-to-interrupt.
    const behavior = getNoiseModeBehavior(noiseMode);
    const acousticBargeIn = ACOUSTIC_BARGE_IN_ENABLED && behavior.bargeInEnabled;
    // Server-authoritative wake greeting: the client fires this verbatim as
    // response.create instructions the moment the wake word lands, so the
    // assistant speaks first with minimal time-to-first-token.
    const greetingPersona = profileDisplayName ? ` You are ${profileDisplayName}.` : "";
    const greeting = `The user just summoned you with your wake phrase.${greetingPersona} Immediately say one short, warm greeting — under eight words, e.g. "Hey! What can I do for you?". Do not list capabilities or mention commands. Then stop speaking and wait for their request.`;
    res.json({
      id: data.session?.id ?? "",
      client_secret: { value: data.value, expires_at: data.expires_at },
      instructions: sessionConfig.instructions,
      greeting,
      assistantKind,
      voicelab: {
        noiseMode,
        bargeIn: acousticBargeIn,
        pushToTalk: behavior.pushToTalkRequired,
        orderHandlingMode,
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
    res.status(500).json({ error: e.message });
  }
});

// ── POST /tools — Execute a tool call ─────────────────────────────────────────
// Session state is managed by the shared session-store (in-memory + DB write-through).

router.post("/tools", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const {
    session_id,
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

  // Check overage cap on tool execution to prevent runaway loops
  if (!req.isAdmin) {
    try {
      const plan = req.subscription?.plan ?? "trial";
      const organizationId = await currentOrganizationId(req);
      const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [usage] = await db
        .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
        .from(usageEventsTable)
        .where(and(
          organizationId
            ? or(
                eq(usageEventsTable.organizationId, organizationId),
                and(eq(usageEventsTable.userId, req.user.id), isNull(usageEventsTable.organizationId)),
              )
            : eq(usageEventsTable.userId, req.user.id),
          eq(usageEventsTable.kind, "voice_minutes"),
          gte(usageEventsTable.occurredAt, periodStart),
        ));
      
      const used = Number(usage?.total ?? 0);
      const limits = buildUsageLimitSnapshot(plan, used);
      if (limits.risk === "blocked") {
        res.json({
          result: `This command was blocked because this assistant has exceeded its absolute voice minutes overage cap (${limits.hardCapMinutes} min). Please upgrade your subscription on the Billing page to resume using commands.`,
        });
        return;
      }
    } catch {
      // non-critical — proceed if db check fails
    }
  }

  // venueId is optional: general-assistant tools (web/knowledge/email/db) don't
  // need a Square-connected venue. We still try to load credentials when one
  // is provided so venue-mode tools keep working.
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

  // Use a stable fallback so multiple tool calls in one conversation share the same session
  const sessionId = String(session_id || `rt-${req.user.id}-${effectiveVenueId ?? "general"}`);
  const existingSession = getSession(sessionId);
  const numericVenueId = effectiveVenueId ?? 0;
  if (
    existingSession &&
    (existingSession.userId !== req.user.id || existingSession.venueId !== numericVenueId)
  ) {
    res.status(403).json({ error: "session_forbidden" });
    return;
  }
  const session = getOrCreateSession(sessionId, squareToken, squareLocationId, req.user.id, numericVenueId);
  if (!existingSession && session.items.length === 0) {
    const initialItems = orderSnapshotToSessionItems(order, catalog);
    if (initialItems.length > 0) {
      session.items.push(...initialItems);
      markDirty(sessionId);
    }
  }

  try {
    const squareClient = squareToken ? new SquareClient(squareToken, squareLocationId) : undefined;
    const assistantKind: "venue" | "general" = squareToken ? "venue" : "general";
    const includeGeneralTools =
      assistantKind === "venue" && (await hasGeneralConnectedSystems(req.user.id, organizationId));
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
      res.status(403).json({ error: "tool_not_allowed", detail: `Command not allowed in this assistant: ${tool_name}` });
      return;
    }
    const { result, command } = await executeToolCall(
      tool_name,
      args,
      {
        catalog,
        order,
        squareToken,
        squareLocationId,
        session,
        squareClient,
        requestId: sessionId,
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

    if (session.items.length === 0 && !session.squareOrderId) {
      removeSession(sessionId);
    } else {
      markDirty(sessionId);
    }

    res.json({ result, command: command ?? null });
  } catch (e: any) {
    console.error(`[Realtime] Tool error (${tool_name}):`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Voice-minute metering ─────────────────────────────────────────────────────

interface HeartbeatEntry {
  userId: number;
  organizationId: string | null;
  venueId: number;
  provider?: string;
  agentProfileId?: string | null;
  lastHeartbeatMs: number;
  startMs: number;
  lastUpdatedMs: number;
}

const heartbeatMap = new Map<string, HeartbeatEntry>();

// Sweeper for stale heartbeats to handle abrupt crashes
setInterval(async () => {
  const now = Date.now();
  for (const [sessionId, entry] of heartbeatMap.entries()) {
    if (now - entry.lastUpdatedMs > 120000) { // 2 minutes stale
      heartbeatMap.delete(sessionId);
      endedSessions.set(sessionId, now);
      if (entry.lastHeartbeatMs > 0) {
        try {
          await db.insert(usageEventsTable).values({
            kind: "voice_minutes",
            userId: entry.userId,
            organizationId: entry.organizationId,
            agentProfileId: entry.agentProfileId,
            quantity: Math.ceil(entry.lastHeartbeatMs / 60000),
            occurredAt: new Date(),
            metadata: {
              durationMs: entry.lastHeartbeatMs,
              provider: entry.provider ?? "openai_realtime_webrtc",
              venueId: entry.venueId || null,
              autoFlushed: true,
            },
          });
          console.log(`[Realtime] Autoflushed stale session ${sessionId}: ${entry.lastHeartbeatMs}ms`);
        } catch (err: any) {
          console.error(`[Realtime] Failed to autoflush stale session ${sessionId}:`, err.message);
        }
      }
    }
  }
}, 60000); // Check every minute

router.post("/session/:id/heartbeat", requireAuth as any, async (req: any, res: any) => {
  const sessionId = req.params.id;
  const { elapsedMs, provider, agentProfileId } = req.body ?? {};
  const organizationId = await currentOrganizationId(req);

  const existing = heartbeatMap.get(sessionId);
  if (existing) {
    if (existing.userId !== req.user.id || existing.organizationId !== organizationId) {
      res.status(403).json({ error: "session_forbidden" });
      return;
    }
    existing.lastHeartbeatMs = typeof elapsedMs === "number" ? elapsedMs : Date.now() - existing.startMs;
    existing.lastUpdatedMs = Date.now();
    if (typeof provider === "string" && provider) existing.provider = provider;
    if (typeof agentProfileId === "string" && agentProfileId) existing.agentProfileId = agentProfileId;
  } else {
    heartbeatMap.set(sessionId, {
      userId: req.user.id,
      organizationId,
      venueId: Number(req.body?.venueId ?? 0),
      provider: typeof provider === "string" && provider ? provider : undefined,
      agentProfileId: typeof agentProfileId === "string" && agentProfileId ? agentProfileId : null,
      lastHeartbeatMs: typeof elapsedMs === "number" ? elapsedMs : 0,
      startMs: Date.now(),
      lastUpdatedMs: Date.now(),
    });
  }

  res.sendStatus(200);
});

// Sessions already finalized — the client may legitimately POST /end more than
// once (pagehide + beforeunload both fire); without this a retry re-bills the
// body durationMs a second time.
const endedSessions = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, endedAt] of endedSessions.entries()) {
    if (endedAt < cutoff) endedSessions.delete(id);
  }
}, 60_000);

router.post("/session/:id/end", requireAuth as any, async (req: any, res: any) => {
  const sessionId = req.params.id;
  const { durationMs, provider, agentProfileId } = req.body ?? {};
  if (endedSessions.has(sessionId)) {
    res.sendStatus(200);
    return;
  }
  const entry = heartbeatMap.get(sessionId);
  const organizationId = await currentOrganizationId(req);
  if (entry && (entry.userId !== req.user.id || entry.organizationId !== organizationId)) {
    res.status(403).json({ error: "session_forbidden" });
    return;
  }
  const venueId = entry?.venueId ?? Number(req.body?.venueId ?? 0);
  const effectiveProvider = typeof provider === "string" && provider
    ? provider
    : entry?.provider ?? "openai_realtime_webrtc";
  const effectiveAgentProfileId = typeof agentProfileId === "string" && agentProfileId
    ? agentProfileId
    : entry?.agentProfileId ?? null;

  const effectiveDuration = typeof durationMs === "number" && durationMs > 0
    ? durationMs
    : entry?.lastHeartbeatMs ?? 0;

  if (effectiveDuration > 0) {
    try {
      await db.insert(usageEventsTable).values({
        kind: "voice_minutes",
        userId: req.user.id,
        organizationId,
        agentProfileId: effectiveAgentProfileId,
        quantity: Math.ceil(effectiveDuration / 60000),
        metadata: { durationMs: effectiveDuration, provider: effectiveProvider, venueId: venueId || null },
      });
    } catch {
      // non-critical — don't fail the response
    }
  }

  endedSessions.set(sessionId, Date.now());
  heartbeatMap.delete(sessionId);
  res.sendStatus(200);
});

export default router;
