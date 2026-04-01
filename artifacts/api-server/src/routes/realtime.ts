/**
 * Unified BevPro Agent — REST endpoints for WebRTC-based Realtime API
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
import { db, venuesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requirePlan } from "./auth";
import {
  syncLiveOrderToSquare,
  cancelLiveOrder,
  type CatalogItem,
  type OrderItem,
  type LiveSession,
} from "../lib/square-helpers";
import { ALL_TOOLS, executeToolCall, toolCount } from "../tools";

const router = Router();

/** Look up Square credentials from DB for the authenticated user's venue. */
async function lookupVenueCredentials(userId: number, venueId: number) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, userId)));
  if (!venue) return null;
  return { squareToken: venue.squareAccessToken ?? "", squareLocationId: venue.squareLocationId ?? "" };
}

const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
// GA realtime mini model for low-latency voice. Use gpt-realtime-1.5 for more capability.

function buildRealtimeSessionConfig(voice: string, speed: number, catalog: CatalogItem[], order: OrderItem[]) {
  return {
    type: "realtime" as const,
    model: OPENAI_REALTIME_MODEL,
    instructions: buildInstructions(catalog, order),
    tools: ALL_TOOLS,
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

// ── System prompt ─────────────────────────────────────────────────────────────

function buildInstructions(catalog: CatalogItem[], order: OrderItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
      : "  (No catalog loaded — ask user to connect Square)";

  const orderStr =
    order.length > 0
      ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
      : "  (empty)";

  return `You are BevPro, a comprehensive voice assistant for bars and venues running on Square. You have FULL access to the Square platform — ordering, inventory, catalog management, customer profiles, payments, team management, reporting, and more.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona:
- Sharp, knowledgeable, confident. You're the venue's operations brain.
- Speak like bar staff: short, punchy, no fluff. Default to one short sentence; use two only if needed.
- Keep confirmations tight. Prefer 4 to 10 words when possible.
- Understand bartender slang: "86 it" = remove/out of stock, "ring it up" / "close it out" = submit, "tab it" = add to order, "what's on the ticket" = get order.
- Understand inventory terms: "we got a case of" = add 24, "count" = check levels.

POS Rules:
- Add items only on clear intent ("two Fosters", "tab a Bud Light").
- Never submit until they say so ("ring it up", "close it out", "that's it"). Confirm the total first.
- If browsing or chatting, just talk — don't push items.
- Menu questions: mention a few options, don't dump the whole list.
- If something's not on the menu, suggest what's close.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".
- Items appear on the Square POS in real-time as they're added — mention this naturally: "got it, that's on the screen" or "added, check the register".
- If they want to pay by card, use send_to_terminal. Say "sent to the terminal, go ahead and tap".

Catalog Management:
- You can create, update, and delete menu items in Square.
- Always confirm before destructive actions: "I'll remove Stale Lager from the catalog, that right?"
- When creating items, confirm name and price before executing.
- When updating prices, say the old and new price: "Moving IPA from eight to nine fifty."

Inventory Rules:
- You are an expert inventory manager. You can check stock, adjust quantities, set counts, transfer between locations, view change history, generate low stock reports, and do batch adjustments.
- Always confirm quantities before making changes: "Adjusting Bud Light up twenty-four, that right?"
- For bulk operations (deliveries, shipments), use batch_adjust_inventory — summarize what you'll do, get confirmation, then execute in one call.
- Low stock alerts: proactively mention if an item drops below 5 units after any adjustment.
- Say numbers clearly: "twenty-four" not "24".
- Understand bulk language: "case of" = 24, "half case" = 12, "six-pack" = 6, "keg" = context-dependent.
- Use the right reason when adjusting: "received" for deliveries, "sold" for sales, "waste" for spoilage/expired, "damaged" for breakage, "theft" for missing stock.
- When asked for a stock check, use check_inventory for one item or check_all_inventory for everything.
- When asked "how's inventory looking" or "give me a rundown", use inventory_summary for the overview.
- For receiving a delivery with multiple items, use batch_adjust_inventory to do it all at once.
- For physical stock counts, use set_inventory to override to the actual count.
- For transfers, ask which location they're sending to before executing.
- When asked about history or what happened with an item, use get_inventory_changes.
- "86 it" in inventory context means it's out of stock — check the count and confirm.
- After any adjustment, always state the new count: "Got it, Bud Light now at forty-eight."

Customers & Payments:
- You can search/create/update customer profiles.
- You can list payments, issue refunds, and cancel pending payments.
- Always confirm refund amounts before executing.

Team & Shifts:
- You can list team members, see who's clocked in, clock people in/out.
- Present shift info naturally: "Jake's been on since two."

Reports:
- Sales reports: today, yesterday, this week, last 7 days, this month.
- Present numbers naturally: "you did forty-two orders, twelve hundred in revenue."
- Top sellers, hourly breakdowns, item performance, daily summaries available.
- Lead with the headline: "Good shift — 47 orders, eighteen hundred revenue."

General:
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.
- Never guess on destructive actions (delete, refund, etc.) — always confirm.
- Do not over-explain. Answer, confirm, or ask the next needed question.
- You have full Square access — use it confidently.`;
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
    const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  console.log(`[Realtime] Creating session with ${toolCount()} tools`);

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
        session: buildRealtimeSessionConfig(voice, speed, catalog, order),
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
    await lookupVenueCredentials(req.user.id, Number(venueId));
  }

  try {
    const formData = new FormData();
    formData.set("sdp", sdp);
    formData.set("session", JSON.stringify(buildRealtimeSessionConfig(voice, speed, catalog, order)));

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

// Session state with TTL — auto-cleanup abandoned sessions after 30 minutes
interface TimedSession {
  session: LiveSession;
  squareToken: string;
  squareLocationId: string;
  lastAccess: number;
}
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessionOrders = new Map<string, TimedSession>();

// Garbage-collect stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of sessionOrders) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      // Cancel any orphaned live order in Square before removing
      if (entry.session.squareOrderId && entry.squareToken && entry.squareLocationId) {
        console.log(`[Sessions] Canceling orphaned order ${entry.session.squareOrderId} for session ${key}`);
        cancelLiveOrder(entry.session, entry.squareToken, entry.squareLocationId).catch(() => {});
      }
      sessionOrders.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Sessions] Cleaned ${cleaned} stale session(s). Active: ${sessionOrders.size}`);
}, 5 * 60 * 1000);

function getOrCreateSession(sessionId: string, squareToken: string, squareLocationId: string): LiveSession {
  const existing = sessionOrders.get(sessionId);
  if (existing) {
    existing.lastAccess = Date.now();
    existing.squareToken = squareToken;
    existing.squareLocationId = squareLocationId;
    return existing.session;
  }
  const session: LiveSession = { items: [] };
  sessionOrders.set(sessionId, { session, squareToken, squareLocationId, lastAccess: Date.now() });
  return session;
}

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
  const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
  if (creds) {
    squareToken = creds.squareToken;
    squareLocationId = creds.squareLocationId;
  }

  // Use a stable fallback so multiple tool calls in one conversation share the same session
  const sessionId = String(session_id || `rt-${req.user.id}-${venueId}`);
  const session = getOrCreateSession(sessionId, squareToken, squareLocationId);

  try {
    const { result, command } = await executeToolCall(
      tool_name,
      args,
      { catalog, order, squareToken, squareLocationId, session },
    );

    if (session.items.length === 0 && !session.squareOrderId) {
      sessionOrders.delete(sessionId);
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

  const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
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
      name: "BevPro Sync Test",
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