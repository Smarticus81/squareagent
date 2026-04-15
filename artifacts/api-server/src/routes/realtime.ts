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

const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
// GA realtime mini model for low-latency voice. Use gpt-realtime-1.5 for more capability.

function buildRealtimeSessionConfig(voice: string, speed: number, catalog: CatalogItem[], order: OrderItem[], plan?: string) {
  const skills = getSkillsForSession(plan ?? "trial");
  const tools = buildToolsFromSkills(skills);
  const instructions = buildInstructionsFromSkills(skills, catalog, order);

  return {
    type: "realtime" as const,
    model: OPENAI_REALTIME_MODEL,
    instructions,
    tools,
    tool_choice: "auto" as const,
    output_modalities: ["audio" as const],
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad" as const,
          threshold: 0.5,
          prefix_padding_ms: 150,
          silence_duration_ms: 300,
          create_response: true,
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

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const { voice = "ash", speed = 1.0, catalog = [], order = [], venueId } = req.body ?? {};

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
  const skills = getSkillsForSession(plan);
  console.log(`[Realtime] Creating session: plan=${plan}, skills=[${skillSummary(skills)}], venue=${venueId || "none"}`);

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
        session: buildRealtimeSessionConfig(voice, speed, catalog, order, plan),
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

  if (!venueId) {
    res.status(400).json({ error: "venueId is required" });
    return;
  }

  // Server-side credential lookup
  let squareToken = "";
  let squareLocationId = "";
  const creds = await getCachedCredentials(req.user.id, Number(venueId));
  if (creds) {
    squareToken = creds.squareToken;
    squareLocationId = creds.squareLocationId;
  }

  // Use a stable fallback so multiple tool calls in one conversation share the same session
  const sessionId = String(session_id || `rt-${req.user.id}-${venueId}`);
  const session = getOrCreateSession(sessionId, squareToken, squareLocationId, req.user.id, Number(venueId));

  try {
    const squareClient = squareToken ? new SquareClient(squareToken, squareLocationId) : undefined;
    const { result, command } = await executeToolCall(
      tool_name,
      args,
      { catalog, order, squareToken, squareLocationId, session, squareClient, requestId: sessionId },
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