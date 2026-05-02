/**
 * Modular cascaded relay.
 *
 * Wires together a streaming STT, an LLM with tool calling, and a
 * streaming TTS, then bridges the chain with the VoyceLab tool execution
 * layer. The relay opens a WebSocket to the client, accepts PCM 16kHz
 * mono audio frames, ships them upstream to the chosen STT, fires the
 * LLM with the latest transcript on each turn boundary, executes any
 * tool calls server-side, then streams synthesized audio back to the
 * client as it arrives.
 *
 * Wire format with the client:
 *   client -> server (binary): linear16 PCM @ 16kHz, 20ms frames
 *   client -> server (text JSON):
 *     { type: "x.context_update", catalog, order, squareToken, squareLocationId, voice }
 *     { type: "x.user_text", text }                         -- typed turn
 *     { type: "x.commit_turn" }                              -- end of utterance
 *   server -> client (text JSON):
 *     { type: "transcript.partial", text }
 *     { type: "transcript.final", text }
 *     { type: "assistant.text", text }
 *     { type: "x.order_command", command }
 *     { type: "error", error: { message } }
 *   server -> client (binary): linear16 PCM @ 24kHz, mono — TTS audio
 */

import WebSocket from "ws";
import type { CatalogItem, OrderItem, LiveSession } from "../../lib/square-helpers";
import type { ToolDefinition } from "../../tools/types";
import { ALL_TOOLS } from "../../tools";

interface ExecuteToolCall {
  (
    toolName: string,
    args: Record<string, unknown>,
    ctx: {
      catalog: CatalogItem[];
      order: OrderItem[];
      squareToken: string;
      squareLocationId: string;
      session: LiveSession;
    },
  ): Promise<{ result: string; command?: unknown }>;
}

interface CancelLiveOrder {
  (session: LiveSession, squareToken: string, squareLocationId: string): Promise<unknown>;
}

interface RelayCtxLite {
  userId: number;
  venueId: number | null;
  squareToken: string;
  squareLocationId: string;
  query: Record<string, string>;
}

interface ModularRelayArgs {
  clientWs: WebSocket;
  ctx: RelayCtxLite;
  executeToolCall: ExecuteToolCall;
  cancelLiveOrder: CancelLiveOrder;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_TTS_VOICE = "ash";
const DEFAULT_CARTESIA_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091"; // "Barbershop Man"
const DEFAULT_DEEPGRAM_TTS_MODEL = "aura-2-asteria-en";

function readEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  return "";
}

