/**
 * Voice Agent Context — WebRTC direct connection to OpenAI Realtime API
 * Client connects directly to OpenAI via RTCPeerConnection. Server provides
 * ephemeral tokens and executes tool calls via REST.
 */
import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { getVoicePrefs } from "@/lib/voice-prefs";
import { getBaseUrl } from "@/lib/api";

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
  squareOrderId?: string;
}

export type CommandHandler = (commands: OrderCommand[]) => void;

export interface PendingConfirmation {
  tool_name: string;
  args: Record<string, unknown>;
  risk_level: string;
  prompt: string;
  token?: string;
  call_id: string;
}

interface VoiceAgentContextType {
  agentState: AgentState;
  isConnected: boolean;
  conversation: ConversationMessage[];
  partialTranscript: string;
  error: string | null;
  remoteStream: MediaStream | null;
  pendingConfirmation: PendingConfirmation | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearConversation: () => void;
  setToolHandler: (h: CommandHandler) => void;
  interrupt: () => void;
  setCatalog: (items: unknown[]) => void;
  setCurrentOrder: (order: unknown[]) => void;
  setAuthParams: (
    venueId: string,
    authToken: string,
    agentProfileId?: string,
    voicePipelineProvider?: string,
    voicePipelineConfig?: Record<string, unknown>,
  ) => void;
  confirmPending: () => void;
  denyPending: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

function clearStoredLaunchSession() {
  localStorage.removeItem("voycelab_token");
  localStorage.removeItem("voycelab_venue_id");
  localStorage.removeItem("voycelab_wake_phrase");
  localStorage.removeItem("voycelab_agent_profile");
  localStorage.removeItem("voycelab_agent_profile_id");
  localStorage.removeItem("square_access_token");
  localStorage.removeItem("square_location_id");
}

// A short tail lets the speaker's acoustic decay die out before the mic
// re-opens, so the agent's final syllable can't re-trigger the VAD.
const MIC_REOPEN_TAIL_MS = 250;
const GEMINI_PROVIDER_PREFIX = "google_gemini_";
const WS_INPUT_SAMPLE_RATE = 16000;
const WS_OUTPUT_SAMPLE_RATE = 24000;
const DEBUG_VOICE_EVENTS = import.meta.env.DEV;
const SENSITIVE_LOG_KEY_RE = /(token|secret|password|pass|credential|authorization|email|recipient|subject|body|message|text|query|sql|connection|string|address|phone|name)/i;

function summarizeToolArgs(args: Record<string, unknown>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_LOG_KEY_RE.test(key)) {
      summary[key] = "[redacted]";
    } else if (Array.isArray(value)) {
      summary[key] = `array(${value.length})`;
    } else if (value && typeof value === "object") {
      summary[key] = "object";
    } else {
      summary[key] = typeof value;
    }
  }
  return summary;
}

function debugVoiceLog(message: string, ...args: unknown[]): void {
  if (DEBUG_VOICE_EVENTS) console.log(message, ...args);
}

