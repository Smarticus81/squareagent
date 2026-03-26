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

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentState =
  | "disconnected"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type AgentMode = "pos" | "inventory";

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
}

export type CommandHandler = (commands: OrderCommand[]) => void;
export type ToolHandler = CommandHandler;

interface VoiceAgentContextType {
  agentState: AgentState;
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  isConnected: boolean;
  conversation: ConversationMessage[];
  partialTranscript: string;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearConversation: () => void;
  setToolHandler: (h: CommandHandler) => void;
  interrupt: () => void;
  setCatalog: (items: unknown[]) => void;
  setCurrentOrder: (order: unknown[]) => void;
  setSquareCredentials: (token: string, locationId: string) => void;
  setAuthParams: (venueId: string, authToken: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENAI_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";

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

function getWsUrl(voice: string, speed: number, authToken?: string, venueId?: string): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  let base: string;
  if (!domain) {
    base = "ws://localhost:8080/api/realtime";
  } else {
    const protocol = domain.startsWith("localhost") ? "ws" : "wss";
    base = `${protocol}://${domain}/api/realtime`;
  }
  const params = new URLSearchParams();
  params.set("voice", voice);
  params.set("speed", String(speed));
  if (authToken) params.set("token", authToken);
  if (venueId) params.set("venueId", venueId);
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
  const [agentMode, setAgentMode] = useState<AgentMode>("pos");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<unknown[]>([]);
  const squareTokenRef = useRef<string>("");
  const squareLocationIdRef = useRef<string>("");
  const venueIdRef = useRef<string>("");
  const authTokenRef = useRef<string>("");
  const isRunning = useRef(false);
  const agentModeRef = useRef<AgentMode>("pos");
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

  // Keep mode ref in sync
  useEffect(() => { agentModeRef.current = agentMode; }, [agentMode]);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const setAs = useCallback((s: AgentState) => { agentStateRef.current = s; setAgentState(s); }, []);

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    setConversation((prev) => [
      ...prev,
      { id: genId(), role, content, timestamp: new Date() },
    ]);
  }, []);

  // Build instructions string from current catalog + order
  const buildInstructions = useCallback(() => {
    const catalog = catalogRef.current as Array<{ name: string; price: number; category?: string }>;
    const mode = agentModeRef.current;

    const catalogStr =
      catalog.length > 0
        ? catalog.map((c: any) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
        : "  (No catalog loaded — connect Square first)";

    if (mode === "inventory") {
      return `You are BevPro Inventory, a voice assistant for managing bar and venue inventory on Square. You help staff count stock, receive deliveries, flag low items, and keep inventory accurate.

Catalog:
${catalogStr}

Persona:
- Professional, efficient, detail-oriented. You're an inventory specialist.
- Short, precise responses. Read back numbers clearly.
- Understand bar inventory terms: "we got a case of" = add 24, "86'd" = out of stock, "count" = check levels.

Rules:
- Always confirm quantities before making changes: "Adjusting Bud Light up 24, that right?"
- For bulk operations, summarize what you'll do before executing.
- Low stock alerts: proactively mention if an item drops below 5 units after an adjustment.
- Say numbers clearly: "twenty-four" not "24".
- You do NOT take orders or process payments. If asked, explain this is the inventory agent and suggest using the POS agent instead.
- Noisy environment — only respond to direct speech. If unclear, ask.`;
    }

    const order = currentOrderRef.current as Array<{ quantity: number; item_name: string; price: number }>;
    const orderStr =
      order.length > 0
        ? order.map((i: any) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
        : "  (empty)";

    return `You are BevPro, a bartender's voice assistant running on Square POS. You help the bartender ring up orders, check stock, and find menu info — fast and hands-free.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona:
- Professional, warm, efficient. You're a co-worker, not a customer-facing bot.
- Speak like bar staff: short, punchy, no fluff. One or two sentences max.
- Understand bartender slang: "86 it" = remove/out of stock, "ring it up" / "close it out" = submit, "tab it" = add to order, "what's on the ticket" = get order.

Rules:
- Add items only on clear intent ("two Fosters", "tab a Bud Light").
- Never submit until they say so ("ring it up", "close it out", "that's it"). Confirm the total first.
- If browsing or chatting, just talk — don't push items.
- Menu questions: mention a few options, don't dump the whole list.
- If something's not on the menu, suggest what's close.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".
- You do NOT manage inventory. If asked, explain this is the POS agent and suggest using the inventory agent instead.
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.`;
  }, []);

  const sendContextUpdate = useCallback(() => {
    if (Platform.OS !== "web") {
      // Native: send session.update directly to OpenAI via data channel
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      dc.send(JSON.stringify({ type: "session.update", session: { instructions: buildInstructions() } }));
    } else {
      // Web: send x.context_update to server relay
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
      ws.current.send(JSON.stringify({
        type: "x.context_update",
        catalog: catalogRef.current,
        order: currentOrderRef.current,
        squareToken: squareTokenRef.current,
        squareLocationId: squareLocationIdRef.current,
        venueId: venueIdRef.current || undefined,
        mode: agentModeRef.current,
      }));
    }
  }, [buildInstructions]);

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
  }, []);

  const setAuthParams = useCallback((venueId: string, authToken: string) => {
    venueIdRef.current = venueId;
    authTokenRef.current = authToken;
  }, []);

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
      const toolPath = agentModeRef.current === "inventory" ? "api/realtime-inventory/tools" : "api/realtime/tools";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;

      const res = await fetch(`${baseUrl}${toolPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
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
    const { voice, speed } = await getVoicePrefs();
    const baseUrl = getApiBase();

    // 1. Get ephemeral token from server
    const sessionPath = agentModeRef.current === "inventory" ? "api/realtime-inventory/session" : "api/realtime/session";
    console.log(`[WebRTC] Requesting ephemeral token (${agentModeRef.current} mode)...`);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;

    const tokenRes = await fetch(`${baseUrl}${sessionPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        voice,
        speed,
        catalog: catalogRef.current,
        order: currentOrderRef.current,
        venueId: venueIdRef.current || undefined,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({ error: "Failed to get session token" }));
      throw new Error(err.error || "Failed to get session token");
    }

    const sessionData = await tokenRes.json();
    const ephemeralKey = sessionData.client_secret?.value;
    if (!ephemeralKey) throw new Error("No ephemeral key in session response");

    console.log("[WebRTC] Got ephemeral token, creating peer connection...");

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

    // 8. Send offer to OpenAI, get SDP answer
    const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });

    if (!sdpRes.ok) {
      const errText = await sdpRes.text();
      throw new Error(`OpenAI SDP exchange failed: ${sdpRes.status} ${errText}`);
    }

    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));

    console.log("[WebRTC] Connection established — direct to OpenAI via UDP");
  }, [handleNativeDcEvent]);

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

    const { voice, speed } = await getVoicePrefs();
    const wsUrl = getWsUrl(voice, speed, authTokenRef.current, venueIdRef.current || undefined);
    console.log("[Realtime] Connecting to", wsUrl);
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
      setError("Not authenticated. Please log in with your BevPro account.");
      setAgentState("error");
      return;
    }

    setAs("connecting");

    try {
      if (Platform.OS !== "web") {
        await connectNativeWebRTC();
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
      }
    }
  }, [connectNativeWebRTC, connectWebSocket, setAs]);

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
      const dc = dcRef.current;
      if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "response.cancel" }));
    } else {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "response.cancel" }));
    }
  }, []);

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
        agentMode,
        setAgentMode: (mode: AgentMode) => { agentModeRef.current = mode; setAgentMode(mode); },
        isConnected,
        conversation,
        partialTranscript,
        error,
        connect,
        disconnect,
        clearConversation,
        setToolHandler,
        interrupt,
        setCatalog,
        setCurrentOrder,
        setSquareCredentials,
        setAuthParams,
      }}
    >
      {children}
    </VoiceAgentContext.Provider>
  );
}

export function useVoiceAgent() {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) throw new Error("useVoiceAgent must be used within VoiceAgentProvider");
  return ctx;
}
