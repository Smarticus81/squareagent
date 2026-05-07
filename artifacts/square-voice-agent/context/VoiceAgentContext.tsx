/**
 * Voice Agent Context — OpenAI Realtime API
 *
 * Native (iOS/Android): WebRTC direct to OpenAI — UDP transport, native codec,
 *                       ~50ms audio latency. Tool calls via REST.
 * Web:                  WebSocket + Web Audio API (PCM16 streaming, server-side VAD)
 */
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { Platform } from "react-native";
import { getVoicePrefs } from "@/hooks/useVoicePrefs";
import {
  NativeVoiceBridge,
  type BridgeOutgoing,
  type NativeVoiceBridgeHandle,
} from "@/components/NativeVoiceBridge";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentState =
  | "disconnected"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

export interface OrderCommand {
  action: "add" | "remove" | "clear" | "submit";
  item_id?: string;
  item_name?: string;
  quantity?: number;
  price?: number;
  squareOrderId?: string;
}

export type CommandHandler = (commands: OrderCommand[]) => void;
export type ToolHandler = CommandHandler;

/**
 * Voice pipeline provider id, mirrored from `voicelab-core`'s
 * `VoicePipelineProvider`. Used to dispatch the connection path so the runtime
 * matches what the assistant was configured with on the dashboard.
 */
export type PipelineProvider =
  | "openai_realtime_webrtc"
  | "openai_realtime_server_ws"
  | "google_gemini_3_1_flash_live"
  | "google_gemini_2_5_flash_native_audio"
  | "google_gemini_live_native_audio"
  | "hume_evi_3"
  | "elevenlabs_agents"
  | "deepgram_voice_agent_api"
  | "livekit_agents"
  | "pipecat"
  | "deepgram_flux_cartesia"
  | "deepgram_flux_aura"
  | "cartesia_ink_sonic"
  | "assemblyai_openai_cartesia"
  | "custom_modular_pipeline"
  | "browser_speech_api_fallback"
  | "push_to_talk_text_fallback"
  | "text_only_fallback";

interface VoiceAgentContextType {
  agentState: AgentState;
  isConnected: boolean;
  conversation: ConversationMessage[];
  partialTranscript: string;
  error: string | null;
  /** Provider currently bound to this client (null until set from agent profile). */
  pipelineProvider: PipelineProvider | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearConversation: () => void;
  setToolHandler: (h: CommandHandler) => void;
  interrupt: () => void;
  setCatalog: (items: unknown[]) => void;
  setCurrentOrder: (order: unknown[]) => void;
  setSquareCredentials: (token: string, locationId: string) => void;
  setAuthParams: (venueId: string, authToken: string) => void;
  /** Apply the assistant's configured pipeline provider + config from its agent profile. */
  setAgentPipeline: (
    provider: PipelineProvider | string | null | undefined,
    config?: Record<string, unknown> | null,
    agentProfileId?: string | null,
  ) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";

// AudioWorklet processor source for web path only
const WORKLET_SRC = `
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(1440);
    this._pos = 0;
    this._active = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this._active = false; };
  }
  process(inputs) {
    if (!this._active) return false;
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._pos++] = ch[i];
      if (this._pos >= 1440) {
        const pcm = new Int16Array(1440);
        for (let j = 0; j < 1440; j++) {
          const s = this._buf[j];
          pcm[j] = s < 0 ? Math.max(-32768, s * 32768) : Math.min(32767, s * 32767);
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this._buf = new Float32Array(1440);
        this._pos = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "http://localhost:8080/";
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}/`;
}

/**
 * Map a configured pipeline provider to the relay sub-path served by
 * `attachWebSocketRelay` (see api-server/src/routes/ws-relay.ts). Providers
 * that don't have a server-side relay yet fall back to OpenAI so we never
 * silently mismatch — the dispatcher upstream still throws if the provider
 * isn't actually supported.
 */
function relayPathForProvider(provider: PipelineProvider | null): string {
  switch (provider) {
    case "google_gemini_3_1_flash_live":
    case "google_gemini_2_5_flash_native_audio":
    case "google_gemini_live_native_audio":
      return "/api/realtime/gemini";
    case "hume_evi_3":
      return "/api/realtime/hume";
    case "deepgram_voice_agent_api":
      return "/api/realtime/deepgram-agent";
    case "deepgram_flux_cartesia":
    case "deepgram_flux_aura":
    case "cartesia_ink_sonic":
    case "assemblyai_openai_cartesia":
    case "custom_modular_pipeline":
      return "/api/realtime/modular";
    default:
      return "/api/realtime";
  }
}