function floatToPcm16Base64(input: ArrayLike<number>): string {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat(input: string): Float32Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

// ── Context ───────────────────────────────────────────────────────────────────

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<unknown[]>([]);
  const venueIdRef = useRef("");
  const authTokenRef = useRef("");
  const agentProfileIdRef = useRef("");
  const voicePipelineProviderRef = useRef("");
  const voicePipelineConfigRef = useRef<Record<string, unknown>>({});
  const isRunning = useRef(false);
  const agentStateRef = useRef<AgentState>("disconnected");
  const sessionIdRef = useRef("");
  const sessionStartTsRef = useRef<number>(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Local mic track + duplex state for half-duplex gating during playback.
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const fullDuplexRef = useRef(false);
  const micReopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Server-relayed native audio providers (Gemini Live) use WebSocket PCM
  // frames instead of a WebRTC media track.
  const wsRef = useRef<WebSocket | null>(null);
  const wsMicStreamRef = useRef<MediaStream | null>(null);
  const wsInputCtxRef = useRef<AudioContext | null>(null);
  const wsInputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wsInputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const wsOutputCtxRef = useRef<AudioContext | null>(null);
  const wsOutputDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const wsPlaybackTimeRef = useRef(0);
  const wsPlaybackDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    setConversation((prev) => [...prev, { id: genId(), role, content, timestamp: new Date() }]);
  }, []);

  const setToolHandler = useCallback((h: CommandHandler) => { commandHandlerRef.current = h; }, []);

  const setCatalog = useCallback((items: unknown[]) => {
    catalogRef.current = items;
    // Update instructions via data channel if connected
    sendContextUpdate();
  }, []);

  const setCurrentOrder = useCallback((order: unknown[]) => {
    currentOrderRef.current = order;
    sendContextUpdate();
  }, []);

  /** Store venueId + auth JWT so realtime calls go through server-side credential lookup. */
  const setAuthParams = useCallback((
    venueId: string,
    authToken: string,
    agentProfileId?: string,
    voicePipelineProvider?: string,
    voicePipelineConfig?: Record<string, unknown>,
  ) => {
    venueIdRef.current = venueId;
    authTokenRef.current = authToken;
    agentProfileIdRef.current = agentProfileId ?? "";
    voicePipelineProviderRef.current = voicePipelineProvider ?? "";
    voicePipelineConfigRef.current = voicePipelineConfig ?? {};
  }, []);

  // ── Half-duplex mic gating ──────────────────────────────────────────────────
  // On speaker / Bluetooth the agent's own voice leaks into the mic and trips
  // the server VAD, cutting the response off after a word or two. We physically
  // gate the local mic track while the agent speaks so its audio can never reach
  // the VAD. Deliberate barge-in still works via interrupt() (tap); true
  // acoustic barge-in is opt-in per session via fullDuplexRef (server flag).

  const setMicEnabled = useCallback((enabled: boolean) => {
    const track = micTrackRef.current;
    if (track && track.enabled !== enabled) track.enabled = enabled;
  }, []);

  const cancelMicReopen = useCallback(() => {
    const timer = micReopenTimerRef.current;
    if (timer !== null) {
      clearTimeout(timer);
      micReopenTimerRef.current = null;
    }
  }, []);

  /** Mute the mic for the duration of agent playback (half-duplex modes only). */
  const gateMicForPlayback = useCallback(() => {
    if (fullDuplexRef.current) return;
    cancelMicReopen();
    setMicEnabled(false);
  }, [cancelMicReopen, setMicEnabled]);

  /** Re-open the mic after agent playback finishes, with a short decay tail. */
  const reopenMic = useCallback(() => {
    if (fullDuplexRef.current) return;
    cancelMicReopen();
    micReopenTimerRef.current = setTimeout(() => {
      setMicEnabled(true);
      micReopenTimerRef.current = null;
    }, MIC_REOPEN_TAIL_MS);
  }, [cancelMicReopen, setMicEnabled]);

  /** Re-open the mic immediately (deliberate interrupt / error recovery). */
  const reopenMicNow = useCallback(() => {
    if (fullDuplexRef.current) return;
    cancelMicReopen();
    setMicEnabled(true);
  }, [cancelMicReopen, setMicEnabled]);

  // ── Send context update to OpenAI via data channel ──────────────────────────
  // Server is authoritative for persona/instructions. Client only pushes
  // dynamic catalog/order snapshots as system-level input text items so the
  // model stays current without overwriting the server-built instructions.

  const sendContextUpdate = useCallback(() => {
    const dc = dcRef.current;
    const ws = wsRef.current;
    if ((!dc || dc.readyState !== "open") && (!ws || ws.readyState !== WebSocket.OPEN)) return;

    const catalog = catalogRef.current as Array<{ name: string; price: number; category?: string }>;
    const catalogStr =
      catalog.length > 0
        ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
        : "  (No catalog loaded)";

    const order = currentOrderRef.current as Array<{ quantity: number; item_name?: string; name?: string; price: number }>;
    const orderStr =
      order.length > 0
        ? order.map((i) => `  - ${i.quantity}x ${i.item_name ?? i.name ?? "item"} @ $${i.price.toFixed(2)}`).join("\n")
        : "  (empty)";

    const voiceConfig = voicePipelineConfigRef.current;
    const contextPayload = {
      type: "x.context_update",
      catalog: catalogRef.current,
      order: currentOrderRef.current,
      voice: typeof voiceConfig.voice === "string" ? voiceConfig.voice : undefined,
      languageCodes: Array.isArray(voiceConfig.languageCodes) ? voiceConfig.languageCodes : undefined,
      proactiveAudio: typeof voiceConfig.proactiveAudio === "boolean" ? voiceConfig.proactiveAudio : undefined,
      thinkingLevel: typeof voiceConfig.thinkingLevel === "string" ? voiceConfig.thinkingLevel : undefined,
    };

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(contextPayload));
      return;
    }

    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: `[Context update]\n\nCatalog:\n${catalogStr}\n\nCurrent order:\n${orderStr}` }],
        },
      }));
    }
  }, []);

  // ── Execute tool via server REST API ────────────────────────────────────────

  const executeToolViaServer = useCallback(async (
    toolName: string,
    args: Record<string, unknown>,
    callId: string,
  ) => {
    const dc = dcRef.current;
    const ws = wsRef.current;
    const sendToolOutput = (output: string) => {
      if (dc?.readyState === "open") {
        dc.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output,
          },
        }));
        dc.send(JSON.stringify({ type: "response.create" }));
        return true;
      }
      if (ws?.readyState === WebSocket.OPEN) {
        if (voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX)) {
          ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: [
                { id: callId, name: toolName, response: { result: output } },
              ],
            },
          }));
        } else {
          ws.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output,
            },
          }));
          ws.send(JSON.stringify({ type: "response.create" }));
        }
        return true;
      }
      return false;
    };
    if (dc?.readyState !== "open" && ws?.readyState !== WebSocket.OPEN) return;

    try {
      const baseUrl = getBaseUrl();
      const toolPath = "api/realtime/tools";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;

      const res = await fetch(`${baseUrl}${toolPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          tool_name: toolName,
          arguments: args,
          catalog: catalogRef.current,
          order: currentOrderRef.current,
          venueId: venueIdRef.current || undefined,
          agentProfileId: agentProfileIdRef.current || undefined,
        }),
      });

      const data = await res.json();
      debugVoiceLog(`[WebRTC] Tool result (${toolName}) received`);

      let parsed: any = null;
      try { parsed = JSON.parse(data.result); } catch { /* not JSON */ }

      if (parsed?.status === "REQUIRES_CONFIRMATION" && parsed.confirmation) {
        setPendingConfirmation({ ...parsed.confirmation, call_id: callId });
        sendToolOutput(`Waiting for user confirmation for ${toolName}. Tell the user you need their confirmation before proceeding.`);
        return;
      }

      sendToolOutput(data.result ?? "Tool execution failed");

      if (data.command) {
        commandHandlerRef.current?.([data.command]);
      }
    } catch (e: any) {
      console.error(`[WebRTC] Tool exec error:`, e.message);
      sendToolOutput(`Error: ${e.message}`);
    }
  }, []);

  // ── Data channel event handler ──────────────────────────────────────────────

  const scheduleWsPlaybackDone = useCallback(() => {
    if (wsPlaybackDoneTimerRef.current) {
      clearTimeout(wsPlaybackDoneTimerRef.current);
      wsPlaybackDoneTimerRef.current = null;
    }
    const ctx = wsOutputCtxRef.current;
    if (!ctx) return;
    const delayMs = Math.max(80, (wsPlaybackTimeRef.current - ctx.currentTime + 0.08) * 1000);
    wsPlaybackDoneTimerRef.current = setTimeout(() => {
      wsPlaybackDoneTimerRef.current = null;
      if (!isRunning.current || !wsRef.current) return;
      if (agentStateRef.current === "speaking") {
        reopenMic();
        agentStateRef.current = "listening";
        setAgentState("listening");
      }
    }, delayMs);
  }, [reopenMic]);

  const handleDcEvent = useCallback((raw: string) => {
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw); } catch { return; }

    const setAs = (s: AgentState) => { agentStateRef.current = s; setAgentState(s); };

    switch (event.type) {
      case "x.order_command":
        if (event.command && typeof event.command === "object") {
          commandHandlerRef.current?.([event.command as unknown as OrderCommand]);
        }
        break;

      case "x.pending_confirmation": {
        const confirmation = event.confirmation;
        if (confirmation && typeof confirmation === "object") {
          setPendingConfirmation({
            ...(confirmation as Omit<PendingConfirmation, "call_id">),
            call_id: String(event.call_id ?? ""),
          });
        }
        break;
      }

      case "session.created":
        setAs("listening");
        if (!sessionIdRef.current) sessionIdRef.current = String((event.session as any)?.id ?? Date.now());
        sendContextUpdate();
        break;

      case "session.updated":
        // Ack — no action needed
        break;

      case "input_audio_buffer.speech_started":
        // Only acoustic barge-in (full-duplex) should cancel the agent here. In
        // half-duplex the mic is gated during playback, so a speech_started while
        // "speaking" can only be residual echo — ignore it rather than self-cut.
        if (fullDuplexRef.current && agentStateRef.current === "speaking") {
          dcRef.current?.send(JSON.stringify({ type: "response.cancel" }));
          reopenMicNow();
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
        // Audio is handled natively via WebRTC media track — no manual scheduling.
        // Gate the mic on the first audio frame so the agent's voice can't echo
        // back into the VAD (no-op in full-duplex). Then mark as "speaking".
        gateMicForPlayback();
        setAs("speaking");
        break;

      case "response.done":
        if (isRunning.current) {
          const wsCtx = wsOutputCtxRef.current;
          if (
            wsRef.current &&
            wsCtx &&
            wsPlaybackTimeRef.current > wsCtx.currentTime + 0.05
          ) {
            scheduleWsPlaybackDone();
            break;
          }
          reopenMic();
          setAs("listening");
        }
        break;

      case "response.function_call_arguments.done": {
        const toolName = String(event.name ?? "");
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(event.arguments ?? "{}")); } catch {}
        const callId = String(event.call_id ?? "");
        debugVoiceLog(`[WebRTC] Tool call: ${toolName}`, summarizeToolArgs(args));
        executeToolViaServer(toolName, args, callId);
        break;
      }

      case "error": {
        const err = (event.error as Record<string, unknown>)?.message ?? event.message ?? "Realtime error";
        console.error("[WebRTC]", err);
        // Don't leave the user muted if playback errored out mid-response.
        reopenMicNow();
        setError(String(err));
        setAgentState("error");
        break;
      }
    }
  }, [addMessage, sendContextUpdate, executeToolViaServer, gateMicForPlayback, reopenMic, reopenMicNow, scheduleWsPlaybackDone]);

  const cleanupWsAudio = useCallback(() => {
    if (wsPlaybackDoneTimerRef.current) {
      clearTimeout(wsPlaybackDoneTimerRef.current);
      wsPlaybackDoneTimerRef.current = null;
    }
    try { wsInputProcessorRef.current?.disconnect(); } catch {}
    try { wsInputSourceRef.current?.disconnect(); } catch {}
    try { void wsInputCtxRef.current?.close(); } catch {}
    try { void wsOutputCtxRef.current?.close(); } catch {}
    wsMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    wsInputProcessorRef.current = null;
    wsInputSourceRef.current = null;
    wsInputCtxRef.current = null;
    wsOutputCtxRef.current = null;
    wsOutputDestinationRef.current = null;
    wsMicStreamRef.current = null;
    wsPlaybackTimeRef.current = 0;
    setRemoteStream(null);
  }, []);

  const playWsAudioDelta = useCallback((base64Pcm: string) => {
    let ctx = wsOutputCtxRef.current;
    let destination = wsOutputDestinationRef.current;
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: WS_OUTPUT_SAMPLE_RATE });
      destination = ctx.createMediaStreamDestination();
      wsOutputCtxRef.current = ctx;
      wsOutputDestinationRef.current = destination;
      setRemoteStream(destination.stream);
    }
    if (!destination) return;
    void ctx.resume().catch(() => {});
    const samples = pcm16Base64ToFloat(base64Pcm);
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, WS_OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.connect(destination);
    const startAt = Math.max(ctx.currentTime + 0.02, wsPlaybackTimeRef.current || 0);
    source.start(startAt);
    wsPlaybackTimeRef.current = startAt + buffer.duration;
    scheduleWsPlaybackDone();
  }, [scheduleWsPlaybackDone]);

  const startWsMicStreaming = useCallback(async (ws: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    wsMicStreamRef.current = stream;
    micTrackRef.current = stream.getAudioTracks()[0] ?? null;

    const inputCtx = new AudioContext({ sampleRate: WS_INPUT_SAMPLE_RATE });
    wsInputCtxRef.current = inputCtx;
    await inputCtx.resume().catch(() => {});
    const source = inputCtx.createMediaStreamSource(stream);
    const processor = inputCtx.createScriptProcessor(2048, 1, 1);
    wsInputSourceRef.current = source;
    wsInputProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!micTrackRef.current?.enabled) return;
      const input = event.inputBuffer.getChannelData(0);
      ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: floatToPcm16Base64(input),
        sample_rate: Math.round(inputCtx.sampleRate),
      }));
    };

    source.connect(processor);
    processor.connect(inputCtx.destination);
  }, []);

  const connectGeminiRelay = useCallback(async (voice: string, speed: number, baseUrl: string) => {
    const profileId = agentProfileIdRef.current;
    if (!profileId) throw new Error("Choose an assistant profile before starting Gemini Live.");

    const sessionHeaders: Record<string, string> = { "Content-Type": "application/json" };
    sessionHeaders["Authorization"] = `Bearer ${authTokenRef.current}`;
    const sessionRes = await fetch(`${baseUrl}api/v1/realtime-sessions`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        agentProfileId: profileId,
        catalog: catalogRef.current,
        order: currentOrderRef.current,
      }),
    });
    if (!sessionRes.ok) {
      const err = await sessionRes.json().catch(() => ({ detail: "Failed to start Gemini session" }));
      throw new Error(err.detail || err.error?.message || err.error || "Failed to start Gemini session");
    }

    const sessionData = await sessionRes.json();
    sessionIdRef.current = String(sessionData.sessionId ?? sessionData.id ?? `gemini-${Date.now()}`);
    fullDuplexRef.current = Boolean(sessionData.capabilities?.bargeIn);
    const handshake = sessionData.clientHandshake;
    if (handshake?.kind !== "ws_relay") {
      throw new Error("Gemini session did not return a WebSocket relay handshake.");
    }

    const payload = handshake.payload ?? {};
    const path = typeof payload.path === "string" ? payload.path : "/api/realtime/gemini";
    const wsUrl = new URL(path, `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`);
    const query = payload.query && typeof payload.query === "object" ? payload.query as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) wsUrl.searchParams.set(key, String(value));
    }
    wsUrl.searchParams.set("token", authTokenRef.current);
    if (venueIdRef.current) wsUrl.searchParams.set("venueId", venueIdRef.current);
    wsUrl.searchParams.set("agentProfileId", profileId);
    const voiceConfig = voicePipelineConfigRef.current;
    const configuredVoice =
      (typeof voiceConfig.voiceName === "string" ? voiceConfig.voiceName : undefined) ??
      (typeof voiceConfig.voice === "string" ? voiceConfig.voice : undefined) ??
      voice;
    if (configuredVoice) wsUrl.searchParams.set("voice", configuredVoice);
    if (typeof voiceConfig.proactiveAudio === "boolean") {
      wsUrl.searchParams.set("proactiveAudio", String(voiceConfig.proactiveAudio));
    }
    if (typeof voiceConfig.affectiveDialog === "boolean") {
      wsUrl.searchParams.set("affectiveDialog", String(voiceConfig.affectiveDialog));
    }
    if (typeof voiceConfig.thinkingLevel === "string") {
      wsUrl.searchParams.set("thinkingLevel", voiceConfig.thinkingLevel);
    }
    if (Array.isArray(voiceConfig.languageCodes)) {
      const languageCodes = voiceConfig.languageCodes.filter((code): code is string => typeof code === "string" && code.trim().length > 0);
      if (languageCodes.length > 0) wsUrl.searchParams.set("languageCodes", languageCodes.join(","));
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setAgentState("connecting");

    await new Promise<void>((resolve, reject) => {
      const failTimer = window.setTimeout(() => reject(new Error("Gemini relay connection timed out")), 15000);
      ws.onopen = async () => {
        window.clearTimeout(failTimer);
        isRunning.current = true;
        sessionStartTsRef.current = Date.now();
        try {
          await startWsMicStreaming(ws);
          ws.send(JSON.stringify({
            type: "x.context_update",
            catalog: catalogRef.current,
            order: currentOrderRef.current,
            voice: configuredVoice,
            speed,
            languageCodes: voiceConfig.languageCodes,
            proactiveAudio: voiceConfig.proactiveAudio,
            affectiveDialog: voiceConfig.affectiveDialog,
            thinkingLevel: voiceConfig.thinkingLevel,
          }));
          if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = setInterval(() => {
            if (!sessionIdRef.current || !sessionStartTsRef.current) return;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;
            fetch(`${getBaseUrl()}api/realtime/session/${sessionIdRef.current}/heartbeat`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                elapsedMs: Date.now() - sessionStartTsRef.current,
                venueId: venueIdRef.current || undefined,
                provider: voicePipelineProviderRef.current || "openai_realtime_webrtc",
                agentProfileId: agentProfileIdRef.current || undefined,
              }),
            }).catch(() => {});
          }, 60_000);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      ws.onerror = () => {
        window.clearTimeout(failTimer);
        reject(new Error("Gemini relay connection failed"));
      };
    });

    ws.onmessage = (event) => {
      const raw = String(event.data);
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.type === "response.audio.delta" && typeof parsed.delta === "string") {
          gateMicForPlayback();
          playWsAudioDelta(parsed.delta);
        }
      } catch {
        // Shared handler below will ignore non-JSON.
      }
      handleDcEvent(raw);
    };

    ws.onclose = () => {
      cleanupWsAudio();
      wsRef.current = null;
      if (isRunning.current) {
        isRunning.current = false;
        setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
      }
    };

    ws.onerror = () => {
      reopenMicNow();
      setError("Gemini relay connection failed");
      setAgentState("error");
    };
  }, [cleanupWsAudio, gateMicForPlayback, handleDcEvent, playWsAudioDelta, reopenMicNow, startWsMicStreaming]);

  // ── Connect via WebRTC ─────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isRunning.current) return;
    setError(null);

    if (!authTokenRef.current) {
      setError("Sign in from the VoyceLab dashboard to start your assistant.");
      setAgentState("error");
      return;
    }

    setAgentState("connecting");

    const { voice, speed } = getVoicePrefs();
    const baseUrl = getBaseUrl();

    try {
      if (voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX)) {
        await connectGeminiRelay(voice, speed, baseUrl);
        return;
      }

      // 1. Get ephemeral token from our server
      const sessionPath = "api/realtime/session";
      debugVoiceLog("[WebRTC] Requesting ephemeral token...");
      const sessionHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (authTokenRef.current) sessionHeaders["Authorization"] = `Bearer ${authTokenRef.current}`;

      const tokenRes = await fetch(`${baseUrl}${sessionPath}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          voice,
          speed,
          catalog: catalogRef.current,
          order: currentOrderRef.current,
          venueId: venueIdRef.current || undefined,
          agentProfileId: agentProfileIdRef.current || undefined,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({ error: "Failed to get session token" }));
        if (tokenRes.status === 401) {
          clearStoredLaunchSession();
          authTokenRef.current = "";
          venueIdRef.current = "";
          agentProfileIdRef.current = "";
          throw new Error("Session expired. Sign in or relaunch from the dashboard.");
        }
        throw new Error(err.detail || err.error || "Failed to get session token");
      }

      const sessionData = await tokenRes.json();
      // Extract session ID immediately to avoid race with session.created event
      if (sessionData.id) sessionIdRef.current = String(sessionData.id);
      // Server decides duplex behavior per noise mode. Default = half-duplex.
      fullDuplexRef.current = Boolean(sessionData?.voicelab?.bargeIn);
      const ephemeralKey = sessionData.client_secret?.value;
      if (!ephemeralKey) throw new Error("No ephemeral key in session response");

      debugVoiceLog("[WebRTC] Got ephemeral token, creating peer connection...");

      // 2. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Set up audio playback — remote audio track goes to an <audio> element.
      // The element is attached to the DOM (hidden) and marked playsInline so
      // the browser's echo canceller has a real render reference and iOS Safari
      // allows autoplay of the WebRTC stream.
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.setAttribute("playsinline", "true");
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;

      pc.ontrack = (e) => {
        debugVoiceLog("[WebRTC] Got remote audio track");
        audioEl.srcObject = e.streams[0];
        audioEl.play?.().catch(() => {});
        setRemoteStream(e.streams[0] ?? null);
      };

      // 4. Add local mic track. Keep a handle to the audio track so we can
      // half-duplex-gate it during agent playback (see gateMicForPlayback).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micTrackRef.current = stream.getAudioTracks()[0] ?? null;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Create data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        debugVoiceLog("[WebRTC] Data channel open");
        isRunning.current = true;
        sessionStartTsRef.current = Date.now();

        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
          if (!sessionIdRef.current || !sessionStartTsRef.current) return;
          const baseUrl = getBaseUrl();
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;
          fetch(`${baseUrl}api/realtime/session/${sessionIdRef.current}/heartbeat`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              elapsedMs: Date.now() - sessionStartTsRef.current,
              venueId: venueIdRef.current || undefined,
              provider: voicePipelineProviderRef.current || "openai_realtime_webrtc",
              agentProfileId: agentProfileIdRef.current || undefined,
            }),
          }).catch(() => {});
        }, 60_000);
      };

      dc.onmessage = (e) => handleDcEvent(e.data);

      dc.onclose = () => {
        debugVoiceLog("[WebRTC] Data channel closed");
        if (isRunning.current) {
          isRunning.current = false;
          setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
        }
      };

      // 6. Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Send offer to OpenAI, get SDP answer (GA endpoint)
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
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
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      debugVoiceLog("[WebRTC] Connection established");
    } catch (e: any) {
      console.error("[WebRTC] Connect error:", e.message);
      setError(e.message);
      setAgentState("error");
      // Cleanup on failure
      cancelMicReopen();
      pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
      micTrackRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      dcRef.current = null;
      if (audioElRef.current) {
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
        audioElRef.current = null;
      }
    }
  }, [handleDcEvent, cancelMicReopen, connectGeminiRelay]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const sendSessionEnd = useCallback(() => {
    if (!sessionIdRef.current || !sessionStartTsRef.current) return;
    const durationMs = Date.now() - sessionStartTsRef.current;
    if (durationMs <= 0) return;
    const baseUrl = getBaseUrl();
    const payload = JSON.stringify({
      durationMs,
      venueId: venueIdRef.current || undefined,
      provider: voicePipelineProviderRef.current || "openai_realtime_webrtc",
      agentProfileId: agentProfileIdRef.current || undefined,
    });
    const url = `${baseUrl}api/realtime/session/${sessionIdRef.current}/end`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;
    fetch(url, { method: "POST", headers, body: payload, keepalive: true }).catch(() => {});
  }, []);

  const disconnect = useCallback(async () => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    cancelMicReopen();

    sendSessionEnd();

    isRunning.current = false;
    agentStateRef.current = "disconnected";
    sessionStartTsRef.current = 0;

    pcRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    micTrackRef.current = null;

    dcRef.current?.close();
    dcRef.current = null;

    wsRef.current?.close();
    wsRef.current = null;
    cleanupWsAudio();

    pcRef.current?.close();
    pcRef.current = null;

    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }

    setRemoteStream(null);
    setAgentState("disconnected");
  }, [sendSessionEnd, cancelMicReopen, cleanupWsAudio]);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "response.cancel" }));
    }
    // Deliberate barge-in: re-open the mic right away so the user can speak.
    reopenMicNow();
  }, [reopenMicNow]);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setError(null);
    setPartialTranscript("");
  }, []);

  useEffect(() => {
    const handler = () => sendSessionEnd();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sendSessionEnd]);

  const isConnected = agentState !== "disconnected" && agentState !== "error";

  const confirmPending = useCallback(() => {
    const conf = pendingConfirmation;
    if (!conf) return;
    setPendingConfirmation(null);
    const dc = dcRef.current;
    const ws = wsRef.current;
    const sendToolOutput = (output: string) => {
      const payload = JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: conf.call_id, output },
      });
      const resume = JSON.stringify({ type: "response.create" });
      if (dc?.readyState === "open") {
        dc.send(payload);
        dc.send(resume);
        return true;
      }
      if (ws?.readyState === WebSocket.OPEN) {
        if (voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX)) {
          ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: [
                { id: conf.call_id, name: conf.tool_name, response: { result: output } },
              ],
            },
          }));
        } else {
          ws.send(payload);
          ws.send(resume);
        }
        return true;
      }
      return false;
    };
    if (dc?.readyState !== "open" && ws?.readyState !== WebSocket.OPEN) return;
    const baseUrl = getBaseUrl();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;
    fetch(`${baseUrl}api/realtime/tools`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionIdRef.current,
        tool_name: conf.tool_name,
        arguments: conf.args,
        confirmed: true,
        confirmationToken: conf.token,
        catalog: catalogRef.current,
        order: currentOrderRef.current,
        venueId: venueIdRef.current || undefined,
        agentProfileId: agentProfileIdRef.current || undefined,
      }),
    }).then(r => r.json()).then(data => {
      sendToolOutput(data.result ?? "Confirmed and executed.");
      if (data.command) commandHandlerRef.current?.([data.command]);
    }).catch(e => {
      sendToolOutput(`Error: ${e.message}`);
    });
  }, [pendingConfirmation]);

  const denyPending = useCallback(() => {
    const conf = pendingConfirmation;
    if (!conf) return;
    setPendingConfirmation(null);
    const dc = dcRef.current;
    const ws = wsRef.current;
    const payload = JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: conf.call_id, output: "User declined this action." },
    });
    const resume = JSON.stringify({ type: "response.create" });
    if (dc?.readyState === "open") {
      dc.send(payload);
      dc.send(resume);
    } else if (ws?.readyState === WebSocket.OPEN) {
      if (voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX)) {
        ws.send(JSON.stringify({
          toolResponse: {
            functionResponses: [
              { id: conf.call_id, name: conf.tool_name, response: { result: "User declined this action." } },
            ],
          },
        }));
      } else {
        ws.send(payload);
        ws.send(resume);
      }
    }
  }, [pendingConfirmation]);

  return (
    <VoiceAgentContext.Provider value={{
      agentState, isConnected, conversation, partialTranscript, error, remoteStream,
      pendingConfirmation, connect, disconnect, clearConversation, setToolHandler, interrupt,
      setCatalog, setCurrentOrder, setAuthParams,
      confirmPending, denyPending,
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
