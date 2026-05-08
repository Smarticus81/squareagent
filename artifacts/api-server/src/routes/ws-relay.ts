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
import {
  buildHumeWsUrl,
  buildHumeSessionSettings,
} from "../voice-pipelines/hume/evi-3";
import {
  buildDeepgramAgentWsUrl,
  buildDeepgramAgentSettings,
  deepgramAgentAuthHeaders,
} from "../voice-pipelines/deepgram/voice-agent-api";
import {
  handleModularRelay,
} from "../voice-pipelines/modular/relay";

const JWT_SECRET = process.env.JWT_SECRET ?? "voycelab-dev-secret-change-in-production";
const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";

type RelayKind = "openai" | "gemini" | "hume" | "deepgram-agent" | "modular";

interface RelayCtx {
  userId: number;
  venueId: number | null;
  squareToken: string;
  squareLocationId: string;
  kind: RelayKind;
  geminiModelId: string | null;
  /** Modular query params (sttVendor, llmVendor, ttsVendor, llmModel, agentProfileId, ...) */
  query: Record<string, string>;
}

function resamplePcm16Base64(base64Pcm: string, fromRate: number, toRate: number): string {
  if (fromRate === toRate) return base64Pcm;
  const input = Buffer.from(base64Pcm, "base64");
  const sampleCount = Math.floor(input.length / 2);
  if (sampleCount === 0) return base64Pcm;

  const outputCount = Math.max(1, Math.floor(sampleCount * toRate / fromRate));
  const output = Buffer.alloc(outputCount * 2);
  for (let outIndex = 0; outIndex < outputCount; outIndex++) {
    const sourceIndex = outIndex * (fromRate / toRate);
    const leftIndex = Math.min(sampleCount - 1, Math.floor(sourceIndex));
    const rightIndex = Math.min(sampleCount - 1, leftIndex + 1);
    const weight = sourceIndex - leftIndex;
    const left = input.readInt16LE(leftIndex * 2);
    const right = input.readInt16LE(rightIndex * 2);
    const sample = Math.round(left + (right - left) * weight);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), outIndex * 2);
  }
  return output.toString("base64");
}

function geminiClientMessageFromRealtimeEvent(event: Record<string, unknown>): string | null {
  if (event.type === "input_audio_buffer.append" && typeof event.audio === "string") {
    return JSON.stringify({
      realtimeInput: {
        audio: {
          data: resamplePcm16Base64(event.audio, 24000, 16000),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
  }

  if (event.type === "response.cancel") {
    return null;
  }

  if (event.realtimeInput || event.clientContent || event.toolResponse) {
    return JSON.stringify(event);
  }

  return null;
}

function geminiServerMessagesForRealtimeClient(
  event: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  if (event.setupComplete !== undefined) {
    messages.push({ type: "session.created", session: { id: sessionId } });
  }

  const serverContent = event.serverContent as Record<string, unknown> | undefined;
  if (serverContent) {
    const inputTranscription = serverContent.inputTranscription as Record<string, unknown> | undefined;
    if (typeof inputTranscription?.text === "string" && inputTranscription.text.trim()) {
      messages.push({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: inputTranscription.text,
      });
    }

    const outputTranscription = serverContent.outputTranscription as Record<string, unknown> | undefined;
    if (typeof outputTranscription?.text === "string" && outputTranscription.text.trim()) {
      messages.push({ type: "response.audio_transcript.done", transcript: outputTranscription.text });
    }

    const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
    const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inlineData = (part as Record<string, unknown>).inlineData as Record<string, unknown> | undefined;
      if (typeof inlineData?.data === "string") {
        messages.push({ type: "response.audio.delta", delta: inlineData.data });
      }
    }

    if (serverContent.interrupted) {
      messages.push({ type: "input_audio_buffer.speech_started" });
    }
    if (serverContent.generationComplete || serverContent.turnComplete) {
      messages.push({ type: "response.done" });
    }
  }

  if (event.goAway) {
    messages.push({ type: "error", error: { message: "Gemini Live session is closing" } });
  }

  return messages;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "tmusoni@thinkertons.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

async function authenticateToken(
  token: string,
): Promise<{ userId: number; subscription: any; isAdmin: boolean } | null> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; sid: string };
    if (!payload?.sub || !payload?.sid) return null;

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, payload.sid));
    if (!session || session.expiresAt < new Date()) return null;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub));
    if (!user) return null;

    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    return {
      userId: user.id,
      subscription: subscription ?? null,
      isAdmin: isAdminEmail(user.email),
    };
  } catch {
    return null;
  }
}

