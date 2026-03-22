import React, { useEffect, useRef, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { useVoiceAgent, type AgentState, type OrderCommand, type ConversationMessage } from "@/contexts/VoiceAgentContext";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderPanel } from "@/components/OrderPanel";
import { useWakeWord, isWakeWordSupported } from "@/hooks/useWakeWord";

/* ── App modes ─────────────────────────────────────────────────── */
type AppMode = "idle" | "wake_word" | "command" | "shutdown";

/* ── Orb state CSS class ─────────────────────────────────────── */
function orbClass(state: AgentState, mode: AppMode, wakeWordActive: boolean): string {
  if (mode === "wake_word" && wakeWordActive) return "orb-wake-word";
  switch (state) {
    case "listening": return "orb-listening";
    case "speaking":  return "orb-speaking";
    case "thinking":  return "orb-thinking";
    case "connecting": return "orb-connecting";
    case "error":     return "orb-error";
    default:          return "";
  }
}

function stateLabel(state: AgentState, mode: AppMode, wakeWordActive: boolean): string | null {
  if (mode === "shutdown") return "STOPPED";
  if (mode === "wake_word" && wakeWordActive) return "LISTENING FOR WAKE WORD";
  if (mode === "wake_word" && !wakeWordActive) return "STARTING...";
  switch (state) {
    case "connecting": return "CONNECTING";
    case "thinking":   return "\u00B7  \u00B7  \u00B7";
    case "error":      return "ERROR";
    case "listening":  return "LISTENING";
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

/* ── Main App ─────────────────────────────────────────────────── */
export default function App() {
  const {
    agentState, isConnected, conversation, partialTranscript, error,
    connect, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, markVoiceOrderSubmitted, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId } = useSquare();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"order" | "menu" | "settings">("order");
  const [mode, setMode] = useState<AppMode>("idle");
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const modeRef = useRef<AppMode>("idle");

  useEffect(() => { modeRef.current = mode; }, [mode]);

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
    setMode("command");
    connect();
  }, [connect]);

  const onStopDetected = useCallback(() => {
    // Terminating phrase: go back to wake word mode
    console.log("[App] Terminating phrase → back to wake word mode");
    if (modeRef.current === "command") {
      disconnect();
    }
    setMode("wake_word");
    // Wake word will re-start via the effect below
  }, [disconnect]);

  const onShutdownDetected = useCallback(() => {
    console.log("[App] Shutdown phrase → stopping completely");
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
      // Agent disconnected — go back to wake word mode
      setMode("wake_word");
    }
  }, [mode, agentState]);

  // Start/stop wake word based on mode
  useEffect(() => {
    if (mode === "wake_word") {
      startWakeWord();
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

    // Check the latest user message for termination phrases
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
        // Wait briefly for the agent to respond, then shut down
        setTimeout(() => {
          disconnect();
          setMode("shutdown");
        }, 2000);
      } else if (terminatingPhrases.some((p) => text.includes(p))) {
        // Wait briefly for the agent to respond, then go to wake word
        setTimeout(() => {
          disconnect();
          setMode("wake_word");
        }, 2000);
      }
    }
  }, [conversation, mode, disconnect]);

  // ── Orb press / initial activation ──────────────────────────────
  async function handleOrbPress() {
    if (mode === "idle" || mode === "shutdown") {
      // First tap: request mic permission, then enter wake word mode
      if (!micPermissionGranted) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop()); // Release immediately
          setMicPermissionGranted(true);
        } catch {
          return; // Permission denied — stay idle
        }
      }
      setMode("wake_word");
    } else if (mode === "wake_word") {
      // Tapping orb in wake word mode: enter command mode directly
      stopWakeWord();
      setMode("command");
      connect();
    } else if (mode === "command") {
      // Tapping orb in command mode: disconnect, go back to wake word
      disconnect();
      setMode("wake_word");
    }
  }

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const msgs = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;
  const label = stateLabel(agentState, mode, wakeWordListening);
  const orbCls = orbClass(agentState, mode, wakeWordListening);

  return (
    <div className="app">
      <div className="content">
        {/* Conversation ghost text */}
        <div className="convo-area">
          {msgs.map((m, i) => (
            <GhostLine key={m.id} msg={m} rank={msgs.length - 1 - i} />
          ))}
          {partialTranscript && <p className="partial">{partialTranscript}</p>}
        </div>

        {/* Orb */}
        <div className="orb-area" onClick={handleOrbPress}>
          <div className={`orb-container ${orbCls}`}>
            <div className="orb-glow-outer" />
            <div className="orb-glow-mid" />
            {isDark ? <div className="orb-ring" /> : <div className="orb-sphere" />}
          </div>
        </div>

        {/* Brand + state below orb */}
        <div className="below-orb">
          <div className="brand-row">
            <div className="brand-ring"><div className="brand-bead" /></div>
            <span className="brand-word">BEVPRO</span>
          </div>
          {label
            ? <div className="state-label">{label}</div>
            : mode === "idle"
              ? <div className="tap-hint">tap to begin</div>
              : null}
        </div>

        {/* Lower area */}
        <div className="lower">
          {agentState === "speaking" && (
            <div className="interrupt-dot" onClick={interrupt} />
          )}
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bottom-bar">
        <button className="hamburger" onClick={() => setPanelOpen(true)}>
          <Menu size={18} />
        </button>
        <div style={{ flex: 1 }} />
        {orderCount > 0 && (
          <button className="order-badge" onClick={() => { setPanelTab("order"); setPanelOpen(true); }}>
            <span className="order-badge-num">{orderCount}</span>
          </button>
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
