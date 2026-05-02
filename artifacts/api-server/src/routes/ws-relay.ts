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
import {
  buildGeminiLiveSetupMessage,
  buildGeminiLiveUrl,
} from "../voice-pipelines/google/gemini-live";

const JWT_SECRET = process.env.JWT_SECRET ?? "voycelab-dev-secret-change-in-production";
const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";

type RelayKind = "openai" | "gemini";

interface RelayCtx {
  userId: number;
  venueId: number | null;
  squareToken: string;
  squareLocationId: string;
  kind: RelayKind;
  geminiModelId: string | null;
}

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

  return `You are VoyceLab, the voice operating assistant for modern venues running on Square. You have FULL access to the Square platform — ordering, inventory, catalog management, customer profiles, payments, team management, reporting, and more.

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

    // Route by path: OpenAI relay on /api/realtime, Gemini relay on /api/realtime/gemini
    let kind: RelayKind;
    if (url.pathname === "/api/realtime") kind = "openai";
    else if (url.pathname === "/api/realtime/gemini") kind = "gemini";
    else {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    const venueIdStr = url.searchParams.get("venueId");
    const geminiModelId = url.searchParams.get("modelId");

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
      const ctx: RelayCtx = {
        userId: auth.userId,
        venueId: venueIdStr ? Number(venueIdStr) : null,
        squareToken,
        squareLocationId,
        kind,
        geminiModelId,
      };
      wss.emit("connection", clientWs, req, ctx);
    });
  });

  wss.on("connection", (clientWs: WebSocket, _req: IncomingMessage, ctx: RelayCtx) => {
    if (ctx.kind === "gemini") {
      handleGeminiRelay(clientWs, ctx);
      return;
    }
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

  console.log("[WS-Relay] WebSocket relay attached for /api/realtime and /api/realtime/gemini");
}

// ── Gemini Live relay (BidiGenerateContent over WebSocket) ────────────────────

function handleGeminiRelay(clientWs: WebSocket, ctx: RelayCtx): void {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: "error", error: { message: "GOOGLE_GEMINI_API_KEY not configured" } }));
    clientWs.close();
    return;
  }

  const modelId = ctx.geminiModelId ?? "gemini-live-2.5-flash-native-audio";
  const capabilityProfile: "preview_3_1" | "ga_2_5" =
    modelId.includes("3.1-flash-live") ? "preview_3_1" : "ga_2_5";

  let catalog: CatalogItem[] = [];
  let order: OrderItem[] = [];
  const session: LiveSession = { items: [] };
  let sessionSquareToken = ctx.squareToken;
  let sessionLocationId = ctx.squareLocationId;
  let inputLanguageCodes: string[] | undefined;
  let proactiveAudio = capabilityProfile === "ga_2_5";
  let thinkingLevel: "minimal" | "low" | "medium" | "high" = "minimal";
  let voiceName: string | undefined;

  console.log(`[WS-Relay/Gemini] Connected for user ${ctx.userId} model=${modelId}`);

  const upstreamUrl = (() => {
    try {
      return buildGeminiLiveUrl();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "url build failed";
      clientWs.send(JSON.stringify({ type: "error", error: { message: msg } }));
      clientWs.close();
      return null;
    }
  })();
  if (!upstreamUrl) return;

  const upstream = new WebSocket(upstreamUrl);
  let upstreamReady = false;
  let setupSent = false;
  let pendingFromClient: string[] = [];

  function sendSetup(): void {
    const setup = buildGeminiLiveSetupMessage({
      modelId,
      instructions: buildInstructions(catalog, order),
      tools: ALL_TOOLS,
      capabilityProfile,
      inputLanguageCodes,
      proactiveAudio,
      thinkingLevel,
      voiceName,
    });
    upstream.send(JSON.stringify(setup));
    setupSent = true;
  }

  upstream.on("open", () => {
    console.log(`[WS-Relay/Gemini] Upstream connected user=${ctx.userId}`);
    upstreamReady = true;
    sendSetup();
  });

  upstream.on("message", async (data, isBinary) => {
    const raw = isBinary ? data.toString() : data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    // Setup ack — flush any queued client messages.
    if (event.setupComplete !== undefined) {
      console.log(`[WS-Relay/Gemini] Setup complete for user=${ctx.userId}, ${toolCount()} tools registered`);
      for (const msg of pendingFromClient) upstream.send(msg);
      pendingFromClient = [];
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    // Tool calls — execute server-side, post results back.
    const toolCall = event.toolCall as
      | { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
      | undefined;
    if (toolCall && Array.isArray(toolCall.functionCalls)) {
      const responses: Array<{ id: string; name: string; response: { result?: string; error?: string } }> = [];
      for (const fc of toolCall.functionCalls) {
        const name = String(fc.name ?? "");
        const id = String(fc.id ?? "");
        const args = (fc.args ?? {}) as Record<string, unknown>;
        console.log(`[WS-Relay/Gemini] Tool call: ${name}(${JSON.stringify(args)})`);
        try {
          const { result, command } = await executeToolCall(
            name,
            args,
            { catalog, order, squareToken: sessionSquareToken, squareLocationId: sessionLocationId, session },
          );
          responses.push({ id, name, response: { result } });
          if (command && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "x.order_command", command }));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "tool call failed";
          console.error(`[WS-Relay/Gemini] Tool error: ${msg}`);
          responses.push({ id, name, response: { error: msg } });
        }
      }
      upstream.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      // Forward to client too so the UI can show the tool call event.
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    // Forward all other messages (serverContent / transcripts / goAway / etc.)
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
  });

  upstream.on("error", (err) => {
    console.error(`[WS-Relay/Gemini] Upstream error: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    }
  });

  upstream.on("close", () => {
    console.log(`[WS-Relay/Gemini] Upstream closed user=${ctx.userId}`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on("message", (data) => {
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (upstreamReady && setupSent) upstream.send(raw);
      else pendingFromClient.push(raw);
      return;
    }

    // Custom context update from the PWA — refresh local state and re-send setup.
    if (event.type === "x.context_update") {
      if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
      if (Array.isArray(event.order)) order = event.order as OrderItem[];
      if (event.squareToken) sessionSquareToken = String(event.squareToken);
      if (event.squareLocationId) sessionLocationId = String(event.squareLocationId);
      if (Array.isArray(event.languageCodes)) inputLanguageCodes = event.languageCodes as string[];
      if (typeof event.proactiveAudio === "boolean") proactiveAudio = event.proactiveAudio;
      if (
        typeof event.thinkingLevel === "string" &&
        ["minimal", "low", "medium", "high"].includes(event.thinkingLevel)
      ) {
        thinkingLevel = event.thinkingLevel as typeof thinkingLevel;
      }
      if (typeof event.voice === "string") voiceName = event.voice;

      // Gemini Live's `setup` is only valid as the first message. To apply
      // updated instructions mid-session we send a clientContent turn that
      // re-injects the system prompt as a high-priority user note. This is
      // honest with the API: we don't pretend to mutate the original setup.
      if (upstreamReady && setupSent) {
        upstream.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `[Updated context]\n${buildInstructions(catalog, order)}`,
                    },
                  ],
                },
              ],
              turnComplete: false,
            },
          }),
        );
      }
      return;
    }

    if (upstreamReady && setupSent) upstream.send(raw);
    else pendingFromClient.push(raw);
  });

  clientWs.on("close", () => {
    console.log(`[WS-Relay/Gemini] Client disconnected user=${ctx.userId}`);
    if (session.squareOrderId) {
      cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error(`[WS-Relay/Gemini] Client WS error: ${err.message}`);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}