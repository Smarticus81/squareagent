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
import { db, agentProfilesTable, serviceConnectionsTable, usageEventsTable, emailCredentialsTable } from "@workspace/db";
import {
  PLANS,
  listConnectedServiceProviders,
  listVoicePipelineProviders,
} from "@workspace/voicelab-core";
import { getNoiseModeBehavior, type NoiseMode } from "@workspace/voicelab-core/noise";
import { eq, sql, and, gte } from "drizzle-orm";
import {
  type CatalogItem,
  type OrderItem,
} from "../lib/square-helpers";
import { SquareClient } from "../lib/square-client";
import { getCachedCredentials } from "../lib/credential-cache";
import { executeToolCall } from "../tools";
import {
  getSkillsForSession,
  buildToolsFromSkills,
  buildInstructionsFromSkills,
  skillSummary,
} from "../skills";
import {
  getOrCreateSession,
  markDirty,
  removeSession,
} from "../lib/session-store";

const router = Router();

const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
// gpt-realtime-2 — GA speech-to-speech model with reasoning support.
// We default reasoning.effort to "low" per the Realtime prompting guide:
// strong production trade-off between latency and reasoning quality.
const OPENAI_REALTIME_REASONING_EFFORT =
  (process.env.OPENAI_REALTIME_REASONING_EFFORT as "minimal" | "low" | "medium" | "high" | undefined) ?? "low";

// Master switch for acoustic (full-duplex) barge-in. Off by default because
// browser echo cancellation does not reliably suppress the agent's own voice
// on external speakers / Bluetooth, which made the agent interrupt itself
// after a word or two. When false, the server never auto-cancels on detected
// speech and the client runs half-duplex (mic gated during playback) with
// tap-to-interrupt. Set ACOUSTIC_BARGE_IN=1 to opt back in.
const ACOUSTIC_BARGE_IN_ENABLED = process.env.ACOUSTIC_BARGE_IN === "1";

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
- The trial is 14 days, no card required, with 60 voice minutes and core POS tools for testing.
- Billing is platform fee plus spoken voice minutes. Idle screens and dashboard work cost nothing.
- Overage is a soft cap, not a hard stop. Assistants keep working; the overage rate drops on higher tiers.
- For enterprise needs like SSO, SCIM, IP allowlists, custom audit logs, or dedicated deployments, contact sales@voycelab.com.

Who should use each plan:
- Trial: any venue that wants to test voice POS with core tools before committing.
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
- For exact checkout issues, Stripe setup, custom enterprise terms, or unsupported integrations, direct them to the website or sales@voycelab.com.
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
        // a fixed silence timer. eagerness="low" waits longer before
        // committing the turn so users can pause mid-sentence without being
        // cut off (the previous server_vad with 180ms silence was clipping
        // every breath). See OpenAI Realtime prompting guide.
        // interrupt_response follows ACOUSTIC_BARGE_IN_ENABLED: off by default
        // so the agent's own audio on speaker / Bluetooth can't truncate the
        // reply. The demo client half-duplex-gates the mic during playback.
        turn_detection: {
          type: "semantic_vad" as const,
          eagerness: "low" as const,
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
      return {
        type: "semantic_vad",
        eagerness: "low",
        create_response: true,
        interrupt_response: ACOUSTIC_BARGE_IN_ENABLED,
      };
    case "loud":
      return {
        type: "server_vad",
        threshold: 0.6,
        prefix_padding_ms: 400,
        silence_duration_ms: 800,
        create_response: true,
        interrupt_response: ACOUSTIC_BARGE_IN_ENABLED,
      };
    case "push_to_talk":
      return null;
  }
}