function getWsUrl(
  voice: string,
  speed: number,
  authToken: string | undefined,
  venueId: string | undefined,
  provider: PipelineProvider | null,
  config: Record<string, unknown> | null,
  agentProfileId: string | null,
): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const path = relayPathForProvider(provider);
  let base: string;
  if (!domain) {
    base = `ws://localhost:8080${path}`;
  } else {
    const protocol = domain.startsWith("localhost") ? "ws" : "wss";
    base = `${protocol}://${domain}${path}`;
  }
  const params = new URLSearchParams();
  params.set("voice", voice);
  params.set("speed", String(speed));
  if (authToken) params.set("token", authToken);
  if (venueId) params.set("venueId", venueId);
  if (agentProfileId) params.set("agentProfileId", agentProfileId);

  // Provider-specific query params expected by the relay handlers.
  if (provider && provider.startsWith("google_gemini")) {
    const modelId =
      typeof config?.modelId === "string" ? (config.modelId as string) :
      typeof config?.model === "string" ? (config.model as string) :
      provider === "google_gemini_3_1_flash_live" ? "gemini-2.0-flash-exp" :
      "gemini-2.0-flash-exp";
    params.set("modelId", modelId);
  }
  if (path === "/api/realtime/modular" && config) {
    for (const key of ["sttVendor", "llmVendor", "ttsVendor", "llmModel"]) {
      const v = config[key];
      if (typeof v === "string" && v) params.set(key, v);
    }
  }
  return `${base}?${params.toString()}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

// Float32 PCM → Int16 PCM → base64
function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  return arrayBufferToBase64(pcm.buffer);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Context ───────────────────────────────────────────────────────────────────

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pipelineProvider, setPipelineProvider] = useState<PipelineProvider | null>(null);

  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<unknown[]>([]);
  const sessionIdRef = useRef<string>("");
  const squareTokenRef = useRef<string>("");
  const squareLocationIdRef = useRef<string>("");
  const venueIdRef = useRef<string>("");
  const authTokenRef = useRef<string>("");
  const pipelineProviderRef = useRef<PipelineProvider | null>(null);
  const pipelineConfigRef = useRef<Record<string, unknown> | null>(null);
  const agentProfileIdRef = useRef<string | null>(null);
  const isRunning = useRef(false);
  const agentStateRef = useRef<AgentState>("disconnected");

  // Web-only refs (WebSocket + Web Audio)
  const ws = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const nextPlayTime = useRef(0);

  // Native WebRTC refs
  const pcRef = useRef<any>(null);
  const dcRef = useRef<any>(null);
  const nativeStreamRef = useRef<any>(null);

  // Native WebView bridge (used for non-OpenAI providers on iOS/Android)
  const bridgeRef = useRef<NativeVoiceBridgeHandle | null>(null);
  const [bridgeActive, setBridgeActive] = useState(false);
  const bridgeReadyRef = useRef(false);
  const pendingBridgeUrlRef = useRef<string | null>(null);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const setAs = useCallback((s: AgentState) => {
    agentStateRef.current = s;
    setAgentState(s);
  }, []);

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    setConversation((prev) => [
      ...prev,
      { id: genId(), role, content, timestamp: new Date() },
    ]);
  }, []);

  const sendContextUpdate = useCallback(() => {
    if (Platform.OS !== "web") {
      // If we're on a non-OpenAI native session, the WebSocket lives inside
      // the WebView bridge — forward the same x.context_update payload our
      // server-side relays already understand.
      if (
        pipelineProviderRef.current &&
        pipelineProviderRef.current !== "openai_realtime_webrtc" &&
        bridgeRef.current
      ) {
        bridgeRef.current.sendContext({
          type: "x.context_update",
          catalog: catalogRef.current,
          order: currentOrderRef.current,
          squareToken: squareTokenRef.current,
          squareLocationId: squareLocationIdRef.current,
          venueId: venueIdRef.current || undefined,
        });
        return;
      }

      // Native WebRTC: data channel goes DIRECTLY to OpenAI → must send
      // a standard session.update with rebuilt instructions.
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;

      const catalog = catalogRef.current as Array<{ name: string; price: number; category?: string }>;
      const catalogStr =
        catalog.length > 0
          ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
          : "  (No catalog loaded — connect Square first)";

      const order = currentOrderRef.current as Array<{ quantity: number; item_name?: string; name?: string; price: number }>;
      const orderStr =
        order.length > 0
          ? order.map((i) => `  - ${i.quantity}x ${i.item_name || i.name} @ $${i.price.toFixed(2)}`).join("\n")
          : "  (empty)";

      const instructions = `You are VoyceLab, a comprehensive voice assistant for bars and venues running on Square. You have FULL access to the Square platform — ordering, inventory, catalog management, customer profiles, payments, team management, reporting, and more.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona:
