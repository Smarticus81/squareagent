/**
 * WebSocket Relay for Native (iOS/Android) Voice Agent
 *
 * Accepts WebSocket upgrades on /api/realtime path.
 * Authenticates via ?token=JWT&venueId=ID query params.
 * Opens a relay WebSocket to OpenAI Realtime API.
 * Handles tool calls server-side using the shared tool registry.
 */

import { IncomingMessage } from "http";
import { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { db, venuesTable, sessionsTable, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  cancelLiveOrder,
  type CatalogItem,
  type OrderItem,
  type LiveSession,
} from "../lib/square-helpers";
import { ALL_TOOLS, executeToolCall, toolCount } from "../tools";

const JWT_SECRET = process.env.JWT_SECRET ?? "bevpro-dev-secret-change-in-production";
const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function authenticateToken(token: string): Promise<{ userId: number; subscription: any } | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; sid: string };
    if (!payload?.sub || !payload?.sid) return null;

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, payload.sid));
    if (!session || session.expiresAt < new Date()) return null;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
    if (!user) return null;

    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    return { userId: user.id, subscription: subscription ?? null };
  } catch {
    return null;
  }
}

function checkPlan(subscription: any): string | null {
  if (!subscription) return "No active subscription";

  if (subscription.status === "trialing") {
    if (subscription.trialEndsAt && new Date(subscription.trialEndsAt) < new Date()) {
      return "Trial expired. Please subscribe to continue.";
    }
    return null;
  }

  if (subscription.status !== "active") return "Subscription inactive";

  return null;
}

async function lookupVenueCredentials(userId: number, venueId: number) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.userId, userId)));
  if (!venue) return null;
  return { squareToken: venue.squareAccessToken ?? "", squareLocationId: venue.squareLocationId ?? "" };
}

// ── System prompt (same as realtime.ts) ───────────────────────────────────────

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
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".
- Items appear on the Square POS in real-time — mention naturally: "got it, that's on the screen".
- If they want to pay by card, use send_to_terminal. Say "sent to the terminal, go ahead and tap".

Catalog Management:
- You can create, update, and delete menu items in Square.
- Always confirm before destructive actions.
- When updating prices, say the old and new price.

Inventory Rules:
- Always confirm quantities before making changes.
- Low stock alerts: proactively mention if an item drops below 5 units.
- Understand bulk language: "case of" = 24, "keg" = context-dependent.

Customers & Payments:
- Search/create/update customer profiles.
- List payments, issue refunds, cancel pending payments.
- Always confirm refund amounts before executing.

Team & Shifts:
- List team members, see who's clocked in, clock people in/out.

Reports:
- Sales reports: today, yesterday, this week, last 7 days, this month.
- Present numbers naturally: "you did forty-two orders, twelve hundred in revenue."
- Top sellers, hourly breakdowns, item performance, daily summaries available.

