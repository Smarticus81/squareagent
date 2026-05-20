import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, MoreVertical, Trash2, Loader, Link, ChevronRight, Sun, Moon, RefreshCw, LogIn, User, MapPin, LogOut, Play, ClipboardCheck, Package, Clock } from "lucide-react";
import { useOrder, type OrderLineItem } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderCard } from "./OrderCard";
import { getVoicePrefs, setVoicePref, setSpeedPref, VOICES, SPEEDS } from "@/lib/voice-prefs";
import { getBaseUrl } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  pendingConfirmation?: {
    tool_name: string;
    args: Record<string, unknown>;
    risk_level: string;
    prompt: string;
    call_id: string;
  } | null;
  onConfirm?: () => void;
  onDeny?: () => void;
}

export function OrderPanel({ open, onClose, pendingConfirmation, onConfirm, onDeny }: Props) {
  if (!open) return null;
  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="panel">
        <div className="panel-handle" />
        <PanelContent
          onClose={onClose}
          pendingConfirmation={pendingConfirmation}
          onConfirm={onConfirm}
          onDeny={onDeny}
        />
      </div>
    </>
  );
}

function PanelContent({
  onClose,
  pendingConfirmation,
  onConfirm,
  onDeny,
}: {
  onClose: () => void;
  pendingConfirmation?: Props["pendingConfirmation"];
  onConfirm?: () => void;
  onDeny?: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <nav className="panel-nav">
        <span className="panel-nav-btn active">Order</span>
        <div style={{ flex: 1 }} />
        <button className="panel-nav-btn" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings">
          <MoreVertical size={16} />
        </button>
        <button className="panel-nav-close" onClick={onClose}><X size={16} /></button>
      </nav>
      <div className="panel-body">
        {settingsOpen ? (
          <SettingsSheet onBack={() => setSettingsOpen(false)} />
        ) : (
          <OrderScreen
            pendingConfirmation={pendingConfirmation}
            onConfirm={onConfirm}
            onDeny={onDeny}
          />
        )}
      </div>
    </>
  );
}

