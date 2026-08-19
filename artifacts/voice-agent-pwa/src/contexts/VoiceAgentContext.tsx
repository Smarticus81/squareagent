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

interface VoiceOrderSnapshotItem {
  item_id?: string;
  variationId?: string;
  name?: string;
  item_name?: string;
  price: number;
  quantity: number;
}

interface VoiceCatalogSnapshotItem {
  id?: string;
  variationId?: string;
  name: string;
  price: number;
  category?: string;
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
  /** Pre-connect a mic-gated, unmetered standby session (wake-word mode). */
  prewarm: () => Promise<void>;
  /** Promote the standby session to live (optionally with a spoken greeting), or cold-connect. */
  activate: (opts?: { greet?: boolean }) => Promise<void>;
  /** Tear down an unused standby session (leaving wake-word mode). */
  releaseStandby: () => void;
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
  /** Set the live order-handling mode applied to subsequent tool calls. */
  setOrderHandlingMode: (mode: "auto_complete" | "hold_for_review") => void;
  confirmPending: () => void;
  denyPending: () => void;
  sessionUsage: {
    used: number;
    limit: number;
    hardCap: number;
    risk: string;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

function normalizeOrderSnapshot(order: unknown[]): VoiceOrderSnapshotItem[] {
  return order.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : typeof item.item_name === "string" ? item.item_name : "";
    const quantity = Number(item.quantity ?? 0);
    const price = Number(item.price ?? 0);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [{
      item_id: typeof item.item_id === "string" ? item.item_id : typeof item.id === "string" ? item.id : undefined,
      variationId: typeof item.variationId === "string" ? item.variationId : undefined,
      name,
      item_name: name,
      price: Number.isFinite(price) ? price : 0,
      quantity,
    }];
  });
}

function applyOrderCommandToSnapshot(
  order: VoiceOrderSnapshotItem[],
  command: OrderCommand,
  catalog: VoiceCatalogSnapshotItem[],
): VoiceOrderSnapshotItem[] {
  if (command.action === "clear" || command.action === "submit") return [];

  const quantity = Math.max(1, Number(command.quantity ?? 1));
  const commandName = (command.item_name ?? "").toLowerCase();
  const catalogMatch = catalog.find((item) => command.item_id && item.id === command.item_id)
    ?? catalog.find((item) => item.name.toLowerCase() === commandName)
    ?? catalog.find((item) => item.name.toLowerCase().includes(commandName) || commandName.includes(item.name.toLowerCase()));
  const itemName = catalogMatch?.name ?? command.item_name;
  if (!itemName) return order;

  const matchesCommand = (item: VoiceOrderSnapshotItem) => {
    const itemId = item.item_id;
    const name = (item.item_name ?? item.name ?? "").toLowerCase();
    return Boolean(command.item_id && itemId === command.item_id)
      || name === itemName.toLowerCase()
      || name.includes(itemName.toLowerCase())
      || itemName.toLowerCase().includes(name);
  };

  if (command.action === "add") {
    const existing = order.find(matchesCommand);
    if (existing) {
      return order.map((item) => matchesCommand(item) ? { ...item, quantity: item.quantity + quantity } : item);
    }
    return [...order, {
      item_id: command.item_id ?? catalogMatch?.id,
      variationId: catalogMatch?.variationId,
      name: itemName,
      item_name: itemName,
      price: Number(command.price ?? catalogMatch?.price ?? 0),
      quantity,
    }];
  }

  if (command.action === "remove") {
    return order.flatMap((item) => {
      if (!matchesCommand(item)) return [item];
      const nextQuantity = item.quantity - quantity;
      return nextQuantity > 0 ? [{ ...item, quantity: nextQuantity }] : [];
    });
  }

  return order;
}

function clearStoredLaunchSession() {
  localStorage.removeItem("voycelab_token");
  localStorage.removeItem("voycelab_venue_id");
  localStorage.removeItem("voycelab_wake_phrase");
  localStorage.removeItem("voycelab_wake_mode");
  localStorage.removeItem("voycelab_agent_profile");
  localStorage.removeItem("voycelab_agent_profile_id");
  localStorage.removeItem("square_access_token");
  localStorage.removeItem("square_location_id");
}

// A short tail lets the speaker's acoustic decay die out before the mic
// re-opens, so the agent's final syllable can't re-trigger the VAD.
const MIC_REOPEN_TAIL_MS = 250;
// Hot-standby: while the app sits in wake-word mode we keep a pre-connected,
// mic-gated Realtime session warm so wake-word activation (and the spoken
// greeting) starts in milliseconds instead of paying the token-mint + WebRTC
// handshake. Recycle it periodically so it never hits OpenAI's session age
// limit and its instructions stay fresh. No voice minutes are metered while
// in standby — heartbeats only start at activation.
const STANDBY_MAX_AGE_MS = 8 * 60_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8_000;
const STALL_SILENCE_MS = 45_000;
const STALL_SPEAKING_MS = 12_000;
const LIVE_SESSION_ROTATE_MS = 7 * 60_000;
// Fallback only — the server returns the authoritative greeting instruction.
const DEFAULT_GREETING_INSTRUCTIONS =
  "The user just summoned you with your wake phrase. Immediately say one short, warm greeting (under eight words), then stop speaking and wait for their request.";