General:
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.
- Never guess on destructive actions — always confirm.
- You have full Square access — use it confidently.`;
}

// ── Attach WebSocket server to HTTP server ────────────────────────────────────

export function attachWebSocketRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Only handle /api/realtime WebSocket upgrades
    if (url.pathname !== "/api/realtime") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    const venueIdStr = url.searchParams.get("venueId");

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate
    const auth = await authenticateToken(token);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Check subscription plan
    const planError = checkPlan(auth.subscription);
    if (planError) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // Lookup venue credentials
    let squareToken = "";
    let squareLocationId = "";
    if (venueIdStr) {
      const creds = await lookupVenueCredentials(auth.userId, Number(venueIdStr));
      if (creds) {
        squareToken = creds.squareToken;
        squareLocationId = creds.squareLocationId;
      }
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, req, {
        userId: auth.userId,
        venueId: venueIdStr ? Number(venueIdStr) : null,
        squareToken,
        squareLocationId,
      });
    });
  });

  wss.on("connection", (clientWs: WebSocket, _req: IncomingMessage, ctx: {
    userId: number;
    venueId: number | null;
    squareToken: string;
    squareLocationId: string;
  }) => {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "OpenAI API key not configured" } }));
      clientWs.close();
      return;
    }

    // Session state
    let catalog: CatalogItem[] = [];
    let order: OrderItem[] = [];
    const session: LiveSession = { items: [] };
    let sessionSquareToken = ctx.squareToken;
    let sessionLocationId = ctx.squareLocationId;

    console.log(`[WS-Relay] Connected for user ${ctx.userId} with ${toolCount()} tools`);

    // Connect to OpenAI Realtime API
    const openaiUrl = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`;
    const openaiWs = new WebSocket(openaiUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    let openaiReady = false;
    let pendingFromClient: string[] = [];

    openaiWs.on("open", () => {
      console.log(`[WS-Relay] OpenAI connected for user ${ctx.userId}`);
      openaiReady = true;

      // Configure session
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          voice: "ash",
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
        },
      };
      openaiWs.send(JSON.stringify(sessionConfig));

      // Flush any messages that arrived before OpenAI was ready
      for (const msg of pendingFromClient) {
        openaiWs.send(msg);
      }
      pendingFromClient = [];
    });

    // Handle messages FROM OpenAI → relay to client (intercept tool calls)
    openaiWs.on("message", async (data) => {
      const raw = data.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { clientWs.send(raw); return; }

      // Intercept tool call completion → execute server-side
      if (event.type === "response.function_call_arguments.done") {
        const toolName = String(event.name ?? "");
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(event.arguments ?? "{}")); } catch {}
        const callId = String(event.call_id ?? "");

        console.log(`[WS-Relay] Tool call: ${toolName}(${JSON.stringify(args)})`);

        try {
          const { result, command } = await executeToolCall(
            toolName, args,
            { catalog, order, squareToken: sessionSquareToken, squareLocationId: sessionLocationId, session },
          );

          // Send tool output back to OpenAI
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: result,
            },
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));

          // Send order command to client
          if (command) {
            clientWs.send(JSON.stringify({ type: "x.order_command", command }));
          }
        } catch (e: any) {
          console.error(`[WS-Relay] Tool error:`, e.message);
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: `Error: ${e.message}`,
            },
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        }

        // Still forward the event to client for transcript/UI purposes
        clientWs.send(raw);
        return;
      }

      // Forward all other events to client
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(raw);
      }
    });

    openaiWs.on("error", (err) => {
      console.error("[WS-Relay] OpenAI WS error:", err.message);
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    });

    openaiWs.on("close", () => {
      console.log("[WS-Relay] OpenAI WS closed");
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    // Handle messages FROM client → relay to OpenAI (intercept context updates)
    clientWs.on("message", (data) => {
      const raw = data.toString();
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch {
        if (openaiReady) openaiWs.send(raw);
        else pendingFromClient.push(raw);
        return;
      }

      // Intercept custom context update — update local state, send session.update to OpenAI
      if (event.type === "x.context_update") {
        if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
        if (Array.isArray(event.order)) order = event.order as OrderItem[];
        if (event.squareToken) sessionSquareToken = String(event.squareToken);
        if (event.squareLocationId) sessionLocationId = String(event.squareLocationId);

        const voice = event.voice ? String(event.voice) : undefined;

        // Send updated instructions to OpenAI
        if (openaiReady) {
          openaiWs.send(JSON.stringify({
            type: "session.update",
            session: {
              instructions: buildInstructions(catalog, order),
              ...(voice ? { voice } : {}),
            },
          }));
        }
        return;
      }

      // Forward standard Realtime API messages to OpenAI
      if (openaiReady) {
        openaiWs.send(raw);
      } else {
        pendingFromClient.push(raw);
      }
    });

    clientWs.on("close", () => {
      console.log(`[WS-Relay] Client disconnected (user ${ctx.userId})`);
      if (session.squareOrderId) {
        cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
      }
      if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) {
        openaiWs.close();
      }
    });

    clientWs.on("error", (err) => {
      console.error("[WS-Relay] Client WS error:", err.message);
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });
  });

  console.log("[WS-Relay] WebSocket relay attached for /api/realtime");
}