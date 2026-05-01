import React, { useEffect, useRef, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { useVoiceAgent, type AgentState, type OrderCommand, type ConversationMessage } from "@/contexts/VoiceAgentContext";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderPanel } from "@/components/OrderPanel";
import { useWakeWord, isWakeWordSupported } from "@/hooks/useWakeWord";
import { soundWake, soundChime, soundItemAdd, soundSubmit, soundError, soundSleep } from "@/lib/sounds";

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
    agentState, isConnected, conversation, partialTranscript, error,
    connect, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials, setAuthParams,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, markVoiceOrderSubmitted, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, catalogError, accessToken, locationId, venueId: sqVenueId, authToken: sqAuthToken } = useSquare();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"order" | "menu" | "settings">("order");
  const [mode, setMode] = useState<AppMode>("idle");
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const modeRef = useRef<AppMode>("idle");
  const prevItemCountRef = useRef(0);

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
    if (venueId && authToken) setAuthParams(venueId, authToken);
  }, [sqVenueId, sqAuthToken, setAuthParams]);

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
    if (modeRef.current === "command") {
      disconnect();
    }
    setMode("wake_word");
  }, [disconnect]);

  const onShutdownDetected = useCallback(() => {
    console.log("[App] Shutdown phrase → stopping completely");
    soundSleep();
    if (modeRef.current === "command") {
      disconnect();
    }
    setMode("shutdown");
  }, [disconnect]);

  const { isListening: wakeWordListening, startWakeWord, stopWakeWord } = useWakeWord({
    confidenceThreshold: 0.4,
    onWakeWordDetected,
    onStopDetected,
    onShutdownDetected,
  });

  // When agent disconnects naturally or via response, check if we should return to wake word
  useEffect(() => {
    if (mode === "command" && agentState === "disconnected") {
      setMode("wake_word");
    }
  }, [mode, agentState]);

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

  // Monitor conversation for termination phrases while in command mode
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
      const text = lastMsg.content.toLowerCase();
      const terminatingPhrases = [
        "that's all for now", "thats all for now",
        "goodbye", "good bye", "stop listening",
        "that's all", "thats all", "nothing else", "see you",
      ];
      const shutdownPhrases = ["shut down", "shut it down", "turn off"];

      if (shutdownPhrases.some((p) => text.includes(p))) {
        setTimeout(() => {
          disconnect();
          setMode("shutdown");
        }, 2000);
      } else if (terminatingPhrases.some((p) => text.includes(p))) {
        setTimeout(() => {
          disconnect();
          setMode("wake_word");
        }, 2000);
      }
    }
  }, [conversation, mode, disconnect]);

  // ── Rail tap / initial activation ─────────────────────────────
  async function handleRailTap() {
    if (mode === "idle" || mode === "shutdown") {
      if (!micPermissionGranted) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          setMicPermissionGranted(true);
        } catch {
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
          <svg width="24" height="22" viewBox="0 0 62 58" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="vl-top-blue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5AA0FF"/>
                <stop offset="100%" stopColor="#1F4FE0"/>
              </linearGradient>
              <linearGradient id="vl-top-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFD34A"/>
                <stop offset="100%" stopColor="#F5A623"/>
              </linearGradient>
            </defs>
            <circle cx="3" cy="30" r="2.4" fill="url(#vl-top-blue)"/>
            <rect x="7" y="22" width="5" height="16" rx="2.5" fill="url(#vl-top-blue)"/>
            <rect x="15" y="14" width="5" height="32" rx="2.5" fill="url(#vl-top-blue)"/>
            <rect x="23" y="6" width="5" height="48" rx="2.5" fill="url(#vl-top-blue)"/>
            <rect x="31" y="6" width="5" height="48" rx="2.5" fill="url(#vl-top-gold)"/>
            <rect x="39" y="14" width="5" height="32" rx="2.5" fill="url(#vl-top-gold)"/>
            <rect x="47" y="22" width="5" height="16" rx="2.5" fill="url(#vl-top-gold)"/>
            <rect x="55" y="26" width="5" height="8" rx="2.5" fill="url(#vl-top-gold)"/>
            <path d="M25 5.5 Q33 0 40 5.5" stroke="#FF8A2B" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
          </svg>
          <span className="brand-text" style={{ color: "var(--logo-text)" }}>
            Voyce<span style={{ fontWeight: 500, opacity: 0.92 }}>Lab</span>
          </span>
        </div>
        {orderCount > 0 ? (
          <button className="order-badge" onClick={() => { setPanelTab("order"); setPanelOpen(true); }} aria-label={`${orderCount} items in order`}>
            <span className="order-badge-num">{orderCount}</span>
          </button>
        ) : <div style={{ width: 22 }} />}
      </div>

      {/* Status chips — assistant · connected service · room */}
      <div className="status-chips">
        <span className="vl-pill vl-pill-brass">Bev</span>
        {isConfigured && <span className="vl-pill vl-pill-success"><span className="vl-pill-dot" />Square synced</span>}
        <span className="vl-pill">Bar</span>
      </div>

      {/* ── Conversation area ────────────────────────────────── */}
      <div className="content">
        {/* Subtle watermark — equalizer mark */}
        <div className="watermark">
          <svg width="180" height="168" viewBox="0 0 62 58" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="vl-wm-blue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5AA0FF"/>
                <stop offset="100%" stopColor="#1F4FE0"/>
              </linearGradient>
              <linearGradient id="vl-wm-gold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFD34A"/>
                <stop offset="100%" stopColor="#F5A623"/>
              </linearGradient>
            </defs>
            <g opacity="0.08">
              <circle cx="3" cy="30" r="2.4" fill="url(#vl-wm-blue)"/>
              <rect x="7" y="22" width="5" height="16" rx="2.5" fill="url(#vl-wm-blue)"/>
              <rect x="15" y="14" width="5" height="32" rx="2.5" fill="url(#vl-wm-blue)"/>
              <rect x="23" y="6" width="5" height="48" rx="2.5" fill="url(#vl-wm-blue)"/>
              <rect x="31" y="6" width="5" height="48" rx="2.5" fill="url(#vl-wm-gold)"/>
              <rect x="39" y="14" width="5" height="32" rx="2.5" fill="url(#vl-wm-gold)"/>
              <rect x="47" y="22" width="5" height="16" rx="2.5" fill="url(#vl-wm-gold)"/>
              <rect x="55" y="26" width="5" height="8" rx="2.5" fill="url(#vl-wm-gold)"/>
              <path d="M25 5.5 Q33 0 40 5.5" stroke="#FF8A2B" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
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
          {isLoadingCatalog && <div className="state-label">LOADING MENU</div>}
          {catalogError && <div className="error-text">Menu: {catalogError}</div>}
        </div>
      </div>

      {/* ── The Bar Rail ─────────────────────────────────────── */}
      <div className="bar-rail-zone" onClick={handleRailTap}>
        {/* State label */}
        <div className="rail-label-row">
          {label && <span className="rail-label">{label}</span>}
          {mode === "idle" && <span className="rail-hint">tap to begin</span>}
        </div>

        {/* The rail line */}
        <div className={`bar-rail ${railCls}`}>
          <div className="rail-glow" />
          <div className="rail-line" />
          {showWaveform && <RailWaveform active={agentState === "speaking"} />}
        </div>

        {/* Interrupt hint */}
        {agentState === "speaking" && (
          <div className="rail-interrupt-hint">tap to interrupt</div>
        )}
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