const GEMINI_PROVIDER_PREFIX = "google_gemini_";
const OPENAI_SERVER_WS_PROVIDER = "openai_realtime_server_ws";
const XAI_REALTIME_WS_PROVIDER = "xai_grok_realtime_ws";
const GEMINI_INPUT_SAMPLE_RATE = 16000;
const OPENAI_RELAY_INPUT_SAMPLE_RATE = 24000;
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
  const [sessionUsage, setSessionUsage] = useState<VoiceAgentContextType["sessionUsage"]>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<VoiceOrderSnapshotItem[]>([]);
  const venueIdRef = useRef("");
  const authTokenRef = useRef("");
  const agentProfileIdRef = useRef("");
  const voicePipelineProviderRef = useRef("");
  const voicePipelineConfigRef = useRef<Record<string, unknown>>({});
  const orderHandlingModeRef = useRef<"auto_complete" | "hold_for_review">("auto_complete");
  const isRunning = useRef(false);
  const agentStateRef = useRef<AgentState>("disconnected");
  const sessionIdRef = useRef("");
  const logicalSessionIdRef = useRef("");
  const sessionStartTsRef = useRef<number>(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInitiatedDisconnectRef = useRef(false);
  const iceRestartAttemptedRef = useRef(false);
  const lastInboundAtRef = useRef(0);
  const stallWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ephemeralExpiresAtRef = useRef<number>(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Hot-standby session state (pre-connected while in wake-word mode).
  const standbyRef = useRef(false);            // connection is warm but mic-gated + unmetered
  const wantStandbyRef = useRef(false);        // app wants a standby kept warm (wake-word mode)
  const prewarmingRef = useRef(false);         // prewarm handshake in flight
  const activatingStandbyRef = useRef(false);  // real mic attachment in flight
  const standbySessionCreatedRef = useRef(false);
  const pendingActivationRef = useRef<{ greet: boolean } | null>(null);
  const greetingRef = useRef("");              // server-built greeting instruction
  const standbyExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const standbyRecycleRef = useRef<() => void>(() => {});
  const closeTransportRef = useRef<() => void>(() => {});
  const connectInternalRef = useRef<(standby: boolean) => Promise<void>>(async () => {});
  // Local mic track + duplex state for half-duplex gating during playback.
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const standbyAudioCtxRef = useRef<AudioContext | null>(null);
  const standbyOscillatorRef = useRef<OscillatorNode | null>(null);
  const standbyTrackRef = useRef<MediaStreamTrack | null>(null);
  const realtimeAudioSenderRef = useRef<RTCRtpSender | null>(null);
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

  // ── Response lifecycle guard ─────────────────────────────────────────────────
  // The Realtime API allows only one in-flight response per conversation. Sending
  // `response.create` while one is active throws "Conversation already has an
  // active response in progress". We track the active response and coalesce any
  // overlapping requests into a single pending one that flushes on response.done.
  const activeResponseRef = useRef(false);
  const pendingResponseRef = useRef<Record<string, unknown> | null>(null);

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
    currentOrderRef.current = normalizeOrderSnapshot(order);
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

  /** Live order-handling override sent with each tool call (auto-complete vs hold-for-review). */
  const setOrderHandlingMode = useCallback((mode: "auto_complete" | "hold_for_review") => {
    orderHandlingModeRef.current = mode === "hold_for_review" ? "hold_for_review" : "auto_complete";
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

  const stopStandbyAudio = useCallback(() => {
    try { standbyOscillatorRef.current?.stop(); } catch {}
    try { standbyOscillatorRef.current?.disconnect(); } catch {}
    try { standbyTrackRef.current?.stop(); } catch {}
    try { void standbyAudioCtxRef.current?.close(); } catch {}
    standbyOscillatorRef.current = null;
    standbyTrackRef.current = null;
    standbyAudioCtxRef.current = null;
  }, []);

  const createStandbyAudioTrack = useCallback(() => {
    stopStandbyAudio();
    const ctx = new AudioContext();
    const destination = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    const oscillator = ctx.createOscillator();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    standbyAudioCtxRef.current = ctx;
    standbyOscillatorRef.current = oscillator;
    standbyTrackRef.current = destination.stream.getAudioTracks()[0] ?? null;
    return standbyTrackRef.current;
  }, [stopStandbyAudio]);

  const openLiveMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("No microphone audio track available");
    }
    return { stream, track };
  }, []);

  // ── Send context update to OpenAI via data channel ──────────────────────────
  // Server is authoritative for persona/instructions. Client only pushes
  // dynamic catalog/order snapshots as system-level input text items so the
  // model stays current without overwriting the server-built instructions.

  const sendContextUpdate = useCallback(() => {
    const dc = dcRef.current;
    const ws = wsRef.current;
    if ((!dc || dc.readyState !== "open") && (!ws || ws.readyState !== WebSocket.OPEN)) return;

    const catalog = catalogRef.current as Array<{ name: string; price: number; category?: string }>;
    const menuLoaded = catalog.length > 0;
    const catalogStr = menuLoaded
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
      : "  (No menu loaded — you cannot see any items.)";
    // Explicitly flip the order-taking guard as the menu loads/unloads mid-session,
    // so a menu that arrives after connect lifts the initial "MENU NOT AVAILABLE"
    // block (and a menu that goes away re-arms it).
    const menuStatus = menuLoaded
      ? "MENU AVAILABLE: the menu is now loaded. You can take orders normally, using only the items and prices listed above."
      : "MENU NOT AVAILABLE: you cannot see the menu. Do NOT take orders, add items, quote prices, or name specific items — tell the user to sign in and connect Square from the dashboard first, and never pretend an item was added.";

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
          content: [{ type: "input_text", text: `[Context update]\n\n${menuStatus}\n\nCatalog:\n${catalogStr}\n\nCurrent order:\n${orderStr}` }],
        },
      }));
    }
  }, []);

  // ── Guarded response.create ─────────────────────────────────────────────────
  // Routes every OpenAI `response.create` through a single-flight guard so we
  // never collide with an in-progress response. Gemini WS uses a different
  // tool-response protocol and must not receive `response.create`.
  const requestResponse = useCallback((response?: Record<string, unknown>) => {
    const dc = dcRef.current;
    const ws = wsRef.current;
    const isGeminiWs =
      ws?.readyState === WebSocket.OPEN &&
      voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX);
    if (isGeminiWs) return;

    if (activeResponseRef.current) {
      // Coalesce overlapping requests into one. An instruction-bearing request
      // (e.g. the greeting) takes precedence over a plain continuation.
      pendingResponseRef.current = response ?? pendingResponseRef.current ?? {};
      return;
    }

    const payload = JSON.stringify(
      response ? { type: "response.create", response } : { type: "response.create" },
    );
    if (dc?.readyState === "open") {
      dc.send(payload);
      activeResponseRef.current = true;
      return;
    }
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
      activeResponseRef.current = true;
    }
  }, []);

  const applyServerOrderCommand = useCallback((command: OrderCommand) => {
    currentOrderRef.current = applyOrderCommandToSnapshot(
      currentOrderRef.current,
      command,
      catalogRef.current as VoiceCatalogSnapshotItem[],
    );
    sendContextUpdate();
    commandHandlerRef.current?.([command]);
  }, [sendContextUpdate]);

  /** Clear response-guard state. Called on cancel/teardown so the next turn isn't blocked. */
  const resetResponseGuard = useCallback(() => {
    activeResponseRef.current = false;
    pendingResponseRef.current = null;
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
        requestResponse();
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
          requestResponse();
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
          session_id: logicalSessionIdRef.current || sessionIdRef.current,
          call_id: callId,
          tool_name: toolName,
          arguments: args,
          catalog: catalogRef.current,
          order: currentOrderRef.current,
          venueId: venueIdRef.current || undefined,
          agentProfileId: agentProfileIdRef.current || undefined,
          orderHandlingMode: orderHandlingModeRef.current,
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

      if (data.command) {
        applyServerOrderCommand(data.command);
      }

      sendToolOutput(data.result ?? "Tool execution failed");
    } catch (e: any) {
      console.error(`[WebRTC] Tool exec error:`, e.message);
      sendToolOutput(`Error: ${e.message}`);
    }
  }, [applyServerOrderCommand, requestResponse]);

  // ── Standby / activation helpers ────────────────────────────────────────────

  const startHeartbeat = useCallback(() => {
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
  }, []);

  /** Fire the spoken wake greeting. Instruction text is server-built. */
  const sendGreeting = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState !== "open") return;
    requestResponse({ instructions: greetingRef.current || DEFAULT_GREETING_INSTRUCTIONS });
  }, [requestResponse]);

  const clearStandbyExpire = useCallback(() => {
    if (standbyExpireTimerRef.current) {
      clearTimeout(standbyExpireTimerRef.current);
      standbyExpireTimerRef.current = null;
    }
  }, []);

  const scheduleStandbyExpire = useCallback(() => {
    clearStandbyExpire();
    standbyExpireTimerRef.current = setTimeout(() => {
      standbyExpireTimerRef.current = null;
      standbyRecycleRef.current();
    }, STANDBY_MAX_AGE_MS);
  }, [clearStandbyExpire]);

  /** Promote the warm standby connection to a live, metered session. */
  const finishActivation = useCallback(async (greet: boolean) => {
    if (activatingStandbyRef.current) return;
    activatingStandbyRef.current = true;
    try {
      debugVoiceLog("[WebRTC] Standby session activated");
      setError(null);

      const { track } = await openLiveMic();
      const sender = realtimeAudioSenderRef.current;
      if (!sender) throw new Error("Standby audio sender is unavailable");
      await sender.replaceTrack(track);
      stopStandbyAudio();
      micTrackRef.current = track;

      standbyRef.current = false;
      pendingActivationRef.current = null;
      clearStandbyExpire();
      sessionStartTsRef.current = Date.now();
      startHeartbeat();
      setMicEnabled(true);
      agentStateRef.current = "listening";
      setAgentState("listening");
      if (greet) sendGreeting();
    } catch (e: any) {
      console.warn("[WebRTC] Standby activation failed:", e?.message ?? e);
      pendingActivationRef.current = null;
      standbyRef.current = false;
      closeTransportRef.current();
      await connectInternalRef.current(false);
    } finally {
      activatingStandbyRef.current = false;
    }
  }, [clearStandbyExpire, openLiveMic, sendGreeting, setMicEnabled, startHeartbeat, stopStandbyAudio]);

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
    lastInboundAtRef.current = Date.now();
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

      case "session.created": {
        if (!sessionIdRef.current) sessionIdRef.current = String((event.session as any)?.id ?? Date.now());
        sendContextUpdate();
        if (standbyRef.current) {
          standbySessionCreatedRef.current = true;
          // Warm standby — stay silent and unmetered. If the wake word fired
          // mid-handshake, finish the activation now.
          if (pendingActivationRef.current) void finishActivation(pendingActivationRef.current.greet);
          break;
        }
        setAs("listening");
        const pending = pendingActivationRef.current;
        pendingActivationRef.current = null;
        if (pending?.greet) sendGreeting();
        break;
      }

      case "session.updated":
        // Ack — no action needed
        break;

      case "input_audio_buffer.speech_started":
        // Only acoustic barge-in (full-duplex) should cancel the agent here. In
        // half-duplex the mic is gated during playback, so a speech_started while
        // "speaking" can only be residual echo — ignore it rather than self-cut.
        if (fullDuplexRef.current && agentStateRef.current === "speaking") {
          dcRef.current?.send(JSON.stringify({ type: "response.cancel" }));
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "response.cancel" }));
          }
          // The cancelled response will emit response.done, but drop any queued
          // continuation now so the barge-in turn starts clean.
          pendingResponseRef.current = null;
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

      case "response.created":
        activeResponseRef.current = true;
        break;

      case "response.done": {
        activeResponseRef.current = false;
        // A continuation was requested while this response was in flight (e.g. a
        // tool result returned mid-response). Flush it now that the slot is free.
        if (pendingResponseRef.current) {
          const queued = pendingResponseRef.current;
          pendingResponseRef.current = null;
          requestResponse(Object.keys(queued).length ? queued : undefined);
          break;
        }
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
      }

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
        const errCode = String((event.error as Record<string, unknown>)?.code ?? "");
        const errText = String(err);
        // Benign race: we tried to create a response while one was already
        // active. The guard normally prevents this, but the server can also
        // auto-create responses. Re-sync our flag and recover silently instead
        // of tearing the session down with a red error banner.
        if (
          errCode === "conversation_already_has_active_response" ||
          /active response in progress/i.test(errText)
        ) {
          activeResponseRef.current = true;
          console.warn("[WebRTC] Ignored duplicate response.create:", errText);
          break;
        }
        if (standbyRef.current) {
          // Idle standby errors never surface to the user; activation falls
          // back to a cold connect if the session is actually dead.
          console.warn("[WebRTC] Standby session error:", err);
          break;
        }
        console.error("[WebRTC]", err);
        // Don't leave the user muted if playback errored out mid-response.
        reopenMicNow();
        setError(String(err));
        setAgentState("error");
        break;
      }
    }
  }, [addMessage, sendContextUpdate, executeToolViaServer, gateMicForPlayback, reopenMic, reopenMicNow, scheduleWsPlaybackDone, finishActivation, sendGreeting, requestResponse]);

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

  /** Tear down all transport resources (WebRTC, WS, audio) without touching usage metering. */
  const closeTransport = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    cancelMicReopen();
    resetResponseGuard();
    isRunning.current = false;

    pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    micTrackRef.current = null;
    realtimeAudioSenderRef.current = null;
    standbySessionCreatedRef.current = false;
    stopStandbyAudio();

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
  }, [cancelMicReopen, cleanupWsAudio, stopStandbyAudio, resetResponseGuard]);

  closeTransportRef.current = closeTransport;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearStallWatchdog = useCallback(() => {
    if (stallWatchdogRef.current) {
      clearInterval(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback((reason: string) => {
    if (userInitiatedDisconnectRef.current || standbyRef.current) return;
    if (reconnectAttemptRef.current >= RECONNECT_MAX_ATTEMPTS) {
      setError("Connection lost after several tries. Tap the wave to reconnect.");
      setAgentState("error");
      return;
    }
    clearReconnectTimer();
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    reconnectAttemptRef.current += 1;
    debugVoiceLog(`[WebRTC] Scheduling reconnect (${reason}) attempt ${attempt + 1} in ${delay}ms`);
    setAgentState("connecting");
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectInternalRef.current(false);
    }, delay);
  }, [clearReconnectTimer]);

  const startStallWatchdog = useCallback(() => {
    clearStallWatchdog();
    lastInboundAtRef.current = Date.now();
    stallWatchdogRef.current = setInterval(() => {
      if (!isRunning.current || standbyRef.current) return;
      const threshold = agentStateRef.current === "speaking" ? STALL_SPEAKING_MS : STALL_SILENCE_MS;
      if (Date.now() - lastInboundAtRef.current > threshold) {
        debugVoiceLog("[WebRTC] Stall watchdog triggered");
        closeTransportRef.current?.();
        scheduleReconnect("stall");
      }
    }, 5_000);
  }, [clearStallWatchdog, scheduleReconnect]);

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

  const startWsMicStreaming = useCallback(async (ws: WebSocket, inputSampleRate: number) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    wsMicStreamRef.current = stream;
    micTrackRef.current = stream.getAudioTracks()[0] ?? null;

    const inputCtx = new AudioContext({ sampleRate: inputSampleRate });
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

  const connectRelaySession = useCallback(async (voice: string, speed: number, baseUrl: string) => {
    const profileId = agentProfileIdRef.current;
    const provider = voicePipelineProviderRef.current;
    const isGemini = provider.startsWith(GEMINI_PROVIDER_PREFIX);
    if (!profileId) throw new Error("Choose an assistant profile before starting this voice engine.");

    const sessionHeaders: Record<string, string> = { "Content-Type": "application/json" };
    sessionHeaders["Authorization"] = `Bearer ${authTokenRef.current}`;
    const sessionRes = await fetch(`${baseUrl}api/v1/realtime/sessions`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        agentProfileId: profileId,
        catalog: catalogRef.current,
        order: currentOrderRef.current,
      }),
    });
    if (!sessionRes.ok) {
      const err = await sessionRes.json().catch(() => ({ detail: "Failed to start voice session" }));
      throw new Error(err.detail || err.error?.message || err.error || "Failed to start voice session");
    }

    const sessionData = await sessionRes.json();
    sessionIdRef.current = String(sessionData.sessionId ?? sessionData.id ?? `gemini-${Date.now()}`);
    fullDuplexRef.current = Boolean(sessionData.capabilities?.bargeIn);
    const handshake = sessionData.clientHandshake;
    if (handshake?.kind !== "ws_relay") {
      throw new Error("Voice session did not return a WebSocket relay handshake.");
    }

    const payload = handshake.payload ?? {};
    const path = typeof payload.path === "string" ? payload.path : "/api/realtime/gemini";
    const wsUrl = new URL(path, `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`);
    const query = payload.query && typeof payload.query === "object" ? payload.query as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) wsUrl.searchParams.set(key, String(value));
    }
    if (venueIdRef.current) wsUrl.searchParams.set("venueId", venueIdRef.current);
    wsUrl.searchParams.set("agentProfileId", profileId);
    const voiceConfig = voicePipelineConfigRef.current;
    const configuredVoice =
      (typeof voiceConfig.voiceName === "string" ? voiceConfig.voiceName : undefined) ??
      (typeof voiceConfig.voice === "string" ? voiceConfig.voice : undefined) ??
      voice;
    if (configuredVoice) wsUrl.searchParams.set("voice", configuredVoice);
    if (Number.isFinite(speed)) wsUrl.searchParams.set("speed", String(speed));
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

    const ws = new WebSocket(wsUrl, ["voycelab-auth", `jwt.${authTokenRef.current}`]);
    wsRef.current = ws;
    setAgentState("connecting");

    // The relay reports fatal setup failures (provider key missing, upstream
    // provider rejected the connection) as a single {type:"error"} frame
    // followed by an immediate close. That frame and the close can land while
    // onopen is still awaiting mic setup, so both handlers must be attached
    // before the open await — otherwise the error is dropped, ws.send() hits a
    // closed socket, and the UI hangs on "connecting" with no message.
    let relaySetupError: string | null = null;
    const captureRelayError = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.type === "error") {
          const message = (parsed.error as Record<string, unknown> | undefined)?.message ?? parsed.message;
          if (typeof message === "string" && message) relaySetupError = message;
        }
      } catch {
        // Not JSON — ignore during connect.
      }
    };

    await new Promise<void>((resolve, reject) => {
      const failTimer = window.setTimeout(() => reject(new Error("Voice relay connection timed out")), 15000);
      ws.onmessage = (event) => captureRelayError(String(event.data));
      ws.onclose = (event) => {
        window.clearTimeout(failTimer);
        reject(new Error(relaySetupError || event.reason || "Voice relay connection closed before the session started"));
      };
      ws.onopen = async () => {
        window.clearTimeout(failTimer);
        isRunning.current = true;
        sessionStartTsRef.current = Date.now();
        try {
          await startWsMicStreaming(ws, isGemini ? GEMINI_INPUT_SAMPLE_RATE : OPENAI_RELAY_INPUT_SAMPLE_RATE);
          if (ws.readyState !== WebSocket.OPEN) {
            throw new Error(relaySetupError || "Voice relay connection closed before the session started");
          }
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
          startHeartbeat();
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      ws.onerror = () => {
        window.clearTimeout(failTimer);
        reject(new Error(relaySetupError || "Voice relay connection failed"));
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
      setError("Voice relay connection failed");
      setAgentState("error");
    };
  }, [cleanupWsAudio, gateMicForPlayback, handleDcEvent, playWsAudioDelta, reopenMicNow, startWsMicStreaming, startHeartbeat]);

  // ── Connect via WebRTC ─────────────────────────────────────────────────────
  // standby=true establishes a warm, mic-gated, unmetered connection (wake-word
  // mode). standby=false is a normal live connect.

  const connectInternal = useCallback(async (standby: boolean) => {
    if (isRunning.current) return;
    if (!standby) setError(null);

    if (!authTokenRef.current) {
      if (standby) { standbyRef.current = false; return; }
      setError("Sign in from the VoyceLab dashboard to start your assistant.");
      setAgentState("error");
      return;
    }

    if (!standby) setAgentState("connecting");
    if (!standby) userInitiatedDisconnectRef.current = false;

    const { voice, speed } = getVoicePrefs();
    const baseUrl = getBaseUrl();

    try {
      if (
        voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX) ||
        voicePipelineProviderRef.current === OPENAI_SERVER_WS_PROVIDER ||
        voicePipelineProviderRef.current === XAI_REALTIME_WS_PROVIDER
      ) {
        if (standby) { standbyRef.current = false; return; }
        await connectRelaySession(voice, speed, baseUrl);
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
      if (sessionData?.voicelab?.usage) {
        setSessionUsage(sessionData.voicelab.usage);
      } else {
        setSessionUsage(null);
      }
      // Extract session ID immediately to avoid race with session.created event
      if (sessionData.id) sessionIdRef.current = String(sessionData.id);
      if (sessionData?.voicelab?.logicalSessionId) {
        logicalSessionIdRef.current = String(sessionData.voicelab.logicalSessionId);
      } else if (!logicalSessionIdRef.current) {
        logicalSessionIdRef.current = sessionIdRef.current;
      }
      if (sessionData?.voicelab?.ephemeralExpiresAt) {
        ephemeralExpiresAtRef.current = new Date(sessionData.voicelab.ephemeralExpiresAt).getTime();
      }
      if (sessionData?.voicelab?.sessionRotateRecommendedMs) {
        const rotateMs = Number(sessionData.voicelab.sessionRotateRecommendedMs) || LIVE_SESSION_ROTATE_MS;
        if (liveRotationTimerRef.current) clearTimeout(liveRotationTimerRef.current);
        liveRotationTimerRef.current = setTimeout(() => {
          if (!isRunning.current || standbyRef.current) return;
          debugVoiceLog("[WebRTC] Proactive session rotation");
          closeTransportRef.current?.();
          scheduleReconnect("rotation");
        }, rotateMs);
      }
      // Server decides duplex behavior per noise mode. Default = half-duplex.
      fullDuplexRef.current = Boolean(sessionData?.voicelab?.bargeIn);
      // Server-authoritative wake greeting (fired via response.create on activation).
      greetingRef.current = typeof sessionData.greeting === "string" && sessionData.greeting
        ? sessionData.greeting
        : DEFAULT_GREETING_INSTRUCTIONS;
      const ephemeralKey = sessionData.client_secret?.value;
      if (!ephemeralKey) throw new Error("No ephemeral key in session response");

      debugVoiceLog("[WebRTC] Got ephemeral token, creating peer connection...");

      // 2. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // A half-dead connection (media stalls, DC still "open") would otherwise
      // leave the UI on "Listening" forever with no recovery path.
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (pcRef.current !== pc) return;
        if (state === "connected") {
          iceRestartAttemptedRef.current = false;
          reconnectAttemptRef.current = 0;
          return;
        }
        if (state === "disconnected" && !iceRestartAttemptedRef.current) {
          iceRestartAttemptedRef.current = true;
          try { pc.restartIce(); } catch { /* ignore */ }
          return;
        }
        if (state === "failed" || state === "disconnected") {
          if (standbyRef.current) return;
          debugVoiceLog(`[WebRTC] Connection ${state} mid-session`);
          closeTransportRef.current?.();
          scheduleReconnect(`pc_${state}`);
        }
      };

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

      // 4. Add the outgoing audio track. Live sessions use the real mic.
      // Standby sessions use generated silence so Web Speech can keep owning
      // the microphone for wake-word detection; activation swaps in the mic.
      if (standby) {
        const silentTrack = createStandbyAudioTrack();
        if (!silentTrack) throw new Error("Could not create standby audio track");
        realtimeAudioSenderRef.current = pc.addTrack(silentTrack, new MediaStream([silentTrack]));
      } else {
        const { stream, track } = await openLiveMic();
        micTrackRef.current = track;
        realtimeAudioSenderRef.current = pc.addTrack(track, stream);
      }

      // 5. Create data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        debugVoiceLog("[WebRTC] Data channel open");
        isRunning.current = true;
        if (standbyRef.current) {
          // Warm standby: no metering until activation; recycle before the
          // session hits OpenAI's age limit so it's always fresh.
          scheduleStandbyExpire();
        } else {
          sessionStartTsRef.current = Date.now();
          startHeartbeat();
          startStallWatchdog();
          reconnectAttemptRef.current = 0;
        }
      };

      dc.onmessage = (e) => handleDcEvent(e.data);

      dc.onclose = () => {
        debugVoiceLog("[WebRTC] Data channel closed");
        const wasStandby = standbyRef.current;
        if (isRunning.current) {
          isRunning.current = false;
          if (!wasStandby) setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
        }
        if (wasStandby) {
          setTimeout(() => standbyRecycleRef.current(), 500);
        } else if (isRunning.current) {
          closeTransportRef.current?.();
          scheduleReconnect("dc_close");
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

      debugVoiceLog(standby ? "[WebRTC] Standby connection established" : "[WebRTC] Connection established");
    } catch (e: any) {
      if (standby) {
        // Silent failure — the wake orb stays up; activation falls back to a
        // cold connect if the user speaks the wake word anyway.
        console.warn("[WebRTC] Standby connect failed:", e.message);
        standbyRef.current = false;
      } else {
        console.error("[WebRTC] Connect error:", e.message);
        setError(e.message);
        setAgentState("error");
        pendingActivationRef.current = null;
      }
      // Cleanup on failure
      isRunning.current = false;
      cancelMicReopen();
      pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
      micTrackRef.current = null;
      realtimeAudioSenderRef.current = null;
      stopStandbyAudio();
      pcRef.current?.close();
      pcRef.current = null;
      dcRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      cleanupWsAudio();
      if (audioElRef.current) {
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
        audioElRef.current = null;
      }
    }
  }, [handleDcEvent, cancelMicReopen, cleanupWsAudio, connectRelaySession, createStandbyAudioTrack, openLiveMic, scheduleStandbyExpire, startHeartbeat, startStallWatchdog, scheduleReconnect, stopStandbyAudio]);

  connectInternalRef.current = connectInternal;

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
    userInitiatedDisconnectRef.current = true;
    clearReconnectTimer();
    clearStallWatchdog();
    if (liveRotationTimerRef.current) {
      clearTimeout(liveRotationTimerRef.current);
      liveRotationTimerRef.current = null;
    }
    wantStandbyRef.current = false;
    standbyRef.current = false;
    pendingActivationRef.current = null;
    clearStandbyExpire();

    sendSessionEnd();

    agentStateRef.current = "disconnected";
    sessionStartTsRef.current = 0;

    closeTransport();
    setAgentState("disconnected");
    setSessionUsage(null);
  }, [sendSessionEnd, clearStandbyExpire, closeTransport]);

  // ── Standby lifecycle (wake-word mode) ──────────────────────────────────────

  /** Pre-connect a warm, mic-gated, unmetered session so wake-word activation is near-instant. */
  const prewarm = useCallback(async () => {
    if (!authTokenRef.current) return;
    // Only the browser-direct OpenAI WebRTC pipeline supports hot standby.
    if (voicePipelineProviderRef.current.startsWith(GEMINI_PROVIDER_PREFIX)) return;
    if (voicePipelineProviderRef.current === XAI_REALTIME_WS_PROVIDER) return;
    if (isRunning.current || pcRef.current || prewarmingRef.current) return;
    wantStandbyRef.current = true;
    prewarmingRef.current = true;
    standbyRef.current = true;
    standbySessionCreatedRef.current = false;
    debugVoiceLog("[WebRTC] Pre-warming standby session...");
    try {
      await connectInternal(true);
    } finally {
      prewarmingRef.current = false;
      if (!pcRef.current) {
        standbyRef.current = false;
        // The wake word may have fired while the failed prewarm was in flight —
        // don't leave the user hanging; fall back to a cold connect.
        if (pendingActivationRef.current) void connectInternal(false);
      }
    }
  }, [connectInternal]);

  /** Promote the standby session to live (wake word / tap), or cold-connect if none. */
  const activate = useCallback(async (opts?: { greet?: boolean }) => {
    const greet = opts?.greet ?? true;
    wantStandbyRef.current = false;
    if (isRunning.current && !standbyRef.current) return; // already live

    if (standbyRef.current && dcRef.current?.readyState === "open" && standbySessionCreatedRef.current) {
      await finishActivation(greet);
      return;
    }

    pendingActivationRef.current = { greet };

    if (standbyRef.current || prewarmingRef.current) {
      // Prewarm handshake still in flight — session.created finishes the
      // activation. Safety net: if the handshake silently died, cold-connect.
      agentStateRef.current = "connecting";
      setAgentState("connecting");
      setTimeout(() => {
        if (pendingActivationRef.current && !pcRef.current && !prewarmingRef.current && !isRunning.current) {
          standbyRef.current = false;
          void connectInternal(false);
        }
      }, 1500);
      return;
    }

    await connectInternal(false);
  }, [finishActivation, connectInternal]);

  /** Drop an unused standby session (leaving wake-word mode). Nothing was metered. */
  const releaseStandby = useCallback(() => {
    wantStandbyRef.current = false;
    if (!standbyRef.current) return;
    debugVoiceLog("[WebRTC] Releasing standby session");
    standbyRef.current = false;
    pendingActivationRef.current = null;
    clearStandbyExpire();
    closeTransport();
    agentStateRef.current = "disconnected";
    sessionStartTsRef.current = 0;
  }, [clearStandbyExpire, closeTransport]);

  // Recycle a stale/dropped standby connection and re-warm if still wanted.
  // Kept in a ref so the dc.onclose handler and the expiry timer (created
  // inside connectInternal, defined earlier) can reach it without a cycle.
  standbyRecycleRef.current = () => {
    if (isRunning.current && !standbyRef.current) return; // live session — leave it alone
    clearStandbyExpire();
    closeTransport();
    standbyRef.current = false;
    if (pendingActivationRef.current) {
      // The wake word landed just as the standby died — cold-connect now so
      // the user isn't left talking to a dead session.
      void connectInternal(false);
      return;
    }
    if (wantStandbyRef.current) void prewarm();
  };

  const connect = useCallback(async () => {
    // A tap while a standby session is warming/warm should consume it rather
    // than no-op against isRunning (which would leave the mic gated).
    if (standbyRef.current || prewarmingRef.current) {
      await activate({ greet: false });
      return;
    }
    await connectInternal(false);
  }, [activate, connectInternal]);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "response.cancel" }));
    }
    // Drop any queued continuation; the cancelled response emits response.done
    // which clears the active flag.
    pendingResponseRef.current = null;
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
    // iOS Safari often skips beforeunload; pagehide is the reliable signal
    // there. The server dedupes, so both firing is harmless.
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
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
      if (dc?.readyState === "open") {
        dc.send(payload);
        requestResponse();
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
          requestResponse();
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
        orderHandlingMode: orderHandlingModeRef.current,
      }),
    }).then(r => r.json()).then(data => {
      if (data.command) applyServerOrderCommand(data.command);
      sendToolOutput(data.result ?? "Confirmed and executed.");
    }).catch(e => {
      sendToolOutput(`Error: ${e.message}`);
    });
  }, [applyServerOrderCommand, pendingConfirmation, requestResponse]);

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
    if (dc?.readyState === "open") {
      dc.send(payload);
      requestResponse();
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
        requestResponse();
      }
    }
  }, [pendingConfirmation, requestResponse]);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || standbyRef.current) return;
      if (!isRunning.current && agentStateRef.current === "disconnected") return;
      const dcDead = dcRef.current?.readyState !== "open";
      const wsDead = wsRef.current != null && wsRef.current.readyState !== WebSocket.OPEN;
      const stale = Date.now() - lastInboundAtRef.current > 5_000;
      if (isRunning.current && (dcDead || wsDead || stale)) {
        closeTransportRef.current?.();
        scheduleReconnect("visibility");
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [scheduleReconnect]);

  return (
    <VoiceAgentContext.Provider value={{
      agentState, isConnected, conversation, partialTranscript, error, remoteStream,
      pendingConfirmation, connect, prewarm, activate, releaseStandby, disconnect, clearConversation, setToolHandler, interrupt,
      setCatalog, setCurrentOrder, setAuthParams, setOrderHandlingMode,
      confirmPending, denyPending, sessionUsage,
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
