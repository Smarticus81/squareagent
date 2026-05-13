import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { useVoiceAgent, type AgentState, type OrderCommand, type ConversationMessage } from "@/contexts/VoiceAgentContext";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderPanel } from "@/components/OrderPanel";
import { VoiceOrb } from "@/components/VoiceOrb";
import { useWakeWord, isWakeWordSupported } from "@/hooks/useWakeWord";
import { soundWake, soundChime, soundItemAdd, soundSubmit, soundError, soundSleep } from "@/lib/sounds";
import { matchTermination } from "@/lib/voice-termination";

/* ── App modes ─────────────────────────────────────────────────── */
type AppMode = "idle" | "wake_word" | "command" | "shutdown";


/* ── Rail state CSS class ────────────────────────────────────── */
function railClass(state: AgentState, mode: AppMode, wakeWordActive: boolean): string {
  if (mode === "idle" || mode === "shutdown") return "rail-idle";
  if (mode === "wake_word" && wakeWordActive) return "rail-ambient";
  if (mode === "wake_word" && !wakeWordActive) return "rail-idle";
  switch (state) {
    case "listening":  return "rail-listening";
    case "speaking":   return "rail-speaking";
    case "thinking":   return "rail-thinking";
    case "connecting": return "rail-connecting";
    case "error":      return "rail-error";
    default:           return "rail-idle";
  }
}

/**
 * User-facing voice surface labels.
 * Internal engineering states map to plain-language words the user can read.
 * No "CONNECTING_TO_PROVIDER", "TURN_DETECTED", or technical strings.
 */
function stateLabel(state: AgentState, mode: AppMode, wakeWordActive: boolean): string | null {
  if (mode === "shutdown") return "Offline";
  if (mode === "wake_word" && wakeWordActive) return "Ready";
  if (mode === "wake_word" && !wakeWordActive) return "Waking up";
  switch (state) {
    case "connecting": return "Connecting";
    case "thinking":   return "Thinking";
    case "error":      return "Needs attention";
    case "listening":  return "Listening";
    case "speaking":   return "Speaking";
    default:           return null;
  }
}

function buildWakeWords(wakePhrase: string): string[] {
  const normalized = wakePhrase.toLowerCase().trim();
  const compact = normalized.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
  // Always include a small set of safe, multi-syllable defaults.
  const words = new Set<string>(["hey voyce", "hey voicelab", "hey voycelab", "voycelab"]);
  if (compact) {
    // Always include the full configured phrase as-is.
    words.add(compact);
    // Ensure a "hey {name}" variant exists, but never the bare name on its
    // own — single-word names like "bev" or "max" overlap with common
    // English ("beverage", "maximum") and produce false wakes.
    if (!compact.startsWith("hey ")) {
      words.add(`hey ${compact}`);
    }
  } else {
    words.add("hey bar");
  }
  return Array.from(words);
}

/* ── Ghost conversation lines ─────────────────────────────────── */
function GhostLine({ msg, rank }: { msg: ConversationMessage; rank: number }) {
  const isUser = msg.role === "user";
  const cls = rank === 0
    ? (isUser ? "msg msg-user" : "msg msg-agent")
    : rank === 1 ? "msg msg-old" : "msg msg-oldest";
  return <p className={cls}>{msg.content}</p>;
}

/* ── Waveform bars for rail ───────────────────────────────────── */
function RailWaveform({ active }: { active: boolean }) {
  return (
    <div className={`rail-waveform ${active ? "rail-waveform-active" : ""}`}>
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="rail-bar" style={{ animationDelay: `${i * 0.06}s` }} />
      ))}
    </div>
  );
}

