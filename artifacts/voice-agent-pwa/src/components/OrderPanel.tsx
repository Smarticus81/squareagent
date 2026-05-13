import React, { useEffect, useState } from "react";
import { X, Menu, Trash2, Loader, Link, ChevronRight, Sun, Moon, RefreshCw, LogIn, User, MapPin, LogOut, Mail } from "lucide-react";
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
  const { assistantKind } = useSquare();
  const tabs: ReadonlyArray<"order" | "menu" | "settings"> =
    assistantKind === "general" ? (["settings"] as const) : (["order", "menu", "settings"] as const);

  // If a non-applicable tab was selected, fall back to settings.
  const activeTab = tabs.includes(tab) ? tab : "settings";

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
        {activeTab === "order" && <OrderTab onTabChange={onTabChange} />}
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
  const {
    isConfigured, clearCredentials, connectionError, isReconnecting, refreshCredentials,
    userInfo, venues, login, signup, logout, selectVenue, loadCatalog,
    agentProfile, assistantKind, authToken,
  } = useSquare();

  const [prefs, setPrefs] = useState(getVoicePrefs);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");

  // Auth form state
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);

  const isLoggedIn = !!userInfo;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("voycelab_theme", next);
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

  async function handleAuth() {
    setAuthError(null);
    if (authMode === "signup" && !name.trim()) { setAuthError("Name is required"); return; }
    if (!email.trim() || !password.trim()) { setAuthError("Email and password are required"); return; }
    if (authMode === "signup" && password.length < 8) { setAuthError("Password must be at least 8 characters"); return; }

    setAuthLoading(true);
    try {
      const err = authMode === "login"
        ? await login(email.trim(), password)
        : await signup(name.trim(), email.trim(), password);
      if (err) setAuthError(err);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSelectVenue(venueId: number) {
    setVenueError(null);
    setVenueLoading(true);
    try {
      const err = await selectVenue(venueId);
      if (err) { setVenueError(err); }
      else { await loadCatalog(); }
    } finally {
      setVenueLoading(false);
    }
  }

  return (
    <div style={{ padding: "12px 16px", overflowY: "auto" }}>

      {/* ── Not logged in: Login / Signup ──────────────────── */}
      {!isLoggedIn && !isConfigured ? (
        <div className="auth-section">
          <div className="auth-title">
            {authMode === "login" ? "Sign in to VoyceLab" : "Create your account"}
          </div>
          <div className="auth-sub">
            {authMode === "login"
              ? "Sign in with your VoyceLab account to put your venue on voice."
              : "Create your account and give your venue its voice-powered assistant."}
          </div>

          {authMode === "signup" && (
            <input
              className="auth-input"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}

          <input
            className="auth-input"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
          />

          {authError && (
            <div className="auth-error">{authError}</div>
          )}

          <button
            className="auth-btn"
            onClick={handleAuth}
            disabled={authLoading}
          >
            {authLoading ? <Loader size={16} className="spin" /> : (
              <>
                <LogIn size={16} />
                {authMode === "login" ? "Sign In" : "Create Account"}
              </>
            )}
          </button>

          <button
            className="auth-switch"
            onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(null); }}
          >
            {authMode === "login"
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>

      /* ── Logged in but no venue selected (and not a general assistant) ─── */
      ) : isLoggedIn && !isConfigured && assistantKind !== "general" ? (
        <div className="auth-section">
          <div className="auth-title">Select your venue</div>
          <div className="auth-sub">Choose the venue to use with the voice agent.</div>

          {venues.length > 0 ? (
            <div className="venue-list">
              {venues.map((v) => (
                <button
                  key={v.id}
                  className="venue-row"
                  onClick={() => handleSelectVenue(v.id)}
                  disabled={venueLoading}
                >
                  <MapPin size={15} />
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div className="venue-name">{v.name}</div>
                    {v.squareLocationName && (
                      <div className="venue-sub">{v.squareLocationName}</div>
                    )}
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="venue-empty">
              <MapPin size={22} />
              <span>No venues found</span>
              <span className="auth-sub">Connect your Square account from the VoyceLab dashboard first.</span>
            </div>
          )}

          {venueError && <div className="auth-error">{venueError}</div>}

          <button className="auth-logout" onClick={logout}>
            <LogOut size={14} /> Sign out
          </button>
        </div>

      /* ── Connected — existing settings ────────────────────── */
      ) : (
        <>
          {/* Account info */}
          {isLoggedIn && (
            <div className="settings-row" style={{ padding: "10px 10px", borderBottom: "none" }}>
              <User size={15} />
              <span className="settings-txt" style={{ fontSize: 13, flex: 1 }}>
                {userInfo?.email}
              </span>
              <button className="auth-logout-sm" onClick={logout}>
                <LogOut size={13} /> Sign out
              </button>
            </div>
          )}

          {/* Square Connection — hide entirely for general (non-POS) assistants */}
          {assistantKind === "venue" && (
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
          )}

          {/* Reconnect controls (Square pathway only) */}
          {assistantKind === "venue" && !isConfigured && (
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
              </div>
            </div>
          )}

          <div className="divider" style={{ margin: "8px 0" }} />

          {/* Email / Gmail connection */}
          {isLoggedIn && <GmailSection authToken={authToken} />}

          <div className="divider" style={{ margin: "8px 0" }} />

          {/* Voice */}
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

          {/* Speed */}
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

          {/* Theme */}
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
        </>
      )}
    </div>
  );
}

/* ── Gmail connection ───────────────────────────────────────── */
type EmailConfig = {
  id: number;
  provider: string;
  fromAddress: string | null;
  fromName: string | null;
} | null;

function GmailSection({ authToken }: { authToken: string | null }) {
  const [config, setConfig] = useState<EmailConfig>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [fromName, setFromName] = useState("");

  const headers = (): HeadersInit => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/email", { headers: headers() });
      const data = await res.json();
      setConfig(data.email ?? null);
      if (data.email?.fromName) setFromName(data.email.fromName);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [authToken]);

  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const params = new URLSearchParams();
      if (fromName.trim()) params.set("fromName", fromName.trim());
      const res = await fetch(`/api/oauth/google/start?${params}`, { headers: headers() });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Failed to start Gmail OAuth");

      try { localStorage.removeItem("voycelab_gmail_oauth_result"); } catch {}
      const popup = window.open(data.url, "gmail-oauth", "width=520,height=640");
      if (!popup) throw new Error("Popup blocked. Allow popups and try again.");

      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const onMessage = (ev: MessageEvent) => {
          if (ev.data?.type === "gmail-oauth-result") {
            cleanup();
            ev.data.ok ? resolve() : reject(new Error(ev.data.error || "Authorization failed"));
          }
        };
        window.addEventListener("message", onMessage);
        const interval = window.setInterval(async () => {
          // 1) localStorage signal from popup
          try {
            const raw = localStorage.getItem("voycelab_gmail_oauth_result");
            if (raw) {
              localStorage.removeItem("voycelab_gmail_oauth_result");
              const payload = JSON.parse(raw);
              cleanup();
              payload.ok ? resolve() : reject(new Error(payload.error || "Authorization failed"));
              return;
            }
          } catch {}
          // 2) Server-side check (handles COOP-isolated popups where postMessage/localStorage fail)
          try {
            const r = await fetch("/api/v1/knowledge/email", { headers: headers() });
            if (r.ok) {
              const d = await r.json();
              if (d?.provider === "gmail_oauth") { cleanup(); resolve(); return; }
            }
          } catch {}
          if (Date.now() - start > 5 * 60 * 1000) {
            cleanup();
            reject(new Error("Authorization timed out."));
          }
        }, 2000);
        function cleanup() {
          window.removeEventListener("message", onMessage);
          window.clearInterval(interval);
          try { popup?.close(); } catch {}
        }
      });

      setMsg({ tone: "ok", text: "Gmail connected." });
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Disconnect Gmail?")) return;
    await fetch("/api/v1/knowledge/email", { method: "DELETE", headers: headers() });
    setConfig(null);
    setMsg({ tone: "ok", text: "Gmail disconnected." });
  };

  const isGmail = config?.provider === "gmail_oauth";
  const isResend = config?.provider === "resend";

  return (
    <div style={{ padding: "8px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Mail size={15} />
        <span className="rec-label" style={{ margin: 0 }}>EMAIL</span>
      </div>
      {loading ? (
        <div className="settings-txt" style={{ fontSize: 12, opacity: 0.7 }}>Loading…</div>
      ) : isResend ? (
        <div className="settings-txt" style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.4 }}>
          Resend is configured ({config?.fromAddress}). Manage email providers from the dashboard.
        </div>
      ) : (
        <>
          {isGmail ? (
            <div
              className="settings-row"
              style={{ borderBottom: "none", padding: "8px 6px", gap: 8 }}
            >
              <span className="status-dot" style={{ background: "#22C55E" }} />
              <span className="settings-txt" style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {config?.fromAddress}
              </span>
            </div>
          ) : (
            <div className="settings-txt" style={{ fontSize: 12, opacity: 0.75, marginBottom: 8, lineHeight: 1.4 }}>
              Connect Gmail so the assistant can send messages from your address. Daily limit ~500 emails.
            </div>
          )}
          {!isGmail && (
            <input
              type="text"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="From name (optional)"
              className="auth-input"
              style={{ marginBottom: 8 }}
            />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={connect}
              disabled={busy}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: 20,
                background: "rgba(34,197,94,0.12)", color: "#22C55E",
                border: "1px solid rgba(34,197,94,0.25)",
                fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.6 : 1, fontFamily: "var(--font)",
              }}
            >
              {busy ? <Loader size={13} className="spin" /> : <Mail size={13} />}
              {isGmail ? "Reconnect Gmail" : "Connect Gmail"}
            </button>
            {isGmail && (
              <button
                onClick={remove}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "8px 14px", borderRadius: 20,
                  background: "transparent",
                  border: "1px solid rgba(0,0,0,0.15)",
                  fontSize: 13, fontWeight: 500, cursor: "pointer",
                  fontFamily: "var(--font)", color: "inherit",
                }}
              >
                <Trash2 size={13} /> Disconnect
              </button>
            )}
          </div>
        </>
      )}
      {msg && (
        <div
          className="settings-txt"
          style={{ fontSize: 12, marginTop: 8, color: msg.tone === "error" ? "#EF4444" : "#22C55E" }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
