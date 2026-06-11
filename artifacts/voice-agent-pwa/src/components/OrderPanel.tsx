import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, MoreVertical, Trash2, Loader, Link, ChevronRight, Sun, Moon, RefreshCw, LogIn, User, MapPin, LogOut, Play, ClipboardCheck, Package, Clock, Mic2, Settings2, Mail, BookOpen, Database, ExternalLink } from "lucide-react";
import { useOrder, type OrderLineItem } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderCard } from "./OrderCard";
import { getVoicePrefs, setVoicePref, setSpeedPref, VOICES, SPEEDS } from "@/lib/voice-prefs";
import { getBaseUrl } from "@/lib/api";
import { isWakeWordSupported } from "@/hooks/useWakeWord";
import { isScreenWakeLockSupported, type WakeLockStatus } from "@/hooks/useWakeLock";
import { commandLabel } from "@/lib/command-labels";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which screen the panel opens on. Defaults to the order screen. */
  initialScreen?: "order" | "settings";
  pendingConfirmation?: {
    tool_name: string;
    args: Record<string, unknown>;
    risk_level: string;
    prompt: string;
    token?: string;
    call_id: string;
  } | null;
  onConfirm?: () => void;
  onDeny?: () => void;
  screenWakeStatus?: WakeLockStatus;
}

export function OrderPanel({ open, onClose, initialScreen = "order", pendingConfirmation, onConfirm, onDeny, screenWakeStatus = "off" }: Props) {
  if (!open) return null;
  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="panel">
        <div className="panel-handle" />
        <PanelContent
          onClose={onClose}
          initialScreen={initialScreen}
          pendingConfirmation={pendingConfirmation}
          onConfirm={onConfirm}
          onDeny={onDeny}
          screenWakeStatus={screenWakeStatus}
        />
      </div>
    </>
  );
}

function PanelContent({
  onClose,
  initialScreen,
  pendingConfirmation,
  onConfirm,
  onDeny,
  screenWakeStatus,
}: {
  onClose: () => void;
  initialScreen: "order" | "settings";
  pendingConfirmation?: Props["pendingConfirmation"];
  onConfirm?: () => void;
  onDeny?: () => void;
  screenWakeStatus: WakeLockStatus;
}) {
  const [settingsOpen, setSettingsOpen] = useState(initialScreen === "settings");

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
          <SettingsSheet onBack={() => setSettingsOpen(false)} screenWakeStatus={screenWakeStatus} />
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
  const { isConfigured, venueId, authToken } = useSquare();
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
            Confirm {commandLabel(pendingConfirmation.tool_name)}
            {pendingConfirmation.risk_level === "high" || pendingConfirmation.risk_level === "destructive"
              ? " (high risk)" : ""}
          </div>
          {pendingConfirmation.prompt && (
            <div className="confirmation-prompt">{pendingConfirmation.prompt}</div>
          )}
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
                    await submitOrder(venueId, authToken);
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
      <WorkflowButtons authToken={authToken} venueId={venueId ? Number(venueId) : undefined} />

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
          margin-bottom: 4px;
        }
        .confirmation-prompt {
          font-size: 12px;
          line-height: 1.35;
          color: #8A3E00;
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

function voicePipelineLabel(provider?: string): string {
  switch (provider) {
    case "openai_realtime_webrtc": return "OpenAI Realtime";
    case "openai_realtime_server_ws": return "OpenAI Relay";
    case "google_gemini_3_1_flash_live": return "Gemini 3.1 Flash Live";
    case "google_gemini_2_5_flash_native_audio": return "Gemini 2.5 Native Audio";
    case "google_gemini_live_native_audio": return "Gemini Live";
    case "browser_speech_api_fallback": return "Browser Speech";
    case "push_to_talk_text_fallback": return "Push to talk";
    case "text_only_fallback": return "Text only";
    default: return provider ? provider.replace(/_/g, " ") : "Default voice";
  }
}

function configuredVoiceLabel(agentProfile: { voicePipelineProvider?: string; voicePipelineConfig?: Record<string, unknown> } | null): string {
  const config = agentProfile?.voicePipelineConfig ?? {};
  const voice = typeof config.voice === "string" ? config.voice : undefined;
  const voiceName = typeof config.voiceName === "string" ? config.voiceName : undefined;
  const provider = agentProfile?.voicePipelineProvider ?? "";
  if (provider.startsWith("google_gemini_")) return voiceName ?? voice ?? "Platform default";
  return voice ?? "PWA preference";
}

function onOffLabel(value: unknown, fallback = "Default"): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return fallback;
}

