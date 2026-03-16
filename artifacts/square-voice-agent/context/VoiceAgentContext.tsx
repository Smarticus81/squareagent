/**
 * SOTA Real-time Voice Pipeline
 * - ElevenLabs Conversational AI WebSocket (full end-to-end: VAD + STT + LLM + TTS)
 * - Web AudioWorklet for sub-10ms PCM16 capture at 16 kHz
 * - Gapless TTS playback via AudioContext precise scheduling
 * - Tool calls dispatched to registered handler (order management)
 * - No push-to-talk: ElevenLabs VAD handles turn detection
 */
import React, { createContext, useContext, useState, useRef, useCallback, ReactNode } from "react";
import { Platform } from "react-native";

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

export type ToolHandler = (
  toolName: string,
  params: Record<string, unknown>
) => Promise<string>;

interface VoiceAgentContextType {
  agentState: AgentState;
  isConnected: boolean;
  conversation: ConversationMessage[];
  partialTranscript: string;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearConversation: () => void;
  setToolHandler: (h: ToolHandler) => void;
  interrupt: () => void;
}

// ── AudioWorklet processor source (inlined as Blob URL) ───────────────────────
const WORKLET_SRC = /* js */ `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._frameSize = 1600; // 100 ms at 16 kHz
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    while (this._buf.length >= this._frameSize) {
      const frame = this._buf.splice(0, this._frameSize);
      const pcm = new Int16Array(this._frameSize);
      for (let i = 0; i < this._frameSize; i++) {
        const s = frame[i];
        pcm[i] = s >= 1 ? 32767 : s <= -1 ? -32768 : (s * 32768) | 0;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/`
    : "http://localhost:3000/";
}

function ab2b64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64ToPcmFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer as ArrayBuffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