function OrderScreen({
  pendingConfirmation,
  onConfirm,
  onDeny,
}: {
  pendingConfirmation?: Props["pendingConfirmation"];
  onConfirm?: () => void;
  onDeny?: () => void;
}) {
  const {
    currentOrder, lastSubmittedOrder,
    updateQuantity, removeItem, clearOrder, submitOrder, isSubmitting, submitError, submitWarning,
  } = useOrder();
  const { isConfigured, accessToken, locationId, authToken, venues } = useSquare();
  const prevCountRef = useRef(0);

  const items = currentOrder?.items ?? [];
  const total = currentOrder?.total ?? 0;

  useEffect(() => {
    if (items.length > prevCountRef.current && items.length > 0) {
      navigator.vibrate?.(50);
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Confirmation banner */}
      {pendingConfirmation && (
        <div className="confirmation-banner">
          <div className="confirmation-text">
            Confirm: {pendingConfirmation.tool_name.replace(/_/g, " ")}
            {pendingConfirmation.risk_level === "high" || pendingConfirmation.risk_level === "destructive"
              ? " (high risk)" : ""}
          </div>
          <div className="confirmation-actions">
            <button className="confirm-btn" onClick={onConfirm}>Confirm</button>
            <button className="deny-btn" onClick={onDeny}>Cancel</button>
          </div>
        </div>
      )}

      {/* Submitted receipt */}
      {lastSubmittedOrder && (
        <div style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <div className="rec-total">${lastSubmittedOrder.total.toFixed(2)}</div>
            <div className="rec-label">SUBMITTED</div>
            <div className="divider" />
          </div>
          {lastSubmittedOrder.items.map((it) => (
            <div key={it.id} className="rec-row">
              <span className="rec-qty">{it.quantity}x</span>
              <span className="rec-name">{it.catalogItem.name}</span>
              <span className="rec-price">${(it.catalogItem.price * it.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Order items */}
      {!lastSubmittedOrder && (
        <>
          {submitError && (
            <div className="error-text" style={{ padding: "12px 16px 0" }}>{submitError}</div>
          )}
          {items.length === 0 ? (
            <div className="empty-panel">
              <span className="empty-txt">no items yet</span>
              <span className="empty-hint">speak to add items</span>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item) => (
                <div key={item.id} style={{ animation: "orderSlideIn 180ms ease-out" }}>
                  <OrderCard
                    lineItem={item}
                    onIncrement={() => updateQuantity(item.id, item.quantity + 1)}
                    onDecrement={() => updateQuantity(item.id, item.quantity - 1)}
                    onRemove={() => removeItem(item.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {items.length > 0 && (
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
          )}
        </>
      )}

      {/* Workflow buttons */}
      <WorkflowButtons authToken={authToken} venueId={venues?.[0]?.id} />

      <style>{`
        @keyframes orderSlideIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .confirmation-banner {
          background: linear-gradient(135deg, #FFF3E0, #FFE0B2);
          border-bottom: 2px solid #FF9800;
          padding: 12px 16px;
        }
        .confirmation-text {
          font-size: 13px;
          font-weight: 600;
          color: #E65100;
          margin-bottom: 8px;
        }
        .confirmation-actions {
          display: flex;
          gap: 8px;
        }
        .confirm-btn {
          flex: 1;
          padding: 10px;
          border-radius: 999px;
          background: #FF6B47;
          color: white;
          border: none;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: var(--font);
        }
        .deny-btn {
          padding: 10px 20px;
          border-radius: 999px;
          background: transparent;
          border: 1px solid rgba(0,0,0,0.2);
          font-size: 13px;
          cursor: pointer;
          font-family: var(--font);
          color: inherit;
        }
      `}</style>
    </div>
  );
}

const WORKFLOW_BUTTONS = [
  { slug: "opening_checklist", label: "Open today", icon: ClipboardCheck },
  { slug: "stock_take", label: "Stock take", icon: Package },
  { slug: "end_of_day_close", label: "Close out", icon: Clock },
];

function WorkflowButtons({ authToken, venueId }: { authToken: string | null; venueId?: number }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const runWorkflow = useCallback(async (slug: string) => {
    if (!authToken || !venueId) return;
    setRunning(slug);
    setResult(null);
    try {
      const res = await fetch(`${getBaseUrl()}api/v1/workflows/${slug}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ venueId }),
      });
      const reader = res.body?.getReader();
      if (!reader) { setResult("No response"); return; }
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "step") text += `${data.ok ? "OK" : "ERR"}: ${data.step}\n${data.result}\n\n`;
              if (data.type === "done") text += `---\n${data.summary}`;
              if (data.type === "error") text += `Error: ${data.message}`;
            } catch { /* skip */ }
          }
        }
        setResult(text);
      }
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setRunning(null);
    }
  }, [authToken, venueId]);

  if (!authToken || !venueId) return null;

  return (
    <div style={{ padding: "8px 16px 16px", borderTop: "1px solid var(--border)" }}>
      <div className="rec-label" style={{ marginBottom: 8 }}>WORKFLOWS</div>
      <div style={{ display: "flex", gap: 8 }}>
        {WORKFLOW_BUTTONS.map((wf) => (
          <button
            key={wf.slug}
            disabled={running !== null}
            onClick={() => runWorkflow(wf.slug)}
            style={{
              flex: 1, padding: "8px 4px", borderRadius: 12,
              border: "1px solid var(--border)",
              background: running === wf.slug ? "var(--brand)" : "transparent",
              color: running === wf.slug ? "#fff" : "inherit",
              fontSize: 11, fontWeight: 600, cursor: running ? "wait" : "pointer",
              fontFamily: "var(--font)", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 4, opacity: running && running !== wf.slug ? 0.5 : 1,
            }}
          >
            {running === wf.slug ? <Loader size={14} className="spin" /> : <wf.icon size={14} />}
            {wf.label}
          </button>
        ))}
      </div>
      {result && (
        <pre style={{
          marginTop: 8, padding: 10, borderRadius: 8, fontSize: 11,
          background: "var(--surface)", border: "1px solid var(--border)",
          maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {result}
        </pre>
      )}
    </div>
  );
}

function SettingsSheet({ onBack }: { onBack: () => void }) {
  const {
    isConfigured, clearCredentials, connectionError, isReconnecting, refreshCredentials,
    userInfo, venues, login, signup, logout, selectVenue, loadCatalog,
    agentProfile, assistantKind, authToken,
  } = useSquare();

  const [prefs, setPrefs] = useState(getVoicePrefs);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");
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
  const updateVoice = (v: string) => { setVoicePref(v); setPrefs(getVoicePrefs()); };
  const updateSpeed = (speed: number) => { setSpeedPref(speed); setPrefs(getVoicePrefs()); };

  async function handleAuth() {
    setAuthError(null);
    if (authMode === "signup" && !name.trim()) { setAuthError("Name is required"); return; }
    if (!email.trim() || !password.trim()) { setAuthError("Email and password are required"); return; }
    setAuthLoading(true);
    try {
      const err = authMode === "login"
        ? await login(email.trim(), password)
        : await signup(name.trim(), email.trim(), password);
      if (err) setAuthError(err);
    } finally { setAuthLoading(false); }
  }

  async function handleSelectVenue(venueId: number) {
    setVenueError(null); setVenueLoading(true);
    try {
      const err = await selectVenue(venueId);
      if (err) setVenueError(err);
      else await loadCatalog();
    } finally { setVenueLoading(false); }
  }

  return (
    <div style={{ padding: "12px 16px", overflowY: "auto" }}>
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 12,
        background: "transparent", border: "none", cursor: "pointer",
        fontSize: 13, fontWeight: 500, fontFamily: "var(--font)", color: "var(--brand)",
      }}>
        <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Back to order
      </button>

      {!isLoggedIn && !isConfigured ? (
        <div className="auth-section">
          <div className="auth-title">{authMode === "login" ? "Sign in to VoyceLab" : "Create your account"}</div>
          {authMode === "signup" && (
            <input className="auth-input" type="text" placeholder="Your name" value={name}
              onChange={(e) => setName(e.target.value)} autoComplete="name" />
          )}
          <input className="auth-input" type="email" placeholder="Email address" value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input className="auth-input" type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()} />
          {authError && <div className="auth-error">{authError}</div>}
          <button className="auth-btn" onClick={handleAuth} disabled={authLoading}>
            {authLoading ? <Loader size={16} className="spin" /> : <><LogIn size={16} /> {authMode === "login" ? "Sign In" : "Create Account"}</>}
          </button>
          <button className="auth-switch" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(null); }}>
            {authMode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      ) : isLoggedIn && !isConfigured && assistantKind !== "general" ? (
        <div className="auth-section">
          <div className="auth-title">Select your venue</div>
          {venues.length > 0 ? (
            <div className="venue-list">
              {venues.map((v) => (
                <button key={v.id} className="venue-row" onClick={() => handleSelectVenue(v.id)} disabled={venueLoading}>
                  <MapPin size={15} />
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div className="venue-name">{v.name}</div>
                    {v.squareLocationName && <div className="venue-sub">{v.squareLocationName}</div>}
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="venue-empty"><MapPin size={22} /><span>No venues found</span></div>
          )}
          {venueError && <div className="auth-error">{venueError}</div>}
          <button className="auth-logout" onClick={logout}><LogOut size={14} /> Sign out</button>
        </div>
      ) : (
        <>
          {isLoggedIn && (
            <div className="settings-row" style={{ padding: "10px 10px", borderBottom: "none" }}>
              <User size={15} />
              <span className="settings-txt" style={{ fontSize: 13, flex: 1 }}>{userInfo?.email}</span>
              <button className="auth-logout-sm" onClick={logout}><LogOut size={13} /> Sign out</button>
            </div>
          )}

          {assistantKind === "venue" && (
            <div className="settings-row" style={{ cursor: isConfigured ? "pointer" : "default", borderBottom: "none", padding: "10px 10px" }}
              onClick={() => { if (isConfigured && confirm("Disconnect Square?")) clearCredentials(); }}>
              <Link size={15} />
              <span className="settings-txt" style={{ fontSize: 14 }}>
                {isConfigured ? "Square Connected" : "Square Not Connected"}
              </span>
              <span className="status-dot" style={{ background: isConfigured ? "#10B981" : "#A1A1AA" }} />
            </div>
          )}

          {assistantKind === "venue" && !isConfigured && (
            <div style={{ padding: "4px 10px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
              {connectionError && <div className="error-text" style={{ fontSize: 12 }}>{connectionError}</div>}
              <button disabled={isReconnecting} onClick={() => refreshCredentials()}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 999,
                  background: "var(--brand)", color: "#FFFFFF", border: "1px solid var(--brand)",
                  fontSize: 13, fontWeight: 600, cursor: isReconnecting ? "wait" : "pointer",
                  opacity: isReconnecting ? 0.6 : 1, fontFamily: "var(--font)" }}>
                {isReconnecting ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
                {isReconnecting ? "Reconnecting..." : "Reconnect"}
              </button>
            </div>
          )}

          <div className="divider" style={{ margin: "8px 0" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 0 4px" }}>
            <span className="rec-label" style={{ margin: 0, whiteSpace: "nowrap" }}>VOICE</span>
          </div>
          <div className="voice-grid">
            {VOICES.map((v) => (
              <button key={v.id} className={`voice-chip${prefs.voice === v.id ? " active" : ""}`} onClick={() => updateVoice(v.id)}>
                <div className="voice-chip-name">{v.label}</div>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 4px" }}>
            <span className="rec-label" style={{ margin: 0 }}>SPEED</span>
            <div className="speed-row" style={{ flex: 1, padding: 0 }}>
              {SPEEDS.map((s) => (
                <button key={s.label} className={`speed-chip${prefs.speed === s.id ? " active" : ""}`} onClick={() => updateSpeed(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divider" style={{ margin: "8px 0" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 0 6px" }}>
            <span className="rec-label" style={{ margin: 0 }}>THEME</span>
            <div className="speed-row" style={{ flex: 1, padding: 0 }}>
              <button className={`speed-chip${theme === "light" ? " active" : ""}`} onClick={toggleTheme}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Sun size={13} /> Light
              </button>
              <button className={`speed-chip${theme === "dark" ? " active" : ""}`} onClick={toggleTheme}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <Moon size={13} /> Dark
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
