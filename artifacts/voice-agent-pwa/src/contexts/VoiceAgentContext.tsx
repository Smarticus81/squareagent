/**
 * Voice Agent Context — Web-only, OpenAI Realtime API
 * WebSocket + Web Audio API (AudioWorklet for low-latency PCM16 streaming)
 */
import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react";
import { getVoicePrefs } from "@/lib/voice-prefs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentState = "disconnected" | "connecting" | "listening" | "thinking" | "speaking" | "error";

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

interface VoiceAgentContextType {
  agentState: AgentState;
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
}

// ── AudioWorklet source (inlined) ─────────────────────────────────────────────

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

function getWsUrl(voice: string, speed: number): string {
  const loc = window.location;
  const isLocal = loc.hostname === "localhost" || loc.hostname === "127.0.0.1";
  const protocol = loc.protocol === "https:" ? "wss" : "ws";
  // In dev, Vite proxies /api to port 8080
  const base = `${protocol}://${loc.host}/api/realtime`;
  return `${base}?voice=${encodeURIComponent(voice)}&speed=${speed}`;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  return arrayBufferToBase64(pcm.buffer);
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

  const ws = useRef<WebSocket | null>(null);
  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<unknown[]>([]);
  const squareTokenRef = useRef("");
  const squareLocationIdRef = useRef("");
  const isRunning = useRef(false);
  const agentStateRef = useRef<AgentState>("disconnected");

  // Web Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const nextPlayTime = useRef(0);
  // Track all active AudioBufferSourceNodes so we can stop them instantly on interrupt
  const activeSources = useRef<AudioBufferSourceNode[]>([]);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    setConversation((prev) => [...prev, { id: genId(), role, content, timestamp: new Date() }]);
  }, []);

  const sendContextUpdate = useCallback((overrides: Record<string, unknown> = {}) => {
    ws.current?.send(JSON.stringify({
      type: "x.context_update",
      catalog: catalogRef.current,
      order: currentOrderRef.current,
      squareToken: squareTokenRef.current,
      squareLocationId: squareLocationIdRef.current,
      ...overrides,
    }));
  }, []);

  const setCatalog = useCallback((items: unknown[]) => {
    catalogRef.current = items;
    sendContextUpdate({ catalog: items });
  }, [sendContextUpdate]);

  const setCurrentOrder = useCallback((order: unknown[]) => {
    currentOrderRef.current = order;
    sendContextUpdate({ order });
  }, [sendContextUpdate]);

  const setSquareCredentials = useCallback((token: string, locationId: string) => {
    squareTokenRef.current = token;
    squareLocationIdRef.current = locationId;
    sendContextUpdate({ squareToken: token, squareLocationId: locationId });
  }, [sendContextUpdate]);

  const setToolHandler = useCallback((h: CommandHandler) => { commandHandlerRef.current = h; }, []);

  // ── Web Audio playback ──────────────────────────────────────────────────────

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

    // Track source for instant cancellation on interrupt
    activeSources.current.push(source);
    source.onended = () => {
      activeSources.current = activeSources.current.filter((s) => s !== source);
    };
  }, []);

  // ── Stop all playing audio immediately (for interrupts) ─────────────────────

  const flushPlayback = useCallback(() => {
    for (const src of activeSources.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    activeSources.current = [];
    nextPlayTime.current = 0;
  }, []);

  // ── WebSocket event handler ─────────────────────────────────────────────────

  const handleWsEvent = useCallback((raw: string) => {
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw); } catch { return; }

    const setAs = (s: AgentState) => { agentStateRef.current = s; setAgentState(s); };

    switch (event.type) {
      case "session.created":
        setAs("listening");
        sendContextUpdate();
        break;

      case "input_audio_buffer.speech_started":
        // User is speaking — immediately kill all agent audio and cancel response
        if (agentStateRef.current === "speaking") {
          ws.current?.send(JSON.stringify({ type: "response.cancel" }));
          flushPlayback();
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
        // Audio chunks are still queued in Web Audio scheduler.
        // Keep "speaking" visual state while audio plays, then go to "listening".
        // If no active sources, transition immediately.
        if (isRunning.current) {
          if (activeSources.current.length === 0) {
            setAs("listening");
          } else {
            // The last source's onended will transition us
            const lastSource = activeSources.current[activeSources.current.length - 1];
            const prevOnEnded = lastSource.onended;
            lastSource.onended = (ev) => {
              if (prevOnEnded && typeof prevOnEnded === "function") (prevOnEnded as (e: Event) => void)(ev!);
              if (isRunning.current && agentStateRef.current === "speaking") {
                setAs("listening");
              }
            };
          }
        }
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
  }, [addMessage, sendContextUpdate, flushPlayback, scheduleWebAudioChunk]);

  // ── Connect ────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isRunning.current) return;
    setError(null);
    setAgentState("connecting");

    try {
      const ctx = new AudioContext({ sampleRate: 24000 });
      await ctx.resume();
      audioCtxRef.current = ctx;
      nextPlayTime.current = 0;
    } catch (e: any) {
      setError("AudioContext failed: " + e?.message);
      setAgentState("error");
      return;
    }

    const { voice, speed } = getVoicePrefs();
    const wsUrl = getWsUrl(voice, speed);
    console.log("[Realtime] Connecting to", wsUrl);
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = async () => {
      console.log("[Realtime] WebSocket open");
      isRunning.current = true;
      await startMicStream();
    };

    socket.onmessage = (e) => handleWsEvent(e.data);

    socket.onerror = () => {
      setError("Connection failed");
      setAgentState("error");
      isRunning.current = false;
    };

    socket.onclose = () => {
      isRunning.current = false;
      stopAudio();
      setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
    };
  }, [handleWsEvent]);

  // ── Mic capture (AudioWorklet with ScriptProcessor fallback) ───────────────

  const startMicStream = useCallback(async () => {
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
          // Always send mic audio — server-side VAD handles echo cancellation
          // and interrupt detection. Never mute the mic.
          const b64 = arrayBufferToBase64(e.data);
          ws.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
        };
        source.connect(worklet);
        worklet.connect(ctx.destination);
        console.log("[Audio] Worklet streaming at 24kHz (~60ms frames)");
      } catch {
        // Fallback: ScriptProcessorNode
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
          if (ws.current?.readyState !== WebSocket.OPEN) return;
          // Always send mic audio — server-side VAD handles echo cancellation
          ws.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: float32ToPcm16Base64(e.inputBuffer.getChannelData(0)) }));
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        console.log("[Audio] ScriptProcessor fallback at 24kHz (~85ms frames)");
      }
    } catch (e: any) {
      setError("Mic access failed: " + (e?.message ?? "unknown"));
      setAgentState("error");
    }
  }, []);

  const stopAudio = useCallback(() => {
    flushPlayback();
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage("stop");
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    nextPlayTime.current = 0;
  }, [flushPlayback]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    isRunning.current = false;
    agentStateRef.current = "disconnected";
    stopAudio();
    ws.current?.close();
    ws.current = null;
    setAgentState("disconnected");
  }, [stopAudio]);

  const interrupt = useCallback(() => {
    flushPlayback();
    ws.current?.readyState === WebSocket.OPEN &&
      ws.current.send(JSON.stringify({ type: "response.cancel" }));
  }, [flushPlayback]);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setError(null);
    setPartialTranscript("");
  }, []);

  const isConnected = agentState !== "disconnected" && agentState !== "error";

  return (
    <VoiceAgentContext.Provider value={{
      agentState, isConnected, conversation, partialTranscript, error,
      connect, disconnect, clearConversation, setToolHandler, interrupt,
      setCatalog, setCurrentOrder, setSquareCredentials,
    }}>
      {children}
    </VoiceAgentContext.Provider>
  );
}

export function useVoiceAgent() {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) throw new Error("useVoiceAgent must be used within VoiceAgentProvider");
  return ctx;
}