function thinkingLabel(value: unknown): string {
  return typeof value === "string" && value ? value.replace(/^./, (c) => c.toUpperCase()) : "Minimal";
}

function languageLabel(value: unknown): string {
  if (!Array.isArray(value)) return "Auto";
  const codes = value.filter((code): code is string => typeof code === "string" && code.trim().length > 0);
  return codes.length > 0 ? codes.join(", ") : "Auto";
}

function noiseModeLabel(mode?: string): string {
  switch (mode) {
    case "standard": return "Standard room";
    case "loud": return "Loud venue";
    case "push_to_talk": return "Push to talk";
    default: return "Standard room";
  }
}

function screenWakeLabel(status: WakeLockStatus): string {
  switch (status) {
    case "active": return "Stays on";
    case "unsupported": return "Browser may sleep";
    case "blocked": return "Device may sleep";
    default: return "Off";
  }
}

function screenWakeHint(status: WakeLockStatus, screenWakeSupported: boolean): string {
  if (status === "active") return "Screen lock is active while the assistant is on.";
  if (!screenWakeSupported) return "This browser does not support keeping the display awake.";
  switch (status) {
    case "unsupported": return "This browser does not support keeping the screen awake.";
    case "blocked": return "The device denied screen lock. Check battery or browser settings.";
    default: return "Tap the orb to turn the assistant on.";
  }
}

/**
 * Resolve a dashboard route. The dashboard and PWA share an origin in
 * production (dashboard at /, PWA at /agent/); in local dev the dashboard
 * runs on :5173 next to the PWA's :8081.
 */
function dashboardUrl(path: string): string {
  const { protocol, hostname, port, origin } = window.location;
  const isLocalPwa = (hostname === "localhost" || hostname === "127.0.0.1") && port === "8081";
  const base = isLocalPwa ? `${protocol}//${hostname}:5173` : origin;
  return `${base}${path}`;
}

function assistantEditorUrl(profileId: string): string {
  return dashboardUrl(`/assistants/edit/${encodeURIComponent(profileId)}`);
}

function SettingsSheet({ onBack, screenWakeStatus }: { onBack: () => void; screenWakeStatus: WakeLockStatus }) {
  const {
    isConfigured, clearCredentials, connectionError, isReconnecting, refreshCredentials,
    isConnectingSquare, userInfo, venues, pendingSquareLocations,
    login, signup, logout, connectSquare, selectSquareLocation, selectVenue, loadCatalog,
    agentProfile, assistantKind, wakePhrase, wakeMode,
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

  // When the user connects Square in the dashboard tab and returns here,
  // pick up the new credentials without making them hunt for a button.
  const needsSquareRef = useRef(false);
  needsSquareRef.current = assistantKind === "venue" && !isConfigured;
  useEffect(() => {
    const onFocus = () => {
      if (needsSquareRef.current && !document.hidden) void refreshCredentials();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // refreshCredentials is stable enough for this listener's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleConnectSquare() {
    setVenueError(null);
    const err = await connectSquare();
    if (err) setVenueError(err);
  }

  async function handleSelectSquareLocation(location: { id: string; name: string; address?: string }) {
    setVenueError(null);
    setVenueLoading(true);
    try {
      const err = await selectSquareLocation(location);
      if (err) setVenueError(err);
      else await loadCatalog();
    } finally {
      setVenueLoading(false);
    }
  }

  const selectedProvider = agentProfile?.voicePipelineProvider;
  const isGeminiVoice = selectedProvider?.startsWith("google_gemini_") ?? false;
  const voiceConfig = agentProfile?.voicePipelineConfig ?? {};
  const assistantName = agentProfile?.displayName ?? (assistantKind === "venue" ? "Venue assistant" : "General assistant");
  const profileId = agentProfile?.id;
  const connectedSystem = assistantKind === "venue"
    ? (isConfigured ? "Square connected" : "Square not connected")
    : "General assistant";
  const browserWakeSupported = isWakeWordSupported();
  const screenWakeSupported = isScreenWakeLockSupported();
  const pushToTalkRequired = agentProfile?.noiseMode === "push_to_talk";
  const ambientWakeConfigured = wakeMode !== "tap" && !pushToTalkRequired;
  const wakeRuntimeLabel = !ambientWakeConfigured
    ? "Tap to speak"
    : browserWakeSupported
      ? (wakePhrase || "Hey assistant")
      : "Tap fallback";
  const wakeDetailLabel = !ambientWakeConfigured
    ? pushToTalkRequired ? "Push to talk" : "Tap only"
    : browserWakeSupported
      ? "Wake phrase"
      : "Wake phrase unavailable";

  return (
    <div className="settings-sheet">
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
      ) : isLoggedIn && !isConfigured ? (
        <div className="auth-section">
          <div className="auth-title">
            {pendingSquareLocations.length > 0 ? "Choose Square location" : "Connect Square"}
          </div>
          {pendingSquareLocations.length > 0 ? (
            <div className="venue-list">
              {pendingSquareLocations.map((loc) => (
                <button key={loc.id} className="venue-row" onClick={() => handleSelectSquareLocation(loc)} disabled={venueLoading || isConnectingSquare}>
                  <MapPin size={15} />
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div className="venue-name">{loc.name}</div>
                    {loc.address && <div className="venue-sub">{loc.address}</div>}
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : venues.length > 0 ? (
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
            <div className="venue-empty"><MapPin size={22} /><span>No Square venues connected</span></div>
          )}
          {venueError && <div className="auth-error">{venueError}</div>}
          {connectionError && <div className="auth-error">{connectionError}</div>}
          <button className="auth-btn" onClick={handleConnectSquare} disabled={isConnectingSquare || venueLoading}>
            {isConnectingSquare ? <Loader size={16} className="spin" /> : <Link size={16} />}
            {isConnectingSquare ? "Connecting..." : "Connect Square"}
          </button>
          <button className="auth-switch" onClick={() => { window.location.href = `${getBaseUrl()}services`; }}>
            Manage all integrations
          </button>
          <button className="auth-logout" onClick={logout}><LogOut size={14} /> Sign out</button>
        </div>
      ) : (
        <>
          {isLoggedIn && (
            <div className="settings-account-strip">
              <div className="settings-account-main">
                <User size={14} />
                <span>{userInfo?.email}</span>
              </div>
              <button className="auth-logout-sm" onClick={logout}><LogOut size={13} /> Sign out</button>
            </div>
          )}

          <div className="settings-summary">
            <div>
              <div className="settings-summary-label">Assistant</div>
              <div className="settings-summary-value">{assistantName}</div>
            </div>
            <div>
              <div className="settings-summary-label">Start mode</div>
              <div className="settings-summary-value">
                {wakeRuntimeLabel}
              </div>
            </div>
            <div>
              <div className="settings-summary-label">Voice engine</div>
              <div className="settings-summary-value">{voicePipelineLabel(selectedProvider)}</div>
            </div>
            <div>
              <div className="settings-summary-label">System</div>
              <div className="settings-summary-value">
                {connectedSystem}
                <span className="status-dot" style={{ background: assistantKind === "general" || isConfigured ? "#10B981" : "#A1A1AA" }} />
              </div>
            </div>
          </div>

          {profileId && (
            <button
              className="settings-edit-action"
              type="button"
              onClick={() => window.open(assistantEditorUrl(profileId), "_blank", "noopener,noreferrer")}
            >
              <Settings2 size={14} /> Edit assistant
            </button>
          )}

          <details className="settings-group" open={assistantKind === "venue" && !isConfigured}>
            <summary>
              <span><Link size={14} /> Connected systems</span>
              <ChevronRight size={14} />
            </summary>
            <div className="settings-group-body">
              <button
                className="settings-row compact"
                style={{ cursor: isConfigured ? "pointer" : "default" }}
                onClick={() => { if (isConfigured && confirm("Disconnect Square?")) clearCredentials(); }}
              >
                <span className="settings-txt" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Package size={14} /> {isConfigured ? "Square connected" : "Square not connected"}
                </span>
                <span className="status-dot" style={{ background: isConfigured ? "#10B981" : "#A1A1AA" }} />
              </button>
              {assistantKind === "venue" && !isConfigured && (
                <div className="settings-action-stack">
                  {connectionError && <div className="error-text" style={{ fontSize: 12 }}>{connectionError}</div>}
                  <button
                    className="settings-primary-action"
                    onClick={() => window.open(dashboardUrl("/services"), "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink size={13} /> Connect Square
                  </button>
                  <button className="settings-secondary-action" disabled={isReconnecting} onClick={() => refreshCredentials()}>
                    {isReconnecting ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
                    {isReconnecting ? "Checking connection..." : "I already connected — refresh"}
                  </button>
                </div>
              )}
              {assistantKind === "general" && !isConfigured && isLoggedIn && (
                <div className="settings-action-stack">
                  <button
                    className="settings-primary-action"
                    onClick={() => window.open(dashboardUrl("/services"), "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink size={13} /> Connect Square
                  </button>
                </div>
              )}
              <div className="settings-mini-row">
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Mail size={13} /> Email</span>
                <strong>Manage in dashboard</strong>
              </div>
              <div className="settings-mini-row">
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}><BookOpen size={13} /> Knowledge base</span>
                <strong>Manage in dashboard</strong>
              </div>
              <div className="settings-mini-row">
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Database size={13} /> Database</span>
                <strong>Manage in dashboard</strong>
              </div>
              {(isLoggedIn || isConfigured) && (
                <div className="settings-action-stack">
                  <button
                    className="settings-secondary-action"
                    onClick={() => window.open(dashboardUrl("/services"), "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink size={13} /> Manage connected systems
                  </button>
                </div>
              )}
              <p className="settings-muted">
                Connections you add in the dashboard are picked up here automatically.
              </p>
            </div>
          </details>

          <details className="settings-group">
            <summary>
              <span><Mic2 size={14} /> Activation</span>
              <ChevronRight size={14} />
            </summary>
            <div className="settings-group-body">
              <div className="settings-mini-row">
                <span>Mode</span>
                <strong>{wakeDetailLabel}</strong>
              </div>
              {ambientWakeConfigured && (
                <div className="settings-mini-row">
                  <span>Phrase</span>
                  <strong>{wakePhrase || "Hey assistant"}</strong>
                </div>
              )}
              <div className="settings-mini-row">
                <span>Room behavior</span>
                <strong>{noiseModeLabel(agentProfile?.noiseMode)}</strong>
              </div>
              <div className="settings-mini-row">
                <span>Screen</span>
                <strong>{screenWakeLabel(screenWakeStatus)}</strong>
              </div>
              <p className="settings-muted">
                {screenWakeHint(screenWakeStatus, screenWakeSupported)}
              </p>
            </div>
          </details>

          <details className="settings-group">
            <summary>
              <span><Play size={14} /> Voice</span>
              <ChevronRight size={14} />
            </summary>
            <div className="settings-group-body">
              <div className="settings-mini-row">
                <span>Engine</span>
                <strong>{voicePipelineLabel(selectedProvider)}</strong>
              </div>
              <div className="settings-mini-row">
                <span>Voice</span>
                <strong>{configuredVoiceLabel(agentProfile)}</strong>
              </div>
              {!isGeminiVoice ? (
                <>
                  <div className="voice-grid">
                    {VOICES.map((v) => (
                      <button key={v.id} className={`voice-chip${prefs.voice === v.id ? " active" : ""}`} onClick={() => updateVoice(v.id)}>
                        <div className="voice-chip-name">{v.label}</div>
                      </button>
                    ))}
                  </div>

                  <div className="settings-mini-label">Speed</div>
                  <div className="speed-row">
                    {SPEEDS.map((s) => (
                      <button key={s.label} className={`speed-chip${prefs.speed === s.id ? " active" : ""}`} onClick={() => updateSpeed(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-mini-row">
                    <span>Proactive audio</span>
                    <strong>{onOffLabel(voiceConfig.proactiveAudio, "Default")}</strong>
                  </div>
                  <div className="settings-mini-row">
                    <span>Affective dialog</span>
                    <strong>{onOffLabel(voiceConfig.affectiveDialog, "Off")}</strong>
                  </div>
                  <div className="settings-mini-row">
                    <span>Thinking</span>
                    <strong>{thinkingLabel(voiceConfig.thinkingLevel)}</strong>
                  </div>
                  <div className="settings-mini-row">
                    <span>Language</span>
                    <strong>{languageLabel(voiceConfig.languageCodes)}</strong>
                  </div>
                  <p className="settings-muted">Change these from the assistant editor.</p>
                </>
              )}
            </div>
          </details>

          <details className="settings-group">
            <summary>
              <span><Sun size={14} /> Appearance</span>
              <ChevronRight size={14} />
            </summary>
            <div className="settings-group-body">
              <div className="speed-row">
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
          </details>
        </>
      )}
    </div>
  );
}