function buildRealtimeSessionConfig(voice: string, speed: number, catalog: CatalogItem[], order: OrderItem[], plan?: string, assistantKind: "venue" | "general" = "venue", noiseMode: NoiseMode = "standard", includeGeneralTools = false, profileDisplayName = "", profilePersonality = "") {
  const skills = getSkillsForSession(plan ?? "trial", { kind: assistantKind, includeGeneralTools });
  const tools = buildToolsFromSkills(skills);
  let instructions = buildInstructionsFromSkills(skills, catalog, order, assistantKind);

  // Prepend agent identity and custom personality when configured on the profile.
  if (profileDisplayName || profilePersonality) {
    const identity = profileDisplayName ? `You are ${profileDisplayName}. ` : "";
    const personality = profilePersonality ? `${profilePersonality}\n\n` : "";
    instructions = `${identity}${personality}${instructions}`;
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

const MOCK_BAR_PERSONA = `You are Voyce, a bartender assistant for The Den, a demo bar. The user is trying VoyceLab on the marketing site. Help them try natural commands like 'two margaritas and a Modelo'. Keep replies under 6 words. Be warm but efficient.`;

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

  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
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
              eagerness: "low" as const,
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
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const plan = req.subscription?.plan ?? "trial";
  const PLAN_LIMITS: Record<string, number> = { trial: 60, pro: 500, business: 2000, starter: 500, professional: 500, premium: 2000 };
  const limit = PLAN_LIMITS[plan] ?? 100;
  const overageCap = Math.floor(limit * 1.5);

  try {
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [usage] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEventsTable.quantity}), 0)` })
      .from(usageEventsTable)
      .where(and(
        eq(usageEventsTable.userId, req.user.id),
        eq(usageEventsTable.kind, "voice_minutes"),
        gte(usageEventsTable.occurredAt, periodStart),
      ));
    const used = Number(usage?.total ?? 0);
    if (used >= overageCap) {
      res.status(429).json({
        error: "usage_limit_exceeded",
        detail: `You've used ${used} of ${limit} included minutes (${overageCap} overage cap). Upgrade your plan or wait for the next billing cycle.`,
      });
      return;
    }
  } catch {
    // non-critical — allow session to proceed if usage check fails
  }

  const { voice = "ash", speed = 1.0, catalog = [], order = [], venueId, agentProfileId } = req.body ?? {};

  // Look up credentials server-side if venueId provided
  let squareToken = "";
  let squareLocationId = "";
  if (venueId) {
    const creds = await getCachedCredentials(req.user.id, Number(venueId));
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  let provider = "openai_realtime_webrtc";
  let providerConfig: Record<string, unknown> = {};
  let assistantKind: "venue" | "general" = "venue";

  let noiseMode: NoiseMode = "standard";

  let profileDisplayName = "";
  let profilePersonality = "";

  if (agentProfileId) {
    const [profile] = await db
      .select({
        voicePipelineProvider: agentProfilesTable.voicePipelineProvider,
        voicePipelineConfig: agentProfilesTable.voicePipelineConfig,
        connectedServiceId: agentProfilesTable.connectedServiceId,
        noiseMode: agentProfilesTable.noiseMode,
        displayName: agentProfilesTable.displayName,
        personality: agentProfilesTable.personality,
      })
      .from(agentProfilesTable)
      .where(eq(agentProfilesTable.id, String(agentProfileId)))
      .limit(1);
    if (profile) {
      provider = profile.voicePipelineProvider;
      providerConfig = (profile.voicePipelineConfig as Record<string, unknown>) ?? {};
      if (profile.noiseMode) noiseMode = profile.noiseMode as NoiseMode;
      profileDisplayName = profile.displayName || "";
      profilePersonality = profile.personality || "";
      if (profile.connectedServiceId) {
        const [conn] = await db
          .select({ provider: serviceConnectionsTable.provider })
          .from(serviceConnectionsTable)
          .where(eq(serviceConnectionsTable.id, profile.connectedServiceId))
          .limit(1);
        if (conn && conn.provider !== "square") assistantKind = "general";
      }
    }
  }

  // Without an agent profile (or with no connected service), fall back to
  // "general" if the venue has no Square credentials — that way the assistant
  // never pretends to be a bar manager when there's no POS to talk to.
  if (assistantKind === "venue" && !squareToken) assistantKind = "general";

  // When the user has email credentials or other general data sources
  // configured, merge general-assistant tools (Gmail, knowledge, web, db)
  // into the venue session so both POS and email are available.
  let includeGeneralTools = false;
  if (assistantKind === "venue") {
    try {
      const [emailCreds] = await db
        .select({ provider: emailCredentialsTable.provider })
        .from(emailCredentialsTable)
        .where(eq(emailCredentialsTable.userId, req.user.id))
        .limit(1);
      // Merge general-assistant tools when Gmail OAuth is connected (inbox read/send)
      // or any outbound email provider is configured (send_email).
      if (emailCreds) includeGeneralTools = true;
    } catch {}
  }

  const skills = getSkillsForSession(plan, { kind: assistantKind, includeGeneralTools });

  if (provider !== "openai_realtime_webrtc") {
    res.status(409).json({
      error: "pipeline_requires_relay",
      detail: `${provider} is saved on this assistant. Open it in the Expo/web relay client path; this browser WebRTC surface only supports OpenAI Realtime today.`,
      provider,
    });
    return;
  }

  console.log(`[Realtime] Creating session: plan=${plan}, provider=${provider}, skills=[${skillSummary(skills)}], venue=${venueId || "none"}`);

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
    res.json({
      id: data.session?.id ?? "",
      client_secret: { value: data.value, expires_at: data.expires_at },
      instructions: sessionConfig.instructions,
      assistantKind,
      voicelab: {
        noiseMode,
        bargeIn: acousticBargeIn,
        pushToTalk: behavior.pushToTalkRequired,
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
    agentProfileId,
  } = req.body ?? {};

  if (!tool_name) {
    res.status(400).json({ error: "tool_name is required" });
    return;
  }

  // venueId is optional: general-assistant tools (web/knowledge/email/db) don't
  // need a Square-connected venue. We still try to load credentials when one
  // is provided so venue-mode tools keep working.
  let squareToken = "";
  let squareLocationId = "";
  if (venueId) {
    const creds = await getCachedCredentials(req.user.id, Number(venueId));
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  // Use a stable fallback so multiple tool calls in one conversation share the same session
  const sessionId = String(session_id || `rt-${req.user.id}-${venueId ?? "general"}`);
  const session = getOrCreateSession(sessionId, squareToken, squareLocationId, req.user.id, Number(venueId ?? 0));

  let noiseMode: import("@workspace/voicelab-core/noise").NoiseMode = "standard";
  if (agentProfileId) {
    const [profile] = await db
      .select({ noiseMode: agentProfilesTable.noiseMode })
      .from(agentProfilesTable)
      .where(eq(agentProfilesTable.id, String(agentProfileId)))
      .limit(1);
    if (profile?.noiseMode) {
      noiseMode = profile.noiseMode as typeof noiseMode;
    }
  }

  try {
    const squareClient = squareToken ? new SquareClient(squareToken, squareLocationId) : undefined;
    const assistantKind: "venue" | "general" = squareToken ? "venue" : "general";
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
        venueId: Number(venueId),
        assistantKind,
        noiseMode,
        confirmed: confirmed === true,
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
  venueId: number;
  lastHeartbeatMs: number;
  startMs: number;
}

const heartbeatMap = new Map<string, HeartbeatEntry>();

router.post("/session/:id/heartbeat", requireAuth as any, async (req: any, res: any) => {
  const sessionId = req.params.id;
  const { elapsedMs } = req.body ?? {};

  const existing = heartbeatMap.get(sessionId);
  if (existing) {
    existing.lastHeartbeatMs = typeof elapsedMs === "number" ? elapsedMs : Date.now() - existing.startMs;
  } else {
    heartbeatMap.set(sessionId, {
      userId: req.user.id,
      venueId: Number(req.body?.venueId ?? 0),
      lastHeartbeatMs: typeof elapsedMs === "number" ? elapsedMs : 0,
      startMs: Date.now(),
    });
  }

  res.sendStatus(200);
});

router.post("/session/:id/end", requireAuth as any, async (req: any, res: any) => {
  const sessionId = req.params.id;
  const { durationMs } = req.body ?? {};
  const entry = heartbeatMap.get(sessionId);
  const venueId = entry?.venueId ?? Number(req.body?.venueId ?? 0);

  const effectiveDuration = typeof durationMs === "number" && durationMs > 0
    ? durationMs
    : entry?.lastHeartbeatMs ?? 0;

  if (effectiveDuration > 0) {
    try {
      await db.insert(usageEventsTable).values({
        kind: "voice_minutes",
        userId: req.user.id,
        venueId: venueId || null,
        quantity: Math.ceil(effectiveDuration / 60000),
        metadata: { durationMs: effectiveDuration, provider: "openai_realtime_webrtc" },
      });
    } catch {
      // non-critical — don't fail the response
    }
  }

  heartbeatMap.delete(sessionId);
  res.sendStatus(200);
});

export default router;