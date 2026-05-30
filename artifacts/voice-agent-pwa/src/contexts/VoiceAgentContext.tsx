/**
 * Voice Agent Context — WebRTC direct connection to OpenAI Realtime API
 * Client connects directly to OpenAI via RTCPeerConnection. Server provides
 * ephemeral tokens and executes tool calls via REST.
 */
import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { getVoicePrefs } from "@/lib/voice-prefs";
import { getBaseUrl } from "@/lib/api";
import { useWakeLock } from "@/hooks/useWakeLock";

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
  setSquareCredentials: (token: string, locationId: string) => void;
  setAuthParams: (venueId: string, authToken: string, agentProfileId?: string) => void;
  confirmPending: () => void;
  denyPending: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

// A short tail lets the speaker's acoustic decay die out before the mic
// re-opens, so the agent's final syllable can't re-trigger the VAD.
const MIC_REOPEN_TAIL_MS = 250;

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
  const squareTokenRef = useRef("");
  const squareLocationIdRef = useRef("");
  const venueIdRef = useRef("");
  const authTokenRef = useRef("");
  const agentProfileIdRef = useRef("");
  const isRunning = useRef(false);
  const agentStateRef = useRef<AgentState>("disconnected");
  const sessionIdRef = useRef("");
  const sessionStartTsRef = useRef<number>(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Local mic track + duplex state for half-duplex gating during playback.
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const fullDuplexRef = useRef(false);
  const micReopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const setSquareCredentials = useCallback((token: string, locationId: string) => {
    squareTokenRef.current = token;
    squareLocationIdRef.current = locationId;
  }, []);

  /** Store venueId + auth JWT so realtime calls go through server-side credential lookup. */
  const setAuthParams = useCallback((venueId: string, authToken: string, agentProfileId?: string) => {
    venueIdRef.current = venueId;
    authTokenRef.current = authToken;
    agentProfileIdRef.current = agentProfileId ?? "";
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
    if (!dc || dc.readyState !== "open") return;

    const catalog = catalogRef.current as Array<{ name: string; price: number; category?: string }>;
    const catalogStr =
      catalog.length > 0
        ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
        : "  (No catalog loaded)";

    const order = currentOrderRef.current as Array<{ quantity: number; item_name: string; price: number }>;
    const orderStr =
      order.length > 0
        ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
        : "  (empty)";

    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: `[Context update]\n\nCatalog:\n${catalogStr}\n\nCurrent order:\n${orderStr}` }],
      },
    }));
  }, []);

  // ── Execute tool via server REST API ────────────────────────────────────────

  const executeToolViaServer = useCallback(async (
    toolName: string,
    args: Record<string, unknown>,
    callId: string,
  ) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;

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
      console.log(`[WebRTC] Tool result (${toolName}):`, data.result);

      let parsed: any = null;
      try { parsed = JSON.parse(data.result); } catch { /* not JSON */ }

      if (parsed?.status === "REQUIRES_CONFIRMATION" && parsed.confirmation) {
        setPendingConfirmation({ ...parsed.confirmation, call_id: callId });
        dc.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: `Waiting for user confirmation for ${toolName}. Tell the user you need their confirmation before proceeding.`,
          },
        }));
        dc.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: data.result ?? "Tool execution failed",
        },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));

      if (data.command) {
        commandHandlerRef.current?.([data.command]);
      }
    } catch (e: any) {
      console.error(`[WebRTC] Tool exec error:`, e.message);
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: `Error: ${e.message}`,
        },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  }, []);

  // ── Data channel event handler ──────────────────────────────────────────────

  const handleDcEvent = useCallback((raw: string) => {
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw); } catch { return; }

    const setAs = (s: AgentState) => { agentStateRef.current = s; setAgentState(s); };

    switch (event.type) {
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
          reopenMic();
          setAs("listening");
        }
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
        // Don't leave the user muted if playback errored out mid-response.
        reopenMicNow();
        setError(String(err));
        setAgentState("error");
        break;
      }
    }
  }, [addMessage, sendContextUpdate, executeToolViaServer, gateMicForPlayback, reopenMic, reopenMicNow]);

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
      // 1. Get ephemeral token from our server
      const sessionPath = "api/realtime/session";
      console.log(`[WebRTC] Requesting ephemeral token...`);
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
        throw new Error(err.detail || err.error || "Failed to get session token");
      }

      const sessionData = await tokenRes.json();
      // Extract session ID immediately to avoid race with session.created event
      if (sessionData.id) sessionIdRef.current = String(sessionData.id);
      // Server decides duplex behavior per noise mode. Default = half-duplex.
      fullDuplexRef.current = Boolean(sessionData?.voicelab?.bargeIn);
      const ephemeralKey = sessionData.client_secret?.value;
      if (!ephemeralKey) throw new Error("No ephemeral key in session response");

      console.log("[WebRTC] Got ephemeral token, creating peer connection...");

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
        console.log("[WebRTC] Got remote audio track");
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
        console.log("[WebRTC] Data channel open");
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
            }),
          }).catch(() => {});
        }, 60_000);
      };

      dc.onmessage = (e) => handleDcEvent(e.data);

      dc.onclose = () => {
        console.log("[WebRTC] Data channel closed");
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

      console.log("[WebRTC] Connection established");
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
  }, [handleDcEvent, cancelMicReopen]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const sendSessionEnd = useCallback(() => {
    if (!sessionIdRef.current || !sessionStartTsRef.current) return;
    const durationMs = Date.now() - sessionStartTsRef.current;
    if (durationMs <= 0) return;
    const baseUrl = getBaseUrl();
    const payload = JSON.stringify({
      durationMs,
      venueId: venueIdRef.current || undefined,
    });
    const url = `${baseUrl}api/realtime/session/${sessionIdRef.current}/end`;

    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    } else {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;
      fetch(url, { method: "POST", headers, body: payload, keepalive: true }).catch(() => {});
    }
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

    pcRef.current?.close();
    pcRef.current = null;

    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }

    setRemoteStream(null);
    setAgentState("disconnected");
  }, [sendSessionEnd, cancelMicReopen]);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
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

  useWakeLock(isConnected);

  const confirmPending = useCallback(() => {
    const conf = pendingConfirmation;
    if (!conf) return;
    setPendingConfirmation(null);
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
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
        catalog: catalogRef.current,
        order: currentOrderRef.current,
        venueId: venueIdRef.current || undefined,
        agentProfileId: agentProfileIdRef.current || undefined,
      }),
    }).then(r => r.json()).then(data => {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: conf.call_id, output: data.result ?? "Confirmed and executed." },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
      if (data.command) commandHandlerRef.current?.([data.command]);
    }).catch(e => {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: conf.call_id, output: `Error: ${e.message}` },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    });
  }, [pendingConfirmation]);

  const denyPending = useCallback(() => {
    const conf = pendingConfirmation;
    if (!conf) return;
    setPendingConfirmation(null);
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: conf.call_id, output: "User declined this action." },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }, [pendingConfirmation]);

  return (
    <VoiceAgentContext.Provider value={{
      agentState, isConnected, conversation, partialTranscript, error, remoteStream,
      pendingConfirmation, connect, disconnect, clearConversation, setToolHandler, interrupt,
      setCatalog, setCurrentOrder, setSquareCredentials, setAuthParams,
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