function checkPlan(subscription: any, isAdmin: boolean): string | null {
  if (isAdmin) return null;
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

    // Route by path. Each pipeline that needs a server-side relay gets
    // its own subpath; the upstream protocol is provider-specific so we
    // dispatch to a dedicated handler.
    let kind: RelayKind;
    switch (url.pathname) {
      case "/api/realtime": kind = "openai"; break;
      case "/api/realtime/gemini": kind = "gemini"; break;
      case "/api/realtime/hume": kind = "hume"; break;
      case "/api/realtime/deepgram-agent": kind = "deepgram-agent"; break;
      case "/api/realtime/modular": kind = "modular"; break;
      default:
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

    // Check subscription plan (admins bypass)
    const planError = checkPlan(auth.subscription, auth.isAdmin);
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

    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const ctx: RelayCtx = {
        userId: auth.userId,
        venueId: venueIdStr ? Number(venueIdStr) : null,
        squareToken,
        squareLocationId,
        kind,
        geminiModelId,
        query: queryParams,
      };
      wss.emit("connection", clientWs, req, ctx);
    });
  });

  wss.on("connection", (clientWs: WebSocket, _req: IncomingMessage, ctx: RelayCtx) => {
    if (ctx.kind === "gemini") {
      handleGeminiRelay(clientWs, ctx);
      return;
    }
    if (ctx.kind === "hume") {
      handleHumeRelay(clientWs, ctx);
      return;
    }
    if (ctx.kind === "deepgram-agent") {
      handleDeepgramAgentRelay(clientWs, ctx);
      return;
    }
    if (ctx.kind === "modular") {
      handleModularRelay({
        clientWs,
        ctx,
        executeToolCall,
        cancelLiveOrder,
      });
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

  console.log(
    "[WS-Relay] WebSocket relay attached for /api/realtime, /api/realtime/gemini, " +
      "/api/realtime/hume, /api/realtime/deepgram-agent, /api/realtime/modular",
  );
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
  const sessionId = ctx.query.sessionId || `gemini-${ctx.userId}-${Date.now()}`;

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
      if (clientWs.readyState === WebSocket.OPEN) {
        for (const message of geminiServerMessagesForRealtimeClient(event, sessionId)) {
          clientWs.send(JSON.stringify(message));
        }
      }
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

    if (clientWs.readyState === WebSocket.OPEN) {
      for (const message of geminiServerMessagesForRealtimeClient(event, sessionId)) {
        clientWs.send(JSON.stringify(message));
      }
    }
  });

  upstream.on("error", (err) => {
    console.error(`[WS-Relay/Gemini] Upstream error: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    }
  });

  upstream.on("close", (code, reason) => {
    const message = reason.toString() || `Gemini Live closed with code ${code}`;
    const clientCloseCode = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011;
    console.log(`[WS-Relay/Gemini] Upstream closed user=${ctx.userId} code=${code} reason=${message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message } }));
      clientWs.close(clientCloseCode, message.slice(0, 120));
    }
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

    const geminiMessage = geminiClientMessageFromRealtimeEvent(event);
    if (!geminiMessage) return;

    if (upstreamReady && setupSent) upstream.send(geminiMessage);
    else pendingFromClient.push(geminiMessage);
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

// ── Hume EVI 3 relay ──────────────────────────────────────────────────────────

