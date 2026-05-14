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
import { db, agentProfilesTable, serviceConnectionsTable } from "@workspace/db";
import {
  PLANS,
  listConnectedServiceProviders,
  listVoicePipelineProviders,
} from "@workspace/voicelab-core";
import { eq } from "drizzle-orm";
import {
  syncLiveOrderToSquare,
  cancelLiveOrder,
  type CatalogItem,
  type OrderItem,
  type LiveSession,
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
- Room modes include quiet room, restaurant, bar, nightclub, event space, and push-to-talk only. Noisy rooms can use more controlled listening or push-to-talk.
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
- Starter focuses on OpenAI Realtime voice. Professional adds Gemini-class native voice. Premium opens every voice engine and enterprise-grade options.
- Customers can change an assistant's voice engine later from assistant settings.

Pricing and trial:
${planSummary}
- Yearly billing saves about 17%.
- The trial is 14 days, no card required, with 200 voice minutes and every feature unlocked for testing.
- Billing is platform fee plus spoken voice minutes. Idle screens and dashboard work cost nothing.
- Overage is a soft cap, not a hard stop. Assistants keep working; the overage rate drops on higher tiers.
- Enterprise is for SSO, SCIM, IP allowlists, custom audit logs, dedicated relay regions, SLA, named customer success, on-prem, or VPC-isolated deployments.

Who should use each plan:
- Starter: a single bar or small venue that wants simple POS, orders, and reporting.
- Professional: multi-venue operators that need inventory, catalog, customers, payments, and Gemini-class voice.
- Premium: hospitality groups and event venues that need unlimited venues/assistants, team and labor commands, every voice engine, and dedicated support.
- Enterprise: organizations with custom security, audit, deployment, or compliance needs.

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
        transcription: { model: "whisper-1" },
        // semantic_vad uses a model to detect natural turn ends rather than
        // a fixed silence timer. eagerness="low" waits longer before
        // committing the turn so users can pause mid-sentence without being
        // cut off (the previous server_vad with 180ms silence was clipping
        // every breath). See OpenAI Realtime prompting guide.
        turn_detection: {
          type: "semantic_vad" as const,
          eagerness: "low" as const,
          create_response: true,
          interrupt_response: true,
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

function buildRealtimeSessionConfig(voice: string, speed: number, catalog: CatalogItem[], order: OrderItem[], plan?: string, assistantKind: "venue" | "general" = "venue") {
  const skills = getSkillsForSession(plan ?? "trial", { kind: assistantKind });
  const tools = buildToolsFromSkills(skills);
  const instructions = buildInstructionsFromSkills(skills, catalog, order, assistantKind);

  return {
    type: "realtime" as const,
    model: OPENAI_REALTIME_MODEL,
    instructions,
    tools,
    tool_choice: "auto" as const,
    output_modalities: ["audio" as const],
    // Realtime prompting guide: "low" effort is the recommended starting point
    // for production voice agents — keeps barge-in snappy while adding reasoning
    // to tool dispatch and multi-step requests.
    reasoning: { effort: OPENAI_REALTIME_REASONING_EFFORT },
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        transcription: { model: "whisper-1" },
        // semantic_vad with low eagerness lets the user finish a thought
        // before the model takes a turn. The previous server_vad with a
        // 300ms silence window was cutting users off mid-sentence whenever
        // they paused to think, which felt like the agent was "cutting off
        // every 3 seconds." See OpenAI Realtime prompting guide.
        turn_detection: {
          type: "semantic_vad" as const,
          eagerness: "low" as const,
          create_response: true,
          interrupt_response: true,
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

// ── POST /demo-session — Public VoyceLab FAQ voice demo (no auth, rate-limited) ─

router.post("/demo-session", async (req: any, res: any) => {
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

  const { voice = "coral", speed = 1.05 } = req.body ?? {};
  const voiceStr = typeof voice === "string" ? voice : "coral";
  const speedNum =
    typeof speed === "number" && Number.isFinite(speed) && speed >= 0.75 && speed <= 1.35 ? speed : 1.05;

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
      body: JSON.stringify({
        session: buildDemoRealtimeSessionConfig(voiceStr, speedNum),
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Realtime] Demo ephemeral token failed:", errText);
      res.status(response.status).json({ error: "demo_session_failed", detail: errText });
      return;
    }

    const data = (await response.json()) as any;
    demoRateLimitOk(ip);
    res.json({
      id: data.session?.id ?? "",
      client_secret: { value: data.value, expires_at: data.expires_at },
    });
  } catch (e: any) {
    console.error("[Realtime] Demo session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
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

  const plan = req.subscription?.plan ?? "trial";
  let provider = "openai_realtime_webrtc";
  let providerConfig: Record<string, unknown> = {};
  let assistantKind: "venue" | "general" = "venue";

  if (agentProfileId) {
    const [profile] = await db
      .select({
        voicePipelineProvider: agentProfilesTable.voicePipelineProvider,
        voicePipelineConfig: agentProfilesTable.voicePipelineConfig,
        connectedServiceId: agentProfilesTable.connectedServiceId,
      })
      .from(agentProfilesTable)
      .where(eq(agentProfilesTable.id, String(agentProfileId)))
      .limit(1);
    if (profile) {
      provider = profile.voicePipelineProvider;
      providerConfig = (profile.voicePipelineConfig as Record<string, unknown>) ?? {};
      // Infer assistant kind from the connected service: any non-Square provider
      // (generic_rest, webhook, mock, etc.) gets the general business persona.
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

  const skills = getSkillsForSession(plan, { kind: assistantKind });

  if (provider !== "openai_realtime_webrtc") {
    res.status(409).json({
      error: "pipeline_requires_relay",
      detail: `${provider} is saved on this assistant. Open it in the Expo/web relay client path; this browser WebRTC surface only supports OpenAI Realtime today.`,
      provider,
    });
    return;
  }

  console.log(`[Realtime] Creating session: plan=${plan}, provider=${provider}, skills=[${skillSummary(skills)}], venue=${venueId || "none"}`);

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
      body: JSON.stringify({
        session: buildRealtimeSessionConfig(
          String(providerConfig.voice ?? voice),
          Number(providerConfig.speed ?? speed),
          catalog,
          order,
          plan,
          assistantKind,
        ),
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Realtime] Ephemeral token failed:", errText);
      res.status(response.status).json({ error: "Failed to create session", detail: errText });
      return;
    }

    const data = (await response.json()) as any;
    // Normalize GA response → shape the PWA client expects: { id, client_secret: { value } }
    res.json({
      id: data.session?.id ?? "",
      client_secret: { value: data.value, expires_at: data.expires_at },
    });
  } catch (e: any) {
    console.error("[Realtime] Session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/call", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const { sdp, voice = "ash", speed = 1.0, catalog = [], order = [], venueId } = req.body ?? {};
  if (!sdp || typeof sdp !== "string") {
    res.status(400).json({ error: "sdp is required" });
    return;
  }

  if (venueId) {
    await getCachedCredentials(req.user.id, Number(venueId));
  }

  try {
    const callPlan = req.subscription?.plan ?? "trial";
    const formData = new FormData();
    formData.set("sdp", sdp);
    formData.set("session", JSON.stringify(buildRealtimeSessionConfig(voice, speed, catalog, order, callPlan)));

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const text = await response.text();
    if (!response.ok) {
      console.error("[Realtime] Unified call failed:", text);
      res.status(response.status).json({ error: "Failed to establish realtime call", detail: text });
      return;
    }

    res.type("application/sdp").send(text);
  } catch (e: any) {
    console.error("[Realtime] Unified call error:", e.message);
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

// ── POST /test-sync — Diagnostic: test Square order creation ──────────────────

router.post("/test-sync", requireAuth as any, async (req: any, res: any) => {
  const { venueId } = req.body ?? {};
  if (!venueId) {
    res.status(400).json({ error: "venueId is required" });
    return;
  }

  const creds = await getCachedCredentials(req.user.id, Number(venueId));
  if (!creds) {
    res.json({ ok: false, error: "Venue not found or not owned by user", step: "lookup" });
    return;
  }
  if (!creds.squareToken) {
    res.json({ ok: false, error: "No Square access token — reconnect Square OAuth", step: "token" });
    return;
  }
  if (!creds.squareLocationId) {
    res.json({ ok: false, error: "No Square location ID — complete setup", step: "location" });
    return;
  }

  // Step 1: Verify the token works by fetching the location
  let locationName = "unknown";
  try {
    const locRes = await fetch(`https://connect.squareup.com/v2/locations/${creds.squareLocationId}`, {
      headers: {
        Authorization: `Bearer ${creds.squareToken}`,
        "Content-Type": "application/json",
        "Square-Version": "2024-12-18",
      },
    });
    const locData = (await locRes.json()) as any;
    if (!locRes.ok) {
      res.json({
        ok: false,
        error: `Square token invalid or expired: ${locData.errors?.[0]?.detail || locRes.status}`,
        step: "verify_token",
        hint: "Reconnect Square from the Dashboard",
      });
      return;
    }
    locationName = locData.location?.name || "unknown";
  } catch (e: any) {
    res.json({ ok: false, error: `Cannot reach Square API: ${e.message}`, step: "verify_token" });
    return;
  }

  // Step 2: Create a test order
  const testSession: LiveSession = {
    items: [{
      catalogItemId: "test",
      name: "VoyceLab Sync Test",
      price: 0.01,
      quantity: 1,
    }],
  };

  const sync = await syncLiveOrderToSquare(testSession, creds.squareToken, creds.squareLocationId);
  if (!sync.ok) {
    res.json({
      ok: false,
      error: sync.error,
      step: "create_order",
      location: locationName,
      locationId: creds.squareLocationId,
    });
    return;
  }

  // Step 3: Fetch the order back to confirm its state
  let orderState = "unknown";
  let orderDetails: any = null;
  try {
    const orderRes = await fetch(`https://connect.squareup.com/v2/orders/${testSession.squareOrderId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.squareToken}`,
        "Content-Type": "application/json",
        "Square-Version": "2024-12-18",
      },
      body: JSON.stringify({ order_ids: [testSession.squareOrderId] }),
    });
    // Batch retrieve uses POST /v2/orders/batch-retrieve
    const batchRes = await fetch(`https://connect.squareup.com/v2/orders/batch-retrieve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.squareToken}`,
        "Content-Type": "application/json",
        "Square-Version": "2024-12-18",
      },
      body: JSON.stringify({ location_id: creds.squareLocationId, order_ids: [testSession.squareOrderId] }),
    });
    const batchData = (await batchRes.json()) as any;
    const order = batchData.orders?.[0];
    if (order) {
      orderState = order.state;
      orderDetails = {
        id: order.id,
        state: order.state,
        source: order.source?.name,
        ticketName: order.ticket_name,
        lineItems: (order.line_items || []).length,
        fulfillments: (order.fulfillments || []).map((f: any) => ({
          type: f.type,
          state: f.state,
        })),
        total: order.total_money?.amount ? `$${(order.total_money.amount / 100).toFixed(2)}` : "$0.00",
        createdAt: order.created_at,
      };
    }
  } catch (e: any) {
    console.warn("[TestSync] Could not fetch order back:", e.message);
  }

  // Step 4: Cancel the test order
  await cancelLiveOrder(testSession, creds.squareToken, creds.squareLocationId);

  res.json({
    ok: true,
    message: `Order created and visible at "${locationName}". If you don't see it on the iPad, check: 1) Open Tickets is enabled in Square POS settings, 2) iPad is signed into "${locationName}", 3) Check the Orders tab (not just the register screen).`,
    location: locationName,
    locationId: creds.squareLocationId,
    testOrderId: sync.squareOrderId,
    orderState,
    orderDetails,
    posChecklist: [
      "Open Square POS on iPad → tap ☰ → Orders — the test order should have appeared there briefly",
      "Settings → Checkout → enable 'Open Tickets' if not already on",
      "Make sure your iPad POS is signed into the same location: " + locationName,
      "Pull down to refresh the orders list after creating a voice order",
    ],
  });
});

export default router;