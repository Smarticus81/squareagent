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

const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

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
- Speak like bar staff: short, punchy, no fluff. One or two sentences max.
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
- Always confirm quantities before making changes: "Adjusting Bud Light up 24, that right?"
- For bulk operations, summarize what you'll do before executing.
- Low stock alerts: proactively mention if an item drops below 5 units after an adjustment.
- Say numbers clearly: "twenty-four" not "24".
- Understand bulk language: "case of" = 24, "keg" = context-dependent.

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
- You have full Square access — use it confidently.`;
}

// ── POST /session — Mint ephemeral OpenAI token ───────────────────────────────

router.post("/session", requireAuth as any, requirePlan() as any, async (req: any, res: any) => {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const { voice = "ash", speed = 0.9, catalog = [], order = [], venueId } = req.body ?? {};

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
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_REALTIME_MODEL,
        modalities: ["text", "audio"],
        voice,
        instructions: buildInstructions(catalog, order),
        tools: ALL_TOOLS,
        tool_choice: "auto",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.35,
          prefix_padding_ms: 200,
          silence_duration_ms: 400,
          create_response: true,
        },
        temperature: 0.6,
        speed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Realtime] Ephemeral token failed:", errText);
      res.status(response.status).json({ error: "Failed to create session" });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (e: any) {
    console.error("[Realtime] Session error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /tools — Execute a tool call ─────────────────────────────────────────

const sessionOrders = new Map<string, LiveSession>();

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

  // Server-side credential lookup
  let squareToken = "";
  let squareLocationId = "";
  if (venueId) {
    const creds = await lookupVenueCredentials(req.user.id, Number(venueId));
    if (creds) {
      squareToken = creds.squareToken;
      squareLocationId = creds.squareLocationId;
    }
  }

  const sessionId = String(session_id || "default");
  if (!sessionOrders.has(sessionId)) {
    sessionOrders.set(sessionId, { items: [] });
  }
  const session = sessionOrders.get(sessionId)!;

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
    res.json({ ok: false, error: "Venue not found or not owned by user" });
    return;
  }
  if (!creds.squareToken) {
    res.json({ ok: false, error: "No Square access token — reconnect Square OAuth" });
    return;
  }
  if (!creds.squareLocationId) {
    res.json({ ok: false, error: "No Square location ID — complete setup" });
    return;
  }

  const testSession: LiveSession = {
    items: [{
      catalogItemId: "test",
      name: "Sync Test",
      price: 0.01,
      quantity: 1,
    }],
  };

  const sync = await syncLiveOrderToSquare(testSession, creds.squareToken, creds.squareLocationId);
  if (!sync.ok) {
    res.json({ ok: false, error: sync.error, step: "create_order" });
    return;
  }

  await cancelLiveOrder(testSession, creds.squareToken, creds.squareLocationId);

  res.json({
    ok: true,
    message: "Square order sync is working. Test order created and canceled.",
    testOrderId: sync.squareOrderId,
  });
});

export default router;