import React, { useEffect, useRef, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { useVoiceAgent, type AgentState, type OrderCommand, type ConversationMessage } from "@/contexts/VoiceAgentContext";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderPanel } from "@/components/OrderPanel";

/* ── Orb state CSS class ─────────────────────────────────────── */
function orbClass(state: AgentState): string {
  switch (state) {
    case "listening": return "orb-listening";
    case "speaking":  return "orb-speaking";
    case "thinking":  return "orb-thinking";
    case "connecting": return "orb-connecting";
    case "error":     return "orb-error";
    default:          return "";
  }
}

function stateLabel(state: AgentState): string | null {
  switch (state) {
    case "connecting": return "CONNECTING";
    case "thinking":   return "\u00B7  \u00B7  \u00B7";
    case "error":      return "ERROR";
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
    addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId } = useSquare();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"order" | "menu" | "settings">("order");

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
          const tok = tokenRef.current;
          const loc = locRef.current;
          const ord = orderRef.current;
          if (!tok || !loc || !ord?.items.length) break;
          submitOrder(tok, loc).then((r) => {
            if (r.success) { setPanelTab("order"); setPanelOpen(true); }
          });
          break;
        }
      }
    }
  }, [addItem, removeItem, clearOrder, submitOrder]);

  useEffect(() => { setToolHandler(handleCmds); }, [handleCmds, setToolHandler]);

  // Orb press
  function handleOrbPress() {
    if (isConnected || agentState === "connecting") disconnect();
    else connect();
  }

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const msgs = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;
  const label = stateLabel(agentState);

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
          <div className={`orb-container ${orbClass(agentState)}`}>
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
            : agentState === "disconnected"
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
