import React, { useState } from "react";
import { X, Menu, Trash2, Loader, Link, ChevronRight } from "lucide-react";
import { useOrder, type OrderLineItem } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { useVoiceAgent, type AgentMode } from "@/contexts/VoiceAgentContext";
import { OrderCard } from "./OrderCard";
import { getVoicePrefs, setVoicePref, setSpeedPref, VOICES, SPEEDS } from "@/lib/voice-prefs";

interface Props {
  open: boolean;
  tab: "order" | "menu" | "settings";
  onTabChange: (t: "order" | "menu" | "settings") => void;
  onClose: () => void;
}

export function OrderPanel({ open, tab, onTabChange, onClose }: Props) {
  if (!open) return null;

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="panel">
        <div className="panel-handle" />
        <nav className="panel-nav">
          {(["order", "menu", "settings"] as const).map((t) => (
            <button key={t} className={`panel-nav-btn${tab === t ? " active" : ""}`} onClick={() => onTabChange(t)}>
              {t}
            </button>
          ))}
          <button className="panel-nav-close" onClick={onClose}><X size={16} /></button>
        </nav>
        <div className="panel-body">
          {tab === "order" && <OrderTab onTabChange={onTabChange} />}
          {tab === "menu" && <MenuTab onTabChange={onTabChange} />}
          {tab === "settings" && <SettingsTab />}
        </div>
      </div>
    </>
  );
}

