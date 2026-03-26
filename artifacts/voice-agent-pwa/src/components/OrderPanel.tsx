import React, { useState } from "react";
import { X, Menu, Trash2, Loader, Link, ChevronRight, Sun, Moon, RefreshCw } from "lucide-react";
import { useOrder, type OrderLineItem } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";

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

/* ── Panel nav + body ─────────────────────────────────────── */
function PanelContent({ tab, onTabChange, onClose }: { tab: "order" | "menu" | "settings"; onTabChange: (t: "order" | "menu" | "settings") => void; onClose: () => void }) {
  const tabs = ["order", "menu", "settings"] as const;

  return (
    <>
      <nav className="panel-nav">
        {tabs.map((t) => (
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
    <div style={{ padding: "12px 16px" }}>
      {/* Square Connection — compact status row */}
      <div
        className="settings-row"
        style={{ cursor: isConfigured ? "pointer" : "default", borderBottom: "none", padding: "10px 10px" }}
        onClick={() => {
          if (isConfigured) {
            if (confirm("Disconnect Square? Voice ordering will stop working.")) clearCredentials();
          }
        }}
      >
        <Link size={15} />
        <span className="settings-txt" style={{ fontSize: 14 }}>
          {isConfigured ? "Square Connected" : "Square Not Connected"}
        </span>
        <span className="status-dot" style={{ background: isConfigured ? "#22C55E" : "#EF4444" }} />
        {isConfigured && <ChevronRight size={14} />}
      </div>

      {/* Reconnect controls — compact */}
      {!isConfigured && (
        <div style={{ padding: "4px 10px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
          {connectionError && (
            <div className="error-text" style={{ fontSize: 12, textAlign: "left", padding: 0 }}>{connectionError}</div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              disabled={isReconnecting}
              onClick={async (e) => {
                e.stopPropagation();
                await refreshCredentials();
              }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: 20,
                background: "rgba(34,197,94,0.12)", color: "#22C55E",
                border: "1px solid rgba(34,197,94,0.25)",
                fontSize: 13, fontWeight: 500, cursor: isReconnecting ? "wait" : "pointer",
                opacity: isReconnecting ? 0.6 : 1, fontFamily: "var(--font)",
              }}
            >
              {isReconnecting ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              {isReconnecting ? "Reconnecting…" : "Reconnect"}
            </button>
            <a
              href={getDashboardUrl()}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--link)", textDecoration: "underline" }}
            >
              Dashboard ↗
            </a>
          </div>
        </div>
      )}

      <div className="divider" style={{ margin: "8px 0" }} />



      {/* Voice — horizontal scrollable strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 0 4px" }}>
        <span className="rec-label" style={{ margin: 0, whiteSpace: "nowrap" }}>VOICE</span>
      </div>
      <div className="voice-grid">
        {VOICES.map((v) => (
          <button
            key={v.id}
            className={`voice-chip${prefs.voice === v.id ? " active" : ""}`}
            onClick={() => updateVoice(v.id)}
          >
            <div className="voice-chip-name">{v.label}</div>
          </button>
        ))}
      </div>

      {/* Speed — inline with label */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 4px" }}>
        <span className="rec-label" style={{ margin: 0, whiteSpace: "nowrap" }}>SPEED</span>
        <div className="speed-row" style={{ flex: 1, padding: 0 }}>
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

      <div className="divider" style={{ margin: "8px 0" }} />

      {/* Appearance — compact toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 0 6px" }}>
        <span className="rec-label" style={{ margin: 0, whiteSpace: "nowrap" }}>THEME</span>
        <div className="speed-row" style={{ flex: 1, padding: 0 }}>
          <button
            className={`speed-chip${theme === "light" ? " active" : ""}`}
            onClick={toggleTheme}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <Sun size={13} /> Light
          </button>
          <button
            className={`speed-chip${theme === "dark" ? " active" : ""}`}
            onClick={toggleTheme}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <Moon size={13} /> Dark
          </button>
        </div>
      </div>
    </div>
  );
}