export async function handleModularRelay(args: ModularRelayArgs): Promise<void> {
  const { clientWs, ctx, executeToolCall, cancelLiveOrder } = args;
  const sttVendor = ctx.query.stt ?? "deepgram_flux";
  const llmVendor = ctx.query.llm ?? "openai";
  const llmModel = ctx.query.llmModel ?? DEFAULT_LLM_MODEL;
  const ttsVendor = ctx.query.tts ?? "openai_tts";

  let catalog: CatalogItem[] = [];
  let order: OrderItem[] = [];
  const session: LiveSession = { items: [] };
  let sessionSquareToken = ctx.squareToken;
  let sessionLocationId = ctx.squareLocationId;
  let voice: string | undefined;
  const conversation: ChatMessage[] = [];
  let pendingPartial = "";
  let speaking = false;

  console.log(
    `[WS-Relay/Modular] Connected user=${ctx.userId} stt=${sttVendor} llm=${llmVendor}/${llmModel} tts=${ttsVendor}`,
  );

  function sendJson(payload: Record<string, unknown>): void {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  }
  function sendError(message: string): void {
    sendJson({ type: "error", error: { message } });
  }

  // ── STT: open upstream connection based on vendor ─────────────────────────
  const stt = await openStt(sttVendor, {
    onPartial: (text) => {
      pendingPartial = text;
      sendJson({ type: "transcript.partial", text });
    },
    onFinal: async (text) => {
      pendingPartial = "";
      const trimmed = text.trim();
      if (!trimmed) return;
      sendJson({ type: "transcript.final", text: trimmed });
      await runTurn(trimmed);
    },
    onError: (err) => sendError(`STT error: ${err}`),
  });
  if (!stt) {
    sendError(`STT vendor ${sttVendor} not available. Check credentials.`);
    clientWs.close();
    return;
  }

  // ── LLM turn: chat completion with optional tool loop ─────────────────────
  async function runTurn(userText: string): Promise<void> {
    if (conversation.length === 0) {
      conversation.push({ role: "system", content: buildInstructions(catalog, order) });
    } else {
      // Refresh the system prompt each turn so catalog/order are current.
      conversation[0] = { role: "system", content: buildInstructions(catalog, order) };
    }
    conversation.push({ role: "user", content: userText });

    let safety = 0;
    let assistantText = "";
    while (safety < 6) {
      safety += 1;
      const result = await callOpenAiChat({
        model: llmModel,
        messages: conversation,
        tools: ALL_TOOLS,
      });
      if (!result) {
        sendError("LLM call failed");
        return;
      }
      const assistantMsg = result.message;
      conversation.push(assistantMsg);
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        for (const tc of assistantMsg.tool_calls) {
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments || "{}");
          } catch { /* ignore parse failures, send empty args */ }
          try {
            const { result: toolResult, command } = await executeToolCall(
              tc.function.name,
              toolArgs,
              { catalog, order, squareToken: sessionSquareToken, squareLocationId: sessionLocationId, session },
            );
            conversation.push({
              role: "tool",
              tool_call_id: tc.id,
              name: tc.function.name,
              content: toolResult,
            });
            if (command) sendJson({ type: "x.order_command", command });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "tool call failed";
            conversation.push({
              role: "tool",
              tool_call_id: tc.id,
              name: tc.function.name,
              content: `Error: ${msg}`,
            });
          }
        }
        continue; // loop back into LLM with tool results
      }
      if (assistantMsg.content) {
        assistantText = assistantMsg.content;
        sendJson({ type: "assistant.text", text: assistantText });
      }
      break;
    }

    if (assistantText) {
      speaking = true;
      try {
        await streamTts(ttsVendor, assistantText, voice, (chunk) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(chunk);
        });
      } catch (e) {
        sendError(`TTS error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        speaking = false;
        sendJson({ type: "assistant.audio_end" });
      }
    }
  }

  // ── Wire client messages ─────────────────────────────────────────────────
  clientWs.on("message", (data, isBinary) => {
    if (isBinary) {
      stt.feed(data as Buffer);
      return;
    }
    const raw = data.toString();
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.type === "x.context_update") {
      if (Array.isArray(event.catalog)) catalog = event.catalog as CatalogItem[];
      if (Array.isArray(event.order)) order = event.order as OrderItem[];
      if (event.squareToken) sessionSquareToken = String(event.squareToken);
      if (event.squareLocationId) sessionLocationId = String(event.squareLocationId);
      if (typeof event.voice === "string") voice = event.voice;
      return;
    }
    if (event.type === "x.user_text" && typeof event.text === "string") {
      void runTurn(event.text);
      return;
    }
    if (event.type === "x.commit_turn") {
      stt.commit();
      return;
    }
  });

  clientWs.on("close", () => {
    stt.close();
    if (session.squareOrderId) {
      cancelLiveOrder(session, sessionSquareToken, sessionLocationId).catch(() => {});
    }
    void speaking;
  });

  clientWs.on("error", (err) => {
    console.error(`[WS-Relay/Modular] Client WS error: ${err.message}`);
    stt.close();
  });
}

// ── STT vendor adapters ──────────────────────────────────────────────────────

interface SttHandle {
  feed(pcm: Buffer): void;
  commit(): void;
  close(): void;
}

interface SttHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(err: string): void;
}

async function openStt(vendor: string, handlers: SttHandlers): Promise<SttHandle | null> {
  switch (vendor) {
    case "deepgram_flux":
      return openDeepgramStt(handlers);
    case "assemblyai_streaming":
      return openAssemblyAiStt(handlers);
    case "cartesia_ink":
      return openCartesiaInkStt(handlers);
    default:
      return null;
  }
}

function openDeepgramStt(h: SttHandlers): SttHandle | null {
  const key = readEnv("DEEPGRAM_API_KEY");
  if (!key) return null;
  // Deepgram's flagship streaming model is "nova-3"; "flux" is the
  // turn-detection feature exposed via the same WS endpoint.
  const url =
    "wss://api.deepgram.com/v1/listen?" +
    new URLSearchParams({
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      model: "nova-3",
      smart_format: "true",
      interim_results: "true",
      vad_events: "true",
      endpointing: "300",
      punctuate: "true",
    }).toString();
  const ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
  const buf: Buffer[] = [];
  ws.on("open", () => {
    for (const b of buf) ws.send(b);
    buf.length = 0;
  });
  ws.on("message", (data) => {
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data.toString()); } catch { return; }
    if (evt.type === "Results") {
      const alt = (evt.channel as { alternatives?: Array<{ transcript?: string }> })?.alternatives?.[0];
      const text = alt?.transcript ?? "";
      const isFinal = Boolean(evt.is_final);
      if (!text) return;
      if (isFinal) h.onFinal(text);
      else h.onPartial(text);
    }
  });
  ws.on("error", (err) => h.onError(err.message));
  return {
    feed: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
      else buf.push(pcm);
    },
    commit: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

function openAssemblyAiStt(h: SttHandlers): SttHandle | null {
  const key = readEnv("ASSEMBLYAI_API_KEY");
  if (!key) return null;
  // AssemblyAI v3 universal streaming (Aug 2025+).
  const url = "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true";
  const ws = new WebSocket(url, { headers: { authorization: key } });
  const buf: Buffer[] = [];
  ws.on("open", () => {
    for (const b of buf) ws.send(b);
    buf.length = 0;
  });
  ws.on("message", (data) => {
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data.toString()); } catch { return; }
    const text = String(evt.transcript ?? "");
    if (!text) return;
    if (evt.message_type === "FinalTranscript" || evt.end_of_turn === true) h.onFinal(text);
    else h.onPartial(text);
  });
  ws.on("error", (err) => h.onError(err.message));
  return {
    feed: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
      else buf.push(pcm);
    },
    commit: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

function openCartesiaInkStt(h: SttHandlers): SttHandle | null {
  const key = readEnv("CARTESIA_API_KEY");
  if (!key) return null;
  // Cartesia's STT (Ink) WebSocket endpoint.
  const url = "wss://api.cartesia.ai/stt/websocket?model=ink-whisper&encoding=pcm_s16le&sample_rate=16000";
  const ws = new WebSocket(url, {
    headers: { "X-API-Key": key, "Cartesia-Version": "2024-11-13" },
  });
  const buf: Buffer[] = [];
  ws.on("open", () => {
    for (const b of buf) ws.send(b);
    buf.length = 0;
  });
  ws.on("message", (data) => {
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data.toString()); } catch { return; }
    if (evt.type === "transcript") {
      const text = String(evt.text ?? "");
      if (!text) return;
      if (evt.is_final) h.onFinal(text);
      else h.onPartial(text);
    }
  });
  ws.on("error", (err) => h.onError(err.message));
  return {
    feed: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
      else buf.push(pcm);
    },
    commit: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "finalize" }));
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callOpenAiChat(opts: {
  model: string;
  messages: ChatMessage[];
  tools: ReadonlyArray<ToolDefinition>;
}): Promise<{ message: ChatMessage } | null> {
  const key = readEnv("OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY");
  if (!key) return null;
  // OpenAI Chat Completions tool format
  const tools = opts.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: (t.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        tools,
        tool_choice: "auto",
        temperature: 0.6,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[Modular/LLM] OpenAI HTTP ${res.status}: ${detail.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) return null;
    return { message };
  } finally {
    clearTimeout(timer);
  }
}

// ── TTS streaming ────────────────────────────────────────────────────────────

async function streamTts(
  vendor: string,
  text: string,
  voice: string | undefined,
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  switch (vendor) {
    case "openai_tts":
      return streamOpenAiTts(text, voice ?? DEFAULT_OPENAI_TTS_VOICE, onChunk);
    case "cartesia_sonic":
      return streamCartesiaSonicTts(text, voice ?? DEFAULT_CARTESIA_VOICE, onChunk);
    case "deepgram_aura":
      return streamDeepgramAuraTts(text, voice ?? DEFAULT_DEEPGRAM_TTS_MODEL, onChunk);
    default:
      throw new Error(`Unknown TTS vendor: ${vendor}`);
  }
}

async function streamOpenAiTts(
  text: string,
  voice: string,
  onChunk: (b: Buffer) => void,
): Promise<void> {
  const key = readEnv("OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "pcm",
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenAI TTS HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(Buffer.from(value));
  }
}

async function streamCartesiaSonicTts(
  text: string,
  voiceId: string,
  onChunk: (b: Buffer) => void,
): Promise<void> {
  const key = readEnv("CARTESIA_API_KEY");
  if (!key) throw new Error("CARTESIA_API_KEY missing");
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Cartesia-Version": "2024-11-13",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-2",
      transcript: text,
      voice: { mode: "id", id: voiceId },
      output_format: {
        container: "raw",
        encoding: "pcm_s16le",
        sample_rate: 24000,
      },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Cartesia TTS HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(Buffer.from(value));
  }
}

async function streamDeepgramAuraTts(
  text: string,
  model: string,
  onChunk: (b: Buffer) => void,
): Promise<void> {
  const key = readEnv("DEEPGRAM_API_KEY");
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=linear16&sample_rate=24000&container=none`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Deepgram TTS HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(Buffer.from(value));
  }
}

// ── Shared instructions builder ──────────────────────────────────────────────
// Mirrors the persona used by the OpenAI/Gemini relays so the venue's
// agent feels consistent regardless of pipeline choice.
function buildInstructions(catalog: CatalogItem[], order: OrderItem[]): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
      : "  (No catalog loaded — ask user to connect Square)";
  const orderStr =
    order.length > 0
      ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
      : "  (empty)";
  return `You are VoyceLab, the voice operating assistant for modern venues running on Square.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona: Sharp, knowledgeable, confident. One or two sentences max. Bartender slang welcome. Say prices naturally ("eight fifty"), never "dollar sign". Never submit until they say so. Ask before destructive actions.`;
}