/* ── Order Tab ─────────────────────────────────────────────── */
function OrderTab({ onTabChange }: { onTabChange: (t: "order" | "menu" | "settings") => void }) {
  const {
    currentOrder, lastSubmittedOrder,
    updateQuantity, removeItem, clearOrder, submitOrder, isSubmitting, submitError, submitWarning,
  } = useOrder();
  const { isConfigured, accessToken, locationId } = useSquare();

  if (lastSubmittedOrder) {
    return (
      <div style={{ padding: 24 }}>
        {submitWarning && (
          <div className="error-text" style={{ marginBottom: 12 }}>
            {submitWarning}
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <div className="rec-total">${lastSubmittedOrder.total.toFixed(2)}</div>
          <div className="rec-label">SUBMITTED</div>
          <div className="divider" />
        </div>
        {lastSubmittedOrder.items.map((it) => (
          <div key={it.id} className="rec-row">
            <span className="rec-qty">{it.quantity}×</span>
            <span className="rec-name">{it.catalogItem.name}</span>
            <span className="rec-price">${(it.catalogItem.price * it.quantity).toFixed(2)}</span>
          </div>
        ))}
        <a
          href="https://squareup.com/dashboard/orders"
          target="_blank"
          rel="noopener noreferrer"
          className="link"
          style={{ display: "inline-block", marginTop: 14 }}
        >
          view in Square ↗
        </a>
      </div>
    );
  }

  const items = currentOrder?.items ?? [];
  const total = currentOrder?.total ?? 0;

  if (items.length === 0) {
    return (
      <div className="empty-panel">
        <span className="empty-txt">no items yet</span>
        <span className="empty-hint">speak to add items</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {submitError && (
        <div className="error-text" style={{ padding: "12px 16px 0" }}>
          {submitError}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <OrderCard
            key={item.id}
            lineItem={item}
            onIncrement={() => updateQuantity(item.id, item.quantity + 1)}
            onDecrement={() => updateQuantity(item.id, item.quantity - 1)}
            onRemove={() => removeItem(item.id)}
          />
        ))}
      </div>
      <div className="order-footer">
        {submitWarning && <div className="error-text" style={{ marginBottom: 8 }}>{submitWarning}</div>}
        <div className="order-total">${total.toFixed(2)}</div>
        <div className="order-actions">
          <button className="clear-btn" onClick={clearOrder}><Trash2 size={15} /></button>
          <button
            className="submit-btn"
            disabled={isSubmitting || !isConfigured}
            onClick={async () => {
              if (!accessToken || !locationId) return;
              await submitOrder(accessToken, locationId);
            }}
          >
            {isSubmitting ? <Loader size={16} className="spin" /> : "process"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Menu Tab ──────────────────────────────────────────────── */
function MenuTab({ onTabChange }: { onTabChange: (t: "order" | "menu" | "settings") => void }) {
  const { isConfigured, catalogItems, isLoadingCatalog } = useSquare();
  const { addItem } = useOrder();

  if (isLoadingCatalog) {
    return <div className="empty-panel"><Loader size={18} className="spin" /></div>;
  }

  if (!isConfigured) {
    return (
      <div className="empty-panel">
        <span className="empty-txt">square not connected</span>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto" }}>
      {catalogItems.map((item) => (
        <div
          key={item.id}
          className="cat-row"
          onClick={() => { addItem(item, 1); onTabChange("order"); }}
        >
          <div style={{ flex: 1 }}>
            <div className="cat-name">{item.name}</div>
            {item.category && <div className="cat-cat">{item.category}</div>}
          </div>
          <span className="cat-price">${item.price.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Settings Tab ──────────────────────────────────────────── */
function SettingsTab() {
  const { isConfigured, clearCredentials, pendingOAuthToken, pendingLocations, completePendingOAuth, startOAuthRedirect } = useSquare();
  const { agentMode, setAgentMode, isConnected } = useVoiceAgent();
  const [prefs, setPrefs] = useState(getVoicePrefs);

  const updateVoice = (v: string) => {
    setVoicePref(v);
    setPrefs(getVoicePrefs());
  };
  const updateSpeed = (speed: number) => {
    setSpeedPref(speed);
    setPrefs(getVoicePrefs());
  };

  return (
    <div style={{ padding: 16 }}>
      {/* Square Connection — interactive */}
      <div
        className="settings-row"
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (isConfigured) {
            if (confirm("Disconnect Square? Voice ordering will stop working.")) clearCredentials();
          } else if (!pendingOAuthToken) {
            startOAuthRedirect();
          }
        }}
      >
        <Link size={16} />
        <span className="settings-txt">
          {pendingOAuthToken ? "Select Location" : isConfigured ? "Square Connected" : "Connect Square"}
        </span>
        <span className="status-dot" style={{ background: isConfigured ? "#22C55E" : pendingOAuthToken ? "#F59E0B" : "#EF4444" }} />
        <ChevronRight size={15} />
      </div>

      {/* Location picker after OAuth redirect return */}
      {pendingOAuthToken && pendingLocations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="rec-label" style={{ marginBottom: 4 }}>PICK A LOCATION</div>
          {pendingLocations.map((loc) => (
            <div
              key={loc.id}
              className="cat-row"
              onClick={() => completePendingOAuth(loc.id)}
            >
              <div style={{ flex: 1 }}>
                <div className="cat-name">{loc.name}</div>
                {loc.address && <div className="cat-cat">{loc.address}</div>}
              </div>
              <ChevronRight size={15} />
            </div>
          ))}
        </div>
      )}

      <div className="divider" style={{ marginTop: 16, marginBottom: 12 }} />
      <div className="rec-label">AGENT MODE</div>
      <div className="speed-row">
        {([{ id: "pos" as AgentMode, label: "POS" }, { id: "inventory" as AgentMode, label: "Inventory" }]).map((m) => (
          <button
            key={m.id}
            className={`speed-chip${agentMode === m.id ? " active" : ""}`}
            disabled={isConnected}
            onClick={() => setAgentMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {isConnected && <div className="empty-hint" style={{ fontSize: 11, marginTop: 4, opacity: 0.5 }}>disconnect to switch modes</div>}

      <div className="divider" style={{ marginTop: 16, marginBottom: 12 }} />
      <div className="rec-label">VOICE</div>
      <div className="voice-grid">
        {VOICES.map((v) => (
          <button
            key={v.id}
            className={`voice-chip${prefs.voice === v.id ? " active" : ""}`}
            onClick={() => updateVoice(v.id)}
          >
            <div className="voice-chip-name">{v.label}</div>
            <div className="voice-chip-desc">{v.desc}</div>
          </button>
        ))}
      </div>

      <div className="divider" style={{ marginTop: 12, marginBottom: 12 }} />
      <div className="rec-label">SPEED</div>
      <div className="speed-row">
        {SPEEDS.map((s) => (
          <button
            key={s.label}
            className={`speed-chip${prefs.speed === s.id ? " active" : ""}`}
            onClick={() => updateSpeed(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
