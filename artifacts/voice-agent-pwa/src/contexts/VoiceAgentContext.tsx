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

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

// ── Context ───────────────────────────────────────────────────────────────────

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [agentMode, setAgentMode] = useState<AgentMode>("pos");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

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
  const isRunning = useRef(false);
  const agentStateRef = useRef<AgentState>("disconnected");
  const agentModeRef = useRef<AgentMode>("pos");
  const sessionIdRef = useRef("");

  // Keep mode ref in sync for stale-closure-proof reads
  useEffect(() => { agentModeRef.current = agentMode; }, [agentMode]);

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
  const setAuthParams = useCallback((venueId: string, authToken: string) => {
    venueIdRef.current = venueId;
    authTokenRef.current = authToken;
  }, []);

  // ── Send context update to OpenAI via data channel ──────────────────────────

  const sendContextUpdate = useCallback(() => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;

    const catalog = catalogRef.current as Array<{ name: string; price: number; category?: string }>;
    const mode = agentModeRef.current;

    const catalogStr =
      catalog.length > 0
        ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
        : "  (No catalog loaded — connect Square first)";

    let instructions: string;

    if (mode === "inventory") {
      instructions = `You are BevPro Inventory, a voice assistant for managing bar and venue inventory on Square. You help staff count stock, receive deliveries, flag low items, and keep inventory accurate.

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
- You do NOT take orders or process payments. If asked to add items to an order or submit an order, explain that this is the inventory agent and suggest using the POS agent instead.
- Noisy environment — only respond to direct speech. If unclear, ask.`;
    } else {
      const order = currentOrderRef.current as Array<{ quantity: number; item_name: string; price: number }>;
      const orderStr =
        order.length > 0
          ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
          : "  (empty)";

      instructions = `You are BevPro, a bartender's voice assistant running on Square POS. You help the bartender ring up orders, check stock, and find menu info — fast and hands-free.

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
- You do NOT manage inventory. If asked to adjust stock or count inventory, explain that this is the POS agent and suggest using the inventory agent instead.
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.`;
    }

    dc.send(JSON.stringify({
      type: "session.update",
      session: { instructions },
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
      const toolPath = agentModeRef.current === "inventory" ? "api/realtime-inventory/tools" : "api/realtime/tools";
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
        }),
      });

      const data = await res.json();
      console.log(`[WebRTC] Tool result (${toolName}):`, data.result);

      // Send tool output back to OpenAI via data channel
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: data.result ?? "Tool execution failed",
        },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));

      // Handle order commands locally
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
        sessionIdRef.current = String((event.session as any)?.id ?? Date.now());
        sendContextUpdate();
        break;

      case "session.updated":
        // Ack — no action needed
        break;

      case "input_audio_buffer.speech_started":
        if (agentStateRef.current === "speaking") {
          // Interrupt: cancel current response — WebRTC handles audio stop natively
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
        // Audio is handled natively via WebRTC media track — no manual scheduling.
        // We just update state to "speaking".
        setAs("speaking");
        break;

      case "response.done":
        if (isRunning.current) {
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
        setError(String(err));
        setAgentState("error");
        break;
      }
    }
  }, [addMessage, sendContextUpdate, executeToolViaServer]);

  // ── Connect via WebRTC ─────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isRunning.current) return;
    setError(null);

    if (!authTokenRef.current) {
      setError("Not authenticated. Please open the BevPro dashboard, select your venue, and launch the voice agent from there.");
      setAgentState("error");
      return;
    }

    setAgentState("connecting");

    const { voice, speed } = getVoicePrefs();
    const baseUrl = getBaseUrl();

    try {
      // 1. Get ephemeral token from our server
      const sessionPath = agentModeRef.current === "inventory" ? "api/realtime-inventory/session" : "api/realtime/session";
      console.log(`[WebRTC] Requesting ephemeral token (${agentModeRef.current} mode)...`);
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

      // 2. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Set up audio playback — remote audio track goes to an <audio> element
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;

      pc.ontrack = (e) => {
        console.log("[WebRTC] Got remote audio track");
        audioEl.srcObject = e.streams[0];
      };

      // 4. Add local mic track
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Create data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        console.log("[WebRTC] Data channel open");
        isRunning.current = true;
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

      // 7. Send offer to OpenAI, get SDP answer
      const model = "gpt-4o-mini-realtime-preview-2024-12-17";
      const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
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
      pcRef.current?.close();
      pcRef.current = null;
      dcRef.current = null;
    }
  }, [handleDcEvent]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    isRunning.current = false;
    agentStateRef.current = "disconnected";

    // Stop all tracks
    pcRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });

    dcRef.current?.close();
    dcRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }

    setAgentState("disconnected");
  }, []);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
  }, []);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setError(null);
    setPartialTranscript("");
  }, []);

  const isConnected = agentState !== "disconnected" && agentState !== "error";

  return (
    <VoiceAgentContext.Provider value={{
      agentState, agentMode, setAgentMode, isConnected, conversation, partialTranscript, error,
      connect, disconnect, clearConversation, setToolHandler, interrupt,
      setCatalog, setCurrentOrder, setSquareCredentials, setAuthParams,
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
