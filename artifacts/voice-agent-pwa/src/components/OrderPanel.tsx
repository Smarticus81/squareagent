import React, { useState } from "react";
import { X, Menu, Trash2, Loader, Link, ChevronRight, Sun, Moon, RefreshCw } from "lucide-react";
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
        <PanelContent tab={tab} onTabChange={onTabChange} onClose={onClose} />
      </div>
    </>
  );
}

/* ── Panel nav + body, gated by agent mode ────────────────── */
function PanelContent({ tab, onTabChange, onClose }: { tab: "order" | "menu" | "settings"; onTabChange: (t: "order" | "menu" | "settings") => void; onClose: () => void }) {
  const { agentMode } = useVoiceAgent();
  const isInventory = agentMode === "inventory";
  // Inventory mode: only show menu + settings (no order tab)
  const tabs = isInventory
    ? (["menu", "settings"] as const)
    : (["order", "menu", "settings"] as const);

  // If current tab is "order" in inventory mode, redirect to menu
  const activeTab = (isInventory && tab === "order") ? "menu" : tab;

  return (
    <>
      <nav className="panel-nav">
        {tabs.map((t) => (
          <button key={t} className={`panel-nav-btn${activeTab === t ? " active" : ""}`} onClick={() => onTabChange(t)}>
            {t}
          </button>
        ))}
        <button className="panel-nav-close" onClick={onClose}><X size={16} /></button>
      </nav>
      <div className="panel-body">
        {activeTab === "order" && !isInventory && <OrderTab onTabChange={onTabChange} />}
        {activeTab === "menu" && <MenuTab onTabChange={onTabChange} />}
        {activeTab === "settings" && <SettingsTab />}
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
        <span className="empty-hint">open settings to reconnect</span>
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
  const { isConfigured, clearCredentials, connectionError, isReconnecting, refreshCredentials } = useSquare();
  const { agentMode, setAgentMode, isConnected } = useVoiceAgent();
  const [prefs, setPrefs] = useState(getVoicePrefs);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

  // Dashboard lives at the root of the same origin (without /agent/)
  const getDashboardUrl = () => {
    const origin = window.location.origin;
    return `${origin}/dashboard`;
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("bevpro_theme", next);
    setTheme(next);
  };

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
      {/* Square Connection — status + reconnect */}
      <div
        className="settings-row"
        style={{ cursor: isConfigured ? "pointer" : "default" }}
        onClick={() => {
          if (isConfigured) {
            if (confirm("Disconnect Square? Voice ordering will stop working.")) clearCredentials();
          }
        }}
      >
        <Link size={16} />
        <span className="settings-txt">
          {isConfigured ? "Square Connected" : "Square Not Connected"}
        </span>
        <span className="status-dot" style={{ background: isConfigured ? "#22C55E" : "#EF4444" }} />
        {isConfigured && <ChevronRight size={15} />}
      </div>

      {/* Reconnect controls when not connected */}
      {!isConfigured && (
        <div style={{ padding: "8px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {connectionError && (
            <div className="error-text" style={{ fontSize: 12 }}>{connectionError}</div>
          )}
          <button
            className="reconnect-btn"
            disabled={isReconnecting}
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await refreshCredentials();
              if (ok) {
                // Credentials refreshed — catalog will auto-load
              }
            }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "10px 16px", borderRadius: 6,
              background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))",
              border: "1px solid hsl(var(--primary) / 0.25)",
              fontSize: 13, fontWeight: 500, cursor: isReconnecting ? "wait" : "pointer",
              opacity: isReconnecting ? 0.6 : 1,
            }}
          >
            {isReconnecting ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
            {isReconnecting ? "Reconnecting..." : "Reconnect Square"}
          </button>
          <a
            href={getDashboardUrl()}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block", textAlign: "center",
              fontSize: 12, color: "hsl(var(--foreground) / 0.4)",
              textDecoration: "underline", padding: "4px 0",
            }}
          >
            Open dashboard to manage connection
          </a>
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
            onClick={() => {
              setAgentMode(m.id);
              // Navigate to the correct URL path for this mode
              const base = window.location.pathname.replace(/\/(pos|inventory)\/?$/i, "").replace(/\/+$/, "");
              const newPath = `${base}/${m.id}${window.location.search}`;
              window.history.replaceState({}, "", newPath);
            }}
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

      <div className="divider" style={{ marginTop: 16, marginBottom: 12 }} />
      <div className="rec-label">APPEARANCE</div>
      <div className="speed-row">
        <button
          className={`speed-chip${theme === "light" ? " active" : ""}`}
          onClick={toggleTheme}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Sun size={13} /> Light
        </button>
        <button
          className={`speed-chip${theme === "dark" ? " active" : ""}`}
          onClick={toggleTheme}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Moon size={13} /> Dark
        </button>
      </div>
    </div>
  );
}