- Sharp, knowledgeable, confident. You're the venue's operations brain.
- Speak like bar staff: short, punchy, no fluff. One or two sentences max.
- NEVER repeat the order back or read items back unless the user explicitly asks ("what's on the ticket", "read that back", "what do I have").
- NEVER ask "is that right?" or "sound good?" after adding items. Just do it and confirm with a few words.
- Keep confirmations ultra-tight: "Got it", "Done", "Added", "On there". Prefer 2 to 6 words.
- Understand bartender slang: "86 it" = remove/out of stock, "ring it up" / "close it out" = submit, "tab it" = add to order, "what's on the ticket" = get order, "comp it" = 100% discount, "who's on" = current shifts.
- Understand inventory terms: "we got a case of" = add 24, "count" = check levels.

POS Rules:
- Add items only on clear intent ("two Fosters", "tab a Bud Light").
- When adding items, just confirm briefly: "Got it" or "Added". Do NOT repeat what was added or list the order.
- Never submit until they say so ("ring it up", "close it out", "that's it"). When they do, just confirm the total — don't read back every item.
- If browsing or chatting, just talk — don't push items.
- Menu questions: mention a few options, don't dump the whole list.
- If something's not on the menu, suggest what's close.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".
- Items appear on the Square POS in real-time — a one-word acknowledgment is enough.
- If they want to pay by card, use send_to_terminal. Say "sent to the terminal, tap when ready".

Catalog Management:
- You can create, update, and delete menu items in Square.
- Only confirm before destructive actions like deleting items. For creates and updates, just do it.
- When updating prices, briefly state the change: "IPA moved to nine fifty."

Inventory Rules:
- For single-item adjustments, just do it. No need to confirm unless the quantity sounds unusual.
- For bulk operations, briefly state what you'll do, then execute.
- Low stock alerts: proactively mention if an item drops below 5 units.
- Understand bulk language: "case of" = 24, "keg" = context-dependent.

Customers & Payments:
- Search/create/update customer profiles.
- List payments, issue refunds, cancel pending payments.
- Confirm refund amounts before executing (destructive).

Team & Shifts:
- List team members, see who's clocked in, clock people in/out.

Reports:
- Sales reports: today, yesterday, this week, last 7 days, this month.
- Present numbers naturally: "you did forty-two orders, twelve hundred in revenue."
- Top sellers, hourly breakdowns, item performance, daily summaries available.
- Lead with the headline: "Good shift — 47 orders, eighteen hundred revenue."