/* ── Main App ─────────────────────────────────────────────────── */
export default function App() {
  const {
    agentState, isConnected, conversation, partialTranscript, error, remoteStream,
    connect, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials, setAuthParams,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, markVoiceOrderSubmitted, submitOrder, isSubmitting,
  } = useOrder();

  const {
    isConfigured,
    catalogItems,
    isLoadingCatalog,
    catalogError,
    accessToken,
    locationId,
    venueId: sqVenueId,
    authToken: sqAuthToken,
    agentProfile,
    agentProfileId,
    wakePhrase,
    assistantKind,
  } = useSquare();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"order" | "menu" | "settings">("order");
  const [mode, setMode] = useState<AppMode>("idle");
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const modeRef = useRef<AppMode>("idle");
  const prevItemCountRef = useRef(0);
  const terminationHandledRef = useRef(false);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Track order item count to play sounds on add
  useEffect(() => {
    const count = currentOrder?.items.length ?? 0;
    if (count > prevItemCountRef.current && prevItemCountRef.current >= 0) {
      soundItemAdd();
    }
    prevItemCountRef.current = count;
  }, [currentOrder?.items.length]);

  // Keep refs for stale-closure-proof callbacks
  const catalogRef = useRef(catalogItems);
  const orderRef = useRef(currentOrder);
  const tokenRef = useRef(accessToken);
  const locRef = useRef(locationId);
  useEffect(() => { catalogRef.current = catalogItems; }, [catalogItems]);
  useEffect(() => { orderRef.current = currentOrder; }, [currentOrder]);
  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { locRef.current = locationId; }, [locationId]);

  // Push catalog to voice agent
  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({
      id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category,
    })));
  }, [catalogItems, setCatalog]);

  // Push Square credentials to voice agent
  useEffect(() => {
    if (accessToken && locationId) setSquareCredentials(accessToken, locationId);
  }, [accessToken, locationId, setSquareCredentials]);

  // Pass venueId + auth JWT to voice agent for server-side credential lookup
  useEffect(() => {
    const venueId = sqVenueId || "";
    const authToken = sqAuthToken || "";
    if (authToken && (venueId || agentProfileId)) setAuthParams(venueId, authToken, agentProfileId ?? undefined);
  }, [sqVenueId, sqAuthToken, agentProfileId, setAuthParams]);

  // Push current order to voice agent
  useEffect(() => {
    setCurrentOrder(
      (currentOrder?.items ?? []).map((i) => ({
        name: i.catalogItem.name, price: i.catalogItem.price, quantity: i.quantity,
      })),
    );
  }, [currentOrder, setCurrentOrder]);

  // Handle voice order commands
  const handleCmds = useCallback((cmds: OrderCommand[]) => {
    for (const cmd of cmds) {
      switch (cmd.action) {
        case "add": {
          const items = catalogRef.current;
          let found = cmd.item_id ? items.find((c) => c.id === cmd.item_id) : undefined;
          if (!found && cmd.item_name) {
            const n = cmd.item_name.toLowerCase();
            found = items.find((c) => c.name.toLowerCase() === n)
              ?? items.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
          }
          if (found) addItem(found, cmd.quantity ?? 1);
          break;
        }
        case "remove": {
          const n = (cmd.item_name ?? "").toLowerCase();
          const ord = orderRef.current;
          const line = ord?.items.find((i) => i.catalogItem.name.toLowerCase() === n)
            ?? ord?.items.find((i) => i.catalogItem.name.toLowerCase().includes(n));
          if (line) removeItem(line.id);
          break;
        }
        case "clear":
          clearOrder();
          break;
        case "submit": {
          if (orderRef.current?.items.length) {
            soundSubmit();
            markVoiceOrderSubmitted();
            setPanelTab("order");
            setPanelOpen(true);
          }
          break;
        }
      }
    }
  }, [addItem, removeItem, clearOrder, markVoiceOrderSubmitted]);

  useEffect(() => { setToolHandler(handleCmds); }, [handleCmds, setToolHandler]);

  // ── Wake word handlers ──────────────────────────────────────────
  const onWakeWordDetected = useCallback(() => {
    console.log("[App] Wake word detected → entering command mode");
    soundWake();
    setTimeout(() => soundChime(), 280);
    setMode("command");
    connect();
  }, [connect]);

  const onStopDetected = useCallback(() => {
    console.log("[App] Terminating phrase → back to wake word mode");
    soundSleep();
    const wasCommand = modeRef.current === "command";
    setMode("wake_word");
    if (wasCommand) void disconnect();
  }, [disconnect]);

  const onShutdownDetected = useCallback(() => {
    console.log("[App] Shutdown phrase → stopping completely");
    soundSleep();
    const wasCommand = modeRef.current === "command";
    setMode("shutdown");
    if (wasCommand) void disconnect();
  }, [disconnect]);

  const wakeWords = useMemo(() => buildWakeWords(wakePhrase), [wakePhrase]);

  const { isListening: wakeWordListening, startWakeWord, stopWakeWord } = useWakeWord({
    wakeWords,
    confidenceThreshold: 0.4,
    onWakeWordDetected,
    onStopDetected,
    onShutdownDetected,
  });

  // When agent disconnects naturally or via response, return to wake listening (unless fully shut down)
  useEffect(() => {
    if (mode === "command" && agentState === "disconnected") {
      setMode("wake_word");
    }
  }, [mode, agentState]);

  useEffect(() => {
    if (mode === "command") terminationHandledRef.current = false;
  }, [mode]);

  // Play error sound on error state
  useEffect(() => {
    if (agentState === "error") soundError();
  }, [agentState]);

  // Start/stop wake word based on mode
  useEffect(() => {
    if (mode === "wake_word") {
      const timer = setTimeout(() => startWakeWord(), 600);
      return () => clearTimeout(timer);
    } else {
      stopWakeWord();
    }
  }, [mode, startWakeWord, stopWakeWord]);

  const applyVoiceTermination = useCallback(
    (kind: "soft" | "hard") => {
      if (terminationHandledRef.current) return;
      terminationHandledRef.current = true;
      soundSleep();
      setMode(kind === "hard" ? "shutdown" : "wake_word");
      void disconnect();
    },
    [disconnect],
  );

  const lastConversationLenRef = useRef(0);
  useEffect(() => {
    if (mode !== "command") return;
    if (conversation.length <= lastConversationLenRef.current) {
      lastConversationLenRef.current = conversation.length;
      return;
    }
    lastConversationLenRef.current = conversation.length;

    const lastMsg = conversation[conversation.length - 1];
    if (lastMsg?.role === "user") {
      const kind = matchTermination(lastMsg.content);
      if (kind) applyVoiceTermination(kind);
    }
  }, [conversation, mode, applyVoiceTermination]);

  useEffect(() => {
    if (mode !== "command" || !partialTranscript?.trim()) return;
    const kind = matchTermination(partialTranscript, { partial: true });
    if (kind) applyVoiceTermination(kind);
  }, [partialTranscript, mode, applyVoiceTermination]);

  // ── Rail tap / initial activation ─────────────────────────────
  async function handleRailTap() {
    console.log("[App] rail tap — mode:", mode, "micGranted:", micPermissionGranted, "agentState:", agentState);
    if (mode === "idle" || mode === "shutdown") {
      if (!micPermissionGranted) {
        if (!navigator.mediaDevices?.getUserMedia) {
          setMicError("Microphone API unavailable. Use HTTPS or localhost.");
          console.warn("[App] navigator.mediaDevices.getUserMedia not available");
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          setMicPermissionGranted(true);
          setMicError(null);
        } catch (e) {
          const err = e as DOMException;
          const msg = err?.name === "NotAllowedError"
            ? "Microphone permission denied. Enable it in your browser site settings."
            : err?.name === "NotFoundError"
              ? "No microphone found."
              : `Microphone error: ${err?.message ?? String(e)}`;
          console.warn("[App] getUserMedia failed:", err);
          setMicError(msg);
          return;
        }
      }
      soundWake();
      setMode("wake_word");
    } else if (mode === "wake_word") {
      stopWakeWord();
      soundWake();
      setMode("command");
      connect();
    } else if (mode === "command") {
      if (agentState === "speaking") {
        interrupt();
      } else {
        soundSleep();
        disconnect();
        setMode("wake_word");
      }
    }
  }

  const msgs = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;
  const label = stateLabel(agentState, mode, wakeWordListening);
  const railCls = railClass(agentState, mode, wakeWordListening);
  const showWaveform = agentState === "speaking" || agentState === "listening";

  return (
    <div className="app">
      {/* ── Top bar ──────────────────────────────────────────── */}
      <div className="top-bar">
        <button className="hamburger" onClick={() => setPanelOpen(true)} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="brand-row">
          <svg width="46" height="26" viewBox="0 0 184 104" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <clipPath id="vl-top-clip">
                <rect x="0" y="39" width="22" height="54" rx="11"/>
                <rect x="27" y="25" width="22" height="76" rx="11"/>
                <rect x="54" y="10" width="22" height="94" rx="11"/>
                <rect x="81" y="0" width="22" height="104" rx="11"/>
                <rect x="108" y="18" width="22" height="82" rx="11"/>
                <rect x="135" y="26" width="22" height="66" rx="11"/>
                <rect x="162" y="37" width="22" height="53" rx="11"/>
              </clipPath>
              <linearGradient id="vl-top-wave" x1="0" y1="0" x2="0" y2="104" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#AD91D8"/>
                <stop offset="32%" stopColor="#E44B9A"/>
                <stop offset="62%" stopColor="#FF6245"/>
                <stop offset="100%" stopColor="#FDBA2E"/>
              </linearGradient>
            </defs>
            <rect x="0" y="39" width="22" height="54" rx="11" fill="url(#vl-top-wave)" opacity="0.72"/>
            <rect x="27" y="25" width="22" height="76" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="54" y="10" width="22" height="94" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="81" y="0" width="22" height="104" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="108" y="18" width="22" height="82" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="135" y="26" width="22" height="66" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="162" y="37" width="22" height="53" rx="11" fill="url(#vl-top-wave)"/>
            <g clipPath="url(#vl-top-clip)">
              <ellipse cx="13" cy="61" rx="25" ry="24" fill="#E2C7E8" fillOpacity="0.62"/>
              <ellipse cx="55" cy="73" rx="63" ry="31" fill="#E52F8E" fillOpacity="0.46"/>
              <ellipse cx="98" cy="78" rx="45" ry="31" fill="#FF6B37" fillOpacity="0.45"/>
              <ellipse cx="144" cy="49" rx="18" ry="18" fill="#F2A0C6" fillOpacity="0.58"/>
              <ellipse cx="166" cy="72" rx="19" ry="22" fill="#FDB62F" fillOpacity="0.76"/>
            </g>
          </svg>
          <span className="brand-text" style={{ color: "var(--logo-text)" }}>
            Voyce<span style={{ fontWeight: 500, opacity: 0.92 }}>Lab</span>
          </span>
        </div>
        {orderCount > 0 && assistantKind === "venue" ? (
          <button className="order-badge" onClick={() => { setPanelTab("order"); setPanelOpen(true); }} aria-label={`${orderCount} items in order`}>
            <span className="order-badge-num">{orderCount}</span>
          </button>
        ) : <div style={{ width: 22 }} />}
      </div>

      {/* Status chips — assistant · connected service · room */}
      <div className="status-chips">
        <span className="vl-pill vl-pill-brass">{agentProfile?.displayName ?? "Assistant"}</span>
        {assistantKind === "venue" && isConfigured && (
          <span className="vl-pill vl-pill-success"><span className="vl-pill-dot" />Square synced</span>
        )}
        {assistantKind === "general" && (
          <span className="vl-pill">General</span>
        )}
      </div>

      {/* ── Conversation area ────────────────────────────────── */}
      <div className="content">
        {/* Subtle watermark — equalizer mark */}
        <div className="watermark">
          <svg width="190" height="118" viewBox="0 0 52 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="vl-wm-lilac" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#D9CBF0"/>
                <stop offset="100%" stopColor="#A38EDC"/>
              </linearGradient>
              <linearGradient id="vl-wm-coral" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF8A66"/>
                <stop offset="100%" stopColor="#000000"/>
              </linearGradient>
              <linearGradient id="vl-wm-sage" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#B9DBBE"/>
                <stop offset="100%" stopColor="#7FB386"/>
              </linearGradient>
            </defs>
            <g opacity="0.08">
              <rect x="1" y="14" width="3" height="4" rx="1.5" fill="url(#vl-wm-lilac)"/>
              <rect x="6" y="11" width="3" height="10" rx="1.5" fill="url(#vl-wm-lilac)"/>
              <rect x="11" y="6" width="3" height="20" rx="1.5" fill="url(#vl-wm-coral)"/>
              <rect x="16" y="2" width="3" height="28" rx="1.5" fill="url(#vl-wm-coral)"/>
              <rect x="21" y="0" width="3" height="32" rx="1.5" fill="url(#vl-wm-coral)"/>
              <rect x="26" y="2" width="3" height="28" rx="1.5" fill="url(#vl-wm-coral)"/>
              <rect x="31" y="6" width="3" height="20" rx="1.5" fill="url(#vl-wm-coral)"/>
              <rect x="36" y="10" width="3" height="12" rx="1.5" fill="url(#vl-wm-sage)"/>
              <rect x="41" y="13" width="3" height="6" rx="1.5" fill="url(#vl-wm-sage)"/>
              <rect x="46" y="14" width="3" height="4" rx="1.5" fill="url(#vl-wm-sage)"/>
            </g>
          </svg>
        </div>
        <div className="convo-area">
          {msgs.map((m, i) => (
            <GhostLine key={m.id} msg={m} rank={msgs.length - 1 - i} />
          ))}
          {partialTranscript && <p className="partial">{partialTranscript}</p>}
        </div>

        {/* Status messages */}
        <div className="status-area">
          {error && <div className="error-text">{error}</div>}
          {micError && <div className="error-text">{micError}</div>}
          {isLoadingCatalog && <div className="state-label">LOADING MENU</div>}
          {catalogError && <div className="error-text">Menu: {catalogError}</div>}
        </div>
      </div>

      {/* ── Voice Orb ────────────────────────────────────────── */}
      <div className="orb-stage">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <VoiceOrb
            state={
              mode === "idle" || mode === "shutdown" ? "idle" :
              mode === "wake_word" ? (wakeWordListening ? "wake" : "idle") :
              agentState === "speaking" ? "speaking" :
              agentState === "listening" ? "listening" :
              agentState === "thinking" ? "thinking" :
              agentState === "connecting" ? "connecting" :
              agentState === "error" ? "error" :
              "idle"
            }
            remoteStream={remoteStream}
            onTap={handleRailTap}
          />
          <div className="orb-label">{label ?? (mode === "idle" ? "" : "")}</div>
          {mode === "idle" && <div className="orb-hint">tap to begin</div>}
          {agentState === "speaking" && <div className="orb-hint">tap to interrupt</div>}
        </div>
      </div>

      {/* Panel */}
      <OrderPanel
        open={panelOpen}
        tab={panelTab}
        onTabChange={setPanelTab}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