// ── Context ────────────────────────────────────────────────────────────────────

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs for mutable audio/ws state (not re-renders)
  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playScheduleRef = useRef<number>(0); // next scheduled start time
  const playSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const ttsFormatRef = useRef<{ sampleRate: number }>({ sampleRate: 16000 });
  const toolHandlerRef = useRef<ToolHandler | null>(null);
  const convRef = useRef<ConversationMessage[]>([]);

  const setToolHandler = useCallback((h: ToolHandler) => {
    toolHandlerRef.current = h;
  }, []);

  // ── Conversation helpers ────────────────────────────────────────────────────

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    const msg: ConversationMessage = { id: genId(), role, content, timestamp: new Date() };
    setConversation(prev => {
      const next = [...prev, msg];
      convRef.current = next;
      return next;
    });
    return msg.id;
  }, []);

  const updateLastAgent = useCallback((content: string) => {
    setConversation(prev => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "agent") {
          next[i] = { ...next[i], content };
          convRef.current = next;
          return next;
        }
      }
      convRef.current = next;
      return next;
    });
  }, []);

  // ── TTS Playback ────────────────────────────────────────────────────────────

  function getPlayCtx(sampleRate: number): AudioContext {
    if (!playCtxRef.current || playCtxRef.current.state === "closed") {
      playCtxRef.current = new AudioContext({ sampleRate });
      playScheduleRef.current = 0;
    }
    return playCtxRef.current;
  }

  function scheduleAudioChunk(b64pcm: string) {
    try {
      const sr = ttsFormatRef.current.sampleRate;
      const ctx = getPlayCtx(sr);
      const f32 = b64ToPcmFloat32(b64pcm);
      const buf = ctx.createBuffer(1, f32.length, sr);
      buf.copyToChannel(f32, 0);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);

      const now = ctx.currentTime;
      const start = Math.max(playScheduleRef.current, now + 0.01);
      src.start(start);
      playScheduleRef.current = start + buf.duration;
      playSourcesRef.current.push(src);

      src.onended = () => {
        playSourcesRef.current = playSourcesRef.current.filter(s => s !== src);
        if (playSourcesRef.current.length === 0) {
          setAgentState(prev => (prev === "speaking" ? "listening" : prev));
        }
      };
    } catch (e) {
      console.error("[Audio] Playback error:", e);
    }
  }

  function stopAllAudio() {
    playSourcesRef.current.forEach(src => {
      try { src.stop(); } catch {}
    });
    playSourcesRef.current = [];
    playScheduleRef.current = 0;
  }

  // ── Mic capture ─────────────────────────────────────────────────────────────

  async function startMic(ws: WebSocket) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    micCtxRef.current = ctx;

    // Load worklet from Blob URL
    const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, "pcm-capture");
    workletNodeRef.current = worklet;

    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const b64 = ab2b64(e.data);
      ws.send(JSON.stringify({ user_audio_chunk: b64 }));
    };

    source.connect(worklet);
    worklet.connect(ctx.destination); // needed for worklet to fire
  }

  function stopMic() {
    try { workletNodeRef.current?.disconnect(); } catch {}
    try { micCtxRef.current?.close(); } catch {}
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    workletNodeRef.current = null;
    micCtxRef.current = null;
    micStreamRef.current = null;
  }

  // ── WebSocket message handler ────────────────────────────────────────────────

  function onWsMessage(ws: WebSocket, raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    const type: string = msg.type;

    switch (type) {
      case "conversation_initiation_metadata": {
        const fmt: string =
          msg.conversation_initiation_metadata_event?.agent_output_audio_format ?? "pcm_16000";
        const sr = parseInt(fmt.replace("pcm_", ""), 10) || 16000;
        ttsFormatRef.current = { sampleRate: sr };

        // Send client initiation
        ws.send(JSON.stringify({
          type: "conversation_initiation_client_data",
          conversation_config_override: {},
        }));

        setAgentState("listening");
        break;
      }

      case "audio": {
        const b64 = msg.audio_event?.audio_base_64;
        if (b64) {
          setAgentState("speaking");
          scheduleAudioChunk(b64);
        }
        break;
      }

      case "agent_response": {
        const text: string = msg.agent_response_event?.agent_response ?? "";
        if (text) {
          // Check if we already have an agent message from the current turn
          const last = convRef.current[convRef.current.length - 1];
          if (last?.role === "agent") {
            updateLastAgent(text);
          } else {
            addMessage("agent", text);
          }
        }
        break;
      }

      case "user_transcript": {
        const text: string = msg.user_transcription_event?.user_transcript ?? "";
        if (text) {
          setPartialTranscript("");
          addMessage("user", text);
        }
        break;
      }

      case "interruption": {
        stopAllAudio();
        setAgentState("listening");
        break;
      }

      case "ping": {
        const eventId = msg.ping_event?.event_id;
        ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
        break;
      }

      case "client_tool_call": {
        const call = msg.client_tool_call;
        handleToolCall(ws, call);
        break;
      }

      case "internal_tentative_agent_response":
      case "agent_response_correction":
        break;

      default:
        if (type) console.debug("[WS] unhandled:", type);
    }
  }

  // ── Tool execution ────────────────────────────────────────────────────────────

  async function handleToolCall(ws: WebSocket, call: any) {
    const { tool_name, parameters, tool_call_id } = call;
    console.log(`[Tool] ${tool_name}`, parameters);

    let result = "";
    let isError = false;

    try {
      if (toolHandlerRef.current) {
        result = await toolHandlerRef.current(tool_name, parameters ?? {});
      } else {
        result = `Tool handler not registered`;
        isError = true;
      }
    } catch (e: any) {
      result = e.message ?? "Tool execution failed";
      isError = true;
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "client_tool_result",
        tool_call_id,
        result,
        is_error: isError,
      }));
    }
  }

  // ── Connect / Disconnect ──────────────────────────────────────────────────────

  async function connect() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setError(null);
    setAgentState("connecting");

    try {
      if (Platform.OS !== "web") {
        setError("Real-time voice requires a web browser. Use the web preview.");
        setAgentState("error");
        return;
      }

      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/session`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Session failed (${res.status})`);
      }
      const { signed_url } = await res.json();

      const ws = new WebSocket(signed_url);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log("[WS] Connected to ElevenLabs");
        try {
          await startMic(ws);
        } catch (e: any) {
          setError("Microphone access denied: " + e.message);
          setAgentState("error");
          ws.close();
        }
      };

      ws.onmessage = (e) => onWsMessage(ws, e.data);

      ws.onerror = (e) => {
        console.error("[WS] Error:", e);
        setError("Connection error");
        setAgentState("error");
      };

      ws.onclose = (e) => {
        console.log("[WS] Closed:", e.code, e.reason);
        stopMic();
        stopAllAudio();
        wsRef.current = null;
        setAgentState(prev =>
          prev === "error" ? "error" : "disconnected"
        );
      };
    } catch (e: any) {
      console.error("[Connect]", e);
      setError(e.message || "Failed to connect");
      setAgentState("error");
    }
  }

  function disconnect() {
    wsRef.current?.close(1000, "User disconnected");
    wsRef.current = null;
    stopMic();
    stopAllAudio();
    setAgentState("disconnected");
    setPartialTranscript("");
  }

  function interrupt() {
    stopAllAudio();
    setAgentState("listening");
  }

  function clearConversation() {
    setConversation([]);
    convRef.current = [];
    setPartialTranscript("");
    setError(null);
  }

  const isConnected =
    agentState !== "disconnected" && agentState !== "error";

  return (
    <VoiceAgentContext.Provider
      value={{
        agentState,
        isConnected,
        conversation,
        partialTranscript,
        error,
        connect,
        disconnect,
        clearConversation,
        setToolHandler,
        interrupt,
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