General:
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.
- Only confirm before destructive actions (delete, refund). Everything else — just do it.
- Do not repeat back, summarize, or over-explain. Act fast and keep responses minimal.
- You have full Square access — use it confidently.`;

      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          instructions,
        },
      }));
    } else {
      // Web WebSocket: goes to our ws-relay server which intercepts x.context_update
      const payload = JSON.stringify({
        type: "x.context_update",
        catalog: catalogRef.current,
        order: currentOrderRef.current,
        squareToken: squareTokenRef.current,
        squareLocationId: squareLocationIdRef.current,
        venueId: venueIdRef.current || undefined,
      });
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(payload);
    }
  }, []);

  const setCatalog = useCallback((items: unknown[]) => {
    catalogRef.current = items;
    sendContextUpdate();
  }, [sendContextUpdate]);

  const setCurrentOrder = useCallback((order: unknown[]) => {
    currentOrderRef.current = order;
    sendContextUpdate();
  }, [sendContextUpdate]);

  const setSquareCredentials = useCallback((token: string, locationId: string) => {
    squareTokenRef.current = token;
    squareLocationIdRef.current = locationId;
    sendContextUpdate();
  }, [sendContextUpdate]);

  const setAuthParams = useCallback((venueId: string, authToken: string) => {
    venueIdRef.current = venueId;
    authTokenRef.current = authToken;
  }, []);

  const setAgentPipeline = useCallback(
    (
      provider: PipelineProvider | string | null | undefined,
      config?: Record<string, unknown> | null,
      agentProfileId?: string | null,
    ) => {
      const normalized = (provider ?? null) as PipelineProvider | null;
      pipelineProviderRef.current = normalized;
      pipelineConfigRef.current = config ?? null;
      agentProfileIdRef.current = agentProfileId ?? null;
      setPipelineProvider(normalized);
    },
    [],
  );

  const setToolHandler = useCallback((h: CommandHandler) => {
    commandHandlerRef.current = h;
  }, []);

  // ── Execute tool via server REST API (native WebRTC path) ────────────────────

  const executeToolViaServer = useCallback(async (
    toolName: string,
    args: Record<string, unknown>,
    callId: string,
  ) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;

    try {
      const baseUrl = getApiBase();
      const toolPath = "api/realtime/tools";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;

      const res = await fetch(`${baseUrl}${toolPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: sessionIdRef.current || undefined,
          tool_name: toolName,
          arguments: args,
          catalog: catalogRef.current,
          order: currentOrderRef.current,
          venueId: venueIdRef.current || undefined,
        }),
      });

      const data = await res.json();
      console.log(`[WebRTC] Tool result (${toolName}):`, data.result);

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: data.result ?? "Tool execution failed" },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));

      if (data.command) commandHandlerRef.current?.([data.command]);
    } catch (e: any) {
      console.error(`[WebRTC] Tool exec error:`, e.message);
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: `Error: ${e.message}` },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  }, []);

  // ── Native WebRTC event handler (data channel) ──────────────────────────────

  const handleNativeDcEvent = useCallback(
    (raw: string) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { return; }

      switch (event.type) {
        case "session.created":
          sessionIdRef.current = (event as any).session?.id || `native-${Date.now()}`;
          setAs("listening");
          sendContextUpdate();
          break;

        case "session.updated":
          break;

        case "input_audio_buffer.speech_started":
          if (agentStateRef.current === "speaking") {
            dcRef.current?.send(JSON.stringify({ type: "response.cancel" }));
          }
          setAs("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          setAs("thinking");
          break;

        case "response.audio_transcript.delta":
          setPartialTranscript((p) => p + String(event.delta ?? ""));
          break;

        case "conversation.item.input_audio_transcription.completed": {
          const t = String(event.transcript ?? "").trim();
          if (t) addMessage("user", t);
          setPartialTranscript("");
          break;
        }

        case "response.audio_transcript.done": {
          const t = String(event.transcript ?? "").trim();
          if (t) addMessage("agent", t);
          setPartialTranscript("");
          break;
        }

        case "response.audio.delta":
          // Audio plays natively via WebRTC media track — no manual scheduling
          setAs("speaking");
          break;

        case "response.done":
          if (isRunning.current) setAs("listening");
          break;

        case "response.function_call_arguments.done": {
          const toolName = String(event.name ?? "");
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(String(event.arguments ?? "{}")); } catch {}
          const callId = String(event.call_id ?? "");
          console.log(`[WebRTC] Tool call: ${toolName}(${JSON.stringify(args)})`);
          executeToolViaServer(toolName, args, callId);
          break;
        }

        case "error": {
          const err = (event.error as Record<string, unknown>)?.message ?? event.message ?? "Realtime error";
          console.error("[WebRTC]", err);
          setError(String(err));
          setAgentState("error");
          break;
        }
      }
    },
    [addMessage, sendContextUpdate, executeToolViaServer, setAs],
  );

  // ── Web WebSocket event handler ─────────────────────────────────────────────

  const handleWebWsEvent = useCallback(
    (raw: string) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { return; }

      switch (event.type) {
        case "session.created":
          sessionIdRef.current = (event as any).session?.id || `web-${Date.now()}`;
          setAs("listening");
          sendContextUpdate();
          break;

        case "input_audio_buffer.speech_started":
          if (agentStateRef.current === "speaking") {
            ws.current?.send(JSON.stringify({ type: "response.cancel" }));
            nextPlayTime.current = 0;
          }
          setAs("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          setAs("thinking");
          break;

        case "response.audio_transcript.delta":
          setPartialTranscript((p) => p + String(event.delta ?? ""));
          break;

        case "conversation.item.input_audio_transcription.completed": {
          const t = String(event.transcript ?? "").trim();
          if (t) addMessage("user", t);
          setPartialTranscript("");
          break;
        }

        case "response.audio_transcript.done": {
          const t = String(event.transcript ?? "").trim();
          if (t) addMessage("agent", t);
          setPartialTranscript("");
          break;
        }

        case "response.audio.delta": {
          const chunk = String(event.delta ?? "");
          if (chunk) scheduleWebAudioChunk(chunk);
          setAs("speaking");
          break;
        }

        case "response.done":
          nextPlayTime.current = 0;
          if (isRunning.current) setAs("listening");
          break;

        case "x.order_command": {
          const cmd = event.command as OrderCommand;
          if (cmd) commandHandlerRef.current?.([cmd]);
          break;
        }

        case "error": {
          const err = (event.error as Record<string, unknown>)?.message ?? event.message ?? "Realtime error";
          console.error("[Realtime]", err);
          setError(String(err));
          setAgentState("error");
          break;
        }
      }
    },
    [addMessage, sendContextUpdate, setAs],
  );

  // ── Web Audio playback (streaming PCM16) ────────────────────────────────────

  const scheduleWebAudioChunk = useCallback((base64Pcm: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const pcm16 = base64ToUint8Array(base64Pcm);
    const int16 = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.length / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const start = Math.max(now, nextPlayTime.current);
    source.start(start);
    nextPlayTime.current = start + audioBuffer.duration;
  }, []);

  // ── Native WebRTC connect ──────────────────────────────────────────────────

  const connectNativeWebRTC = useCallback(async () => {
    const { voice, speed } = await getVoicePrefs(
      pipelineProviderRef.current,
      pipelineConfigRef.current,
    );
    const baseUrl = getApiBase();

    console.log("[WebRTC] Creating peer connection...");

    // 2. Import react-native-webrtc (only available on native)
    const {
      RTCPeerConnection,
      RTCSessionDescription,
      mediaDevices,
    } = require("react-native-webrtc");

    // 3. Create RTCPeerConnection
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    // 4. Handle remote audio track — WebRTC plays natively via hardware
    pc.ontrack = (e: any) => {
      console.log("[WebRTC] Got remote audio track — audio plays natively");
    };

    // 5. Get local mic stream and add track
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    nativeStreamRef.current = stream;
    stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));

    // 6. Create data channel for events
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;

    dc.onopen = () => {
      console.log("[WebRTC] Data channel open");
      isRunning.current = true;
    };

    dc.onmessage = (e: any) => {
      const data = typeof e.data === "string" ? e.data : "";
      handleNativeDcEvent(data);
    };

    dc.onclose = () => {
      console.log("[WebRTC] Data channel closed");
      if (isRunning.current) {
        isRunning.current = false;
        setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
      }
    };

    // 7. Create SDP offer
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);

    // 8. Send offer to our server, which performs the GA unified /realtime/calls exchange
    const callHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (authTokenRef.current) callHeaders["Authorization"] = `Bearer ${authTokenRef.current}`;

    const sdpRes = await fetch(`${baseUrl}api/realtime/call`, {
      method: "POST",
      headers: callHeaders,
      body: JSON.stringify({
        sdp: offer.sdp,
        voice,
        speed,
        catalog: catalogRef.current,
        order: currentOrderRef.current,
        venueId: venueIdRef.current || undefined,
      }),
    });

    if (!sdpRes.ok) {
      const err = await sdpRes.json().catch(() => null);
      const detail = err?.detail || err?.error || "Failed to establish realtime call";
      throw new Error(`OpenAI SDP exchange failed: ${sdpRes.status} ${detail}`);
    }

    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));

    console.log("[WebRTC] Connection established — direct to OpenAI via UDP");
  }, [handleNativeDcEvent]);

  // ── Native WebView bridge connect (non-OpenAI providers) ────────────────────

  const handleBridgeMessage = useCallback(
    (msg: BridgeOutgoing) => {
      switch (msg.type) {
        case "ready":
          bridgeReadyRef.current = true;
          // If a connect was queued before the page finished loading, send it now.
          if (pendingBridgeUrlRef.current) {
            bridgeRef.current?.connect(pendingBridgeUrlRef.current);
            pendingBridgeUrlRef.current = null;
          }
          break;
        case "ws_open":
          isRunning.current = true;
          break;
        case "ws_close":
          isRunning.current = false;
          setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
          setBridgeActive(false);
          bridgeReadyRef.current = false;
          break;
        case "ws_error":
          console.error("[NativeBridge] WS error:", msg.message);
          setError(msg.message || "Bridge error");
          setAgentState("error");
          break;
        case "log":
          console.log("[NativeBridge]", msg.message);
          break;
        case "ws_event":
          // Reuse the existing web event handler — the relays speak the same
          // realtime event vocabulary on both transports.
          handleWebWsEvent(JSON.stringify(msg.event));
          break;
      }
    },
    [handleWebWsEvent],
  );

  const connectNativeBridge = useCallback(async () => {
    const { voice, speed } = await getVoicePrefs(
      pipelineProviderRef.current,
      pipelineConfigRef.current,
    );
    const wsUrl = getWsUrl(
      voice,
      speed,
      authTokenRef.current,
      venueIdRef.current || undefined,
      pipelineProviderRef.current,
      pipelineConfigRef.current,
      agentProfileIdRef.current,
    );
    console.log(
      `[NativeBridge] Connecting (provider=${pipelineProviderRef.current}) to`,
      wsUrl,
    );
    pendingBridgeUrlRef.current = wsUrl;
    bridgeReadyRef.current = false;
    // Mounting the bridge triggers WebView load → we'll fire `connect`
    // once we receive `{ type: "ready" }` from the page.
    setBridgeActive(true);
  }, []);

  // ── Web WebSocket connect ──────────────────────────────────────────────────

  const connectWebSocket = useCallback(async () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await ctx.resume();
      audioCtxRef.current = ctx;
      nextPlayTime.current = 0;
    } catch (e: any) {
      throw new Error("AudioContext failed: " + e?.message);
    }

    const { voice, speed } = await getVoicePrefs(
      pipelineProviderRef.current,
      pipelineConfigRef.current,
    );
    const wsUrl = getWsUrl(
      voice,
      speed,
      authTokenRef.current,
      venueIdRef.current || undefined,
      pipelineProviderRef.current,
      pipelineConfigRef.current,
      agentProfileIdRef.current,
    );
    console.log(
      `[Realtime] Connecting (provider=${pipelineProviderRef.current ?? "openai_realtime_webrtc"}) to`,
      wsUrl,
    );
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { socket.onopen = null; socket.onerror = null; };
      socket.onopen = async () => {
        cleanup();
        console.log("[Realtime] WebSocket open");
        isRunning.current = true;
        await startWebAudioStream();
        resolve();
      };
      socket.onmessage = (e) => handleWebWsEvent(e.data);
      socket.onerror = (e) => {
        cleanup();
        console.error("[Realtime] WS error", e);
        reject(new Error("Connection failed"));
      };
      socket.onclose = () => {
        console.log("[Realtime] WS closed");
        isRunning.current = false;
        stopWebAudio();
        setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
      };
    });
  }, [handleWebWsEvent]);

  // ── Connect (dispatcher) ───────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isRunning.current) return;
    setError(null);

    if (!authTokenRef.current) {
      setError("Not authenticated. Please log in with your VoyceLab account.");
      setAgentState("error");
      return;
    }

    // Honor the assistant's configured voice pipeline provider.
    // • OpenAI Realtime (WebRTC) → native peer connection (lowest latency).
    // • Anything else on native → use the WebView bridge so the same
    //   server-side WS relays used by the web build power the session.
    const provider = pipelineProviderRef.current;
    const useBridge =
      Platform.OS !== "web" &&
      provider !== null &&
      provider !== "openai_realtime_webrtc";

    setAs("connecting");

    try {
      if (Platform.OS !== "web") {
        if (useBridge) {
          await connectNativeBridge();
        } else {
          await connectNativeWebRTC();
        }
      } else {
        await connectWebSocket();
      }
    } catch (e: any) {
      console.error("[Connect] Error:", e.message);
      setError(e.message);
      setAs("error");
      // Cleanup on failure
      if (Platform.OS !== "web") {
        nativeStreamRef.current?.getTracks().forEach((t: any) => t.stop());
        nativeStreamRef.current = null;
        dcRef.current?.close();
        dcRef.current = null;
        pcRef.current?.close();
        pcRef.current = null;
        bridgeRef.current?.disconnect();
        setBridgeActive(false);
        bridgeReadyRef.current = false;
        pendingBridgeUrlRef.current = null;
      }
    }
  }, [connectNativeBridge, connectNativeWebRTC, connectWebSocket, setAs]);

  // ── Web Audio capture ──────────────────────────────────────────────────────

  const startWebAudioStream = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);

      try {
        const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const worklet = new AudioWorkletNode(ctx, "pcm-processor");
        workletNodeRef.current = worklet;

        worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (ws.current?.readyState !== WebSocket.OPEN) return;
          const b64 = arrayBufferToBase64(e.data);
          ws.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
        };

        source.connect(worklet);
        worklet.connect(ctx.destination);
        console.log("[WebAudio] AudioWorklet streaming at 24kHz (~60ms frames)");
      } catch {
        console.warn("[WebAudio] AudioWorklet unavailable, falling back to ScriptProcessor");
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
          if (ws.current?.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const b64 = float32ToPcm16Base64(float32);
          ws.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        console.log("[WebAudio] ScriptProcessor streaming at 24kHz (~85ms frames)");
      }
    } catch (e: any) {
      console.error("[WebAudio]", e?.message);
      setError("Mic access failed: " + (e?.message ?? "unknown"));
      setAgentState("error");
    }
  }, []);

  const stopWebAudio = useCallback(async () => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage("stop");
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (audioCtxRef.current) {
      await audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    nextPlayTime.current = 0;
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    isRunning.current = false;
    agentStateRef.current = "disconnected";

    if (Platform.OS !== "web") {
      // Native WebView bridge cleanup
      bridgeRef.current?.disconnect();
      setBridgeActive(false);
      bridgeReadyRef.current = false;
      pendingBridgeUrlRef.current = null;

      // Native WebRTC cleanup
      nativeStreamRef.current?.getTracks().forEach((t: any) => t.stop());
      nativeStreamRef.current = null;
      dcRef.current?.close();
      dcRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
    } else {
      await stopWebAudio();
      ws.current?.close();
      ws.current = null;
    }

    setAgentState("disconnected");
  }, [stopWebAudio]);

  const interrupt = useCallback(() => {
    if (Platform.OS !== "web") {
      // If a WebView bridge session is active, interrupt through it.
      if (bridgeActive && bridgeRef.current) {
        bridgeRef.current.interrupt();
        return;
      }
      const dc = dcRef.current;
      if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "response.cancel" }));
    } else {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "response.cancel" }));
    }
  }, [bridgeActive]);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setError(null);
    setPartialTranscript("");
  }, []);

  const isConnected = agentState !== "disconnected" && agentState !== "error";

  return (
    <VoiceAgentContext.Provider
      value={{
        agentState,
        isConnected,
        conversation,
        partialTranscript,
        error,
        pipelineProvider,
        connect,
        disconnect,
        clearConversation,
        setToolHandler,
        interrupt,
        setCatalog,
        setCurrentOrder,
        setSquareCredentials,
        setAuthParams,
        setAgentPipeline,
      }}
    >
      {children}
      {Platform.OS !== "web" ? (
        <NativeVoiceBridge
          ref={bridgeRef}
          active={bridgeActive}
          onMessage={handleBridgeMessage}
        />
      ) : null}
    </VoiceAgentContext.Provider>
  );
}

export function useVoiceAgent() {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) throw new Error("useVoiceAgent must be used within VoiceAgentProvider");
  return ctx;
}