function handleHumeRelay(clientWs: WebSocket, ctx: RelayCtx): void {
  if (!process.env.HUME_API_KEY) {
    clientWs.send(JSON.stringify({ type: "error", error: { message: "HUME_API_KEY not configured" } }));
    clientWs.close();
    return;
  }
  let catalog: CatalogItem[] = [];
  let order: OrderItem[] = [];
  const session: LiveSession = { items: [] };
  let sessionSquareToken = ctx.squareToken;
  let sessionLocationId = ctx.squareLocationId;
  let voice: string | undefined;

  const url = (() => {
    try {
      return buildHumeWsUrl(ctx.query.configId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "url build failed";
      clientWs.send(JSON.stringify({ type: "error", error: { message } }));
      clientWs.close();
      return null;
    }
  })();
  if (!url) return;

  const upstream = new WebSocket(url);
  let upstreamReady = false;
  let pendingFromClient: string[] = [];

  console.log(`[WS-Relay/Hume] Connected user=${ctx.userId}`);

  function sendSettings(): void {
    const settings = buildHumeSessionSettings(buildInstructions(catalog, order), ALL_TOOLS);
    if (voice) (settings as Record<string, unknown>).voice = { name: voice };
    upstream.send(JSON.stringify(settings));
  }

  upstream.on("open", () => {
    upstreamReady = true;
    sendSettings();
    for (const m of pendingFromClient) upstream.send(m);
    pendingFromClient = [];
  });

  upstream.on("message", async (data) => {
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    if (event.type === "tool_call") {
      const name = String(event.name ?? "");
      const id = String(event.tool_call_id ?? event.id ?? "");
      let args: Record<string, unknown> = {};
      try {
        args = typeof event.parameters === "string"
          ? JSON.parse(String(event.parameters))
          : (event.parameters as Record<string, unknown>) ?? {};
      } catch { /* leave args empty */ }
      console.log(`[WS-Relay/Hume] Tool call: ${name}(${JSON.stringify(args)})`);
      try {
        const { result, command } = await executeToolCall(
          name,
          args,
          { catalog, order, squareToken: sessionSquareToken, squareLocationId: sessionLocationId, session },
        );
        upstream.send(JSON.stringify({
          type: "tool_response",
          tool_call_id: id,
          content: result,
        }));
        if (command && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "x.order_command", command }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool call failed";
        upstream.send(JSON.stringify({
          type: "tool_error",
          tool_call_id: id,
          error: msg,
        }));
      }
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
  });

  upstream.on("error", (err) => {
    console.error(`[WS-Relay/Hume] Upstream error: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    }
  });

  upstream.on("close", () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on("message", (data) => {
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (upstreamReady) upstream.send(raw);
      else pendingFromClient.push(raw);
      return;
    }
    if (event.type === "x.context_update") {
      if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
      if (Array.isArray(event.order)) order = event.order as OrderItem[];
      if (event.squareToken) sessionSquareToken = String(event.squareToken);
      if (event.squareLocationId) sessionLocationId = String(event.squareLocationId);
      if (typeof event.voice === "string") voice = event.voice;
      if (upstreamReady) sendSettings();
      return;
    }
    if (upstreamReady) upstream.send(raw);
    else pendingFromClient.push(raw);
  });

  clientWs.on("close", () => {
    if (session.squareOrderId) {
      cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });

  clientWs.on("error", (err) => {
    console.error(`[WS-Relay/Hume] Client WS error: ${err.message}`);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}

// ── Deepgram Voice Agent API relay ────────────────────────────────────────────

function handleDeepgramAgentRelay(clientWs: WebSocket, ctx: RelayCtx): void {
  if (!process.env.DEEPGRAM_API_KEY) {
    clientWs.send(JSON.stringify({ type: "error", error: { message: "DEEPGRAM_API_KEY not configured" } }));
    clientWs.close();
    return;
  }
  let catalog: CatalogItem[] = [];
  let order: OrderItem[] = [];
  const session: LiveSession = { items: [] };
  let sessionSquareToken = ctx.squareToken;
  let sessionLocationId = ctx.squareLocationId;
  let voice: string | undefined;

  const upstream = new WebSocket(buildDeepgramAgentWsUrl(), {
    headers: deepgramAgentAuthHeaders(),
  });
  let upstreamReady = false;
  let pendingFromClient: Array<string | Buffer> = [];

  console.log(`[WS-Relay/DG-Agent] Connected user=${ctx.userId}`);

  function sendSettings(): void {
    const settings = buildDeepgramAgentSettings({
      instructions: buildInstructions(catalog, order),
      tools: ALL_TOOLS,
      voice,
    });
    upstream.send(JSON.stringify(settings));
  }

  upstream.on("open", () => {
    upstreamReady = true;
    sendSettings();
    for (const m of pendingFromClient) upstream.send(m);
    pendingFromClient = [];
  });

  upstream.on("message", async (data, isBinary) => {
    if (isBinary) {
      // Binary frames are TTS audio chunks — forward to client as-is.
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
      return;
    }
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }
    if (event.type === "FunctionCallRequest") {
      const id = String(event.function_call_id ?? "");
      const name = String(event.function_name ?? "");
      let args: Record<string, unknown> = {};
      try {
        args = typeof event.input === "string"
          ? JSON.parse(String(event.input))
          : (event.input as Record<string, unknown>) ?? {};
      } catch { /* ignore */ }
      console.log(`[WS-Relay/DG-Agent] Tool call: ${name}(${JSON.stringify(args)})`);
      try {
        const { result, command } = await executeToolCall(
          name,
          args,
          { catalog, order, squareToken: sessionSquareToken, squareLocationId: sessionLocationId, session },
        );
        upstream.send(JSON.stringify({
          type: "FunctionCallResponse",
          function_call_id: id,
          output: result,
        }));
        if (command && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "x.order_command", command }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool call failed";
        upstream.send(JSON.stringify({
          type: "FunctionCallResponse",
          function_call_id: id,
          output: `Error: ${msg}`,
        }));
      }
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
  });

  upstream.on("error", (err) => {
    console.error(`[WS-Relay/DG-Agent] Upstream error: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", error: { message: "Voice service connection failed" } }));
      clientWs.close();
    }
  });

  upstream.on("close", () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on("message", (data, isBinary) => {
    if (isBinary) {
      if (upstreamReady) upstream.send(data);
      else pendingFromClient.push(data as Buffer);
      return;
    }
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      if (upstreamReady) upstream.send(raw);
      else pendingFromClient.push(raw);
      return;
    }
    if (event.type === "x.context_update") {
      if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
      if (Array.isArray(event.order)) order = event.order as OrderItem[];
      if (event.squareToken) sessionSquareToken = String(event.squareToken);
      if (event.squareLocationId) sessionLocationId = String(event.squareLocationId);
      if (typeof event.voice === "string") voice = event.voice;
      if (upstreamReady) {
        upstream.send(JSON.stringify({
          type: "UpdatePrompt",
          prompt: buildInstructions(catalog, order),
        }));
      }
      return;
    }
    if (upstreamReady) upstream.send(raw);
    else pendingFromClient.push(raw);
  });

  clientWs.on("close", () => {
    if (session.squareOrderId) {
      cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });

  clientWs.on("error", (err) => {
    console.error(`[WS-Relay/DG-Agent] Client WS error: ${err.message}`);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}