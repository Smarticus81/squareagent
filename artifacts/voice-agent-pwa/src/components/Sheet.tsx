import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { getVoicePrefs, setVoicePref, setSpeedPref, VOICES, SPEEDS } from "@/lib/voice-prefs";
import { getBaseUrl } from "@/lib/api";
import { isWakeWordSupported } from "@/hooks/useWakeWord";
import { isScreenWakeLockSupported, type WakeLockStatus } from "@/hooks/useWakeLock";

export type SheetScreen = "ticket" | "settings";

interface Props {
  open: boolean;
  screen: SheetScreen;
  onScreen: (screen: SheetScreen) => void;
  onClose: () => void;
  screenWakeStatus: WakeLockStatus;
}

/**
 * The sheet — everything that is not the presence lives here, out of the
 * way. Phones get a bottom sheet; wide screens get a right-hand drawer.
 * Two screens: the live ticket and the assistant's settings.
 */
export function Sheet({ open, screen, onScreen, onClose, screenWakeStatus }: Props) {
  const { assistantKind, sessionStatus } = useSquare();
  const signedIn = sessionStatus === "authenticated";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const showTicket = signedIn && assistantKind === "venue";

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={screen === "ticket" ? "Ticket" : "Settings"}>
        <div className="sheet-head">
          <div className="sheet-tabs" role="tablist">
            {showTicket && (
              <button role="tab" aria-selected={screen === "ticket"} className={`sheet-tab${screen === "ticket" ? " is-on" : ""}`} onClick={() => onScreen("ticket")}>
                Ticket
              </button>
            )}
            <button role="tab" aria-selected={screen === "settings"} className={`sheet-tab${screen === "settings" || !showTicket ? " is-on" : ""}`} onClick={() => onScreen("settings")}>
              {signedIn ? "Settings" : "Sign in"}
            </button>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            <CloseGlyph />
          </button>
        </div>
        <div className="sheet-body">
          {screen === "ticket" && showTicket ? <TicketScreen /> : <SettingsScreen screenWakeStatus={screenWakeStatus} />}
        </div>
      </section>
    </>
  );
}

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Ticket ───────────────────────────────────────────────────── */

function TicketScreen() {
  const {
    currentOrder, lastSubmittedOrder,
    updateQuantity, removeItem, clearOrder, submitOrder, isSubmitting, submitError, submitWarning,
  } = useOrder();
  const { isConfigured, venueId, authToken } = useSquare();

  const items = currentOrder?.items ?? [];
  const total = currentOrder?.total ?? 0;

  if (lastSubmittedOrder) {
    return (
      <div className="stack">
        <div className="receipt">
          <p className="receipt-label">Sent to Square</p>
          <p className="receipt-total">${lastSubmittedOrder.total.toFixed(2)}</p>
        </div>
        <ul className="lines">
          {lastSubmittedOrder.items.map((it) => (
            <li key={it.id} className="line">
              <span className="line-qty">{it.quantity}</span>
              <span className="line-name">{it.catalogItem.name}</span>
              <span className="line-price">${(it.catalogItem.price * it.quantity).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <Shortcuts authToken={authToken} venueId={venueId ? Number(venueId) : undefined} />
      </div>
    );
  }

  return (
    <div className="stack">
      {items.length === 0 ? (
        <p className="quiet">Nothing on the ticket. Just say what you need.</p>
      ) : (
        <ul className="lines">
          {items.map((item) => (
            <li key={item.id} className="line">
              <div className="stepper" aria-label={`${item.catalogItem.name} quantity`}>
                <button type="button" onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label="Less">−</button>
                <span>{item.quantity}</span>
                <button type="button" onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label="More">+</button>
              </div>
              <span className="line-name">{item.catalogItem.name}</span>
              <span className="line-price">${(item.catalogItem.price * item.quantity).toFixed(2)}</span>
              <button type="button" className="line-remove" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.catalogItem.name}`}>
                <CloseGlyph />
              </button>
            </li>
          ))}
        </ul>
      )}

      {submitError && <p className="note bad">{submitError}</p>}
      {submitWarning && <p className="note">{submitWarning}</p>}

      {items.length > 0 && (
        <div className="ticket-foot">
          <div className="ticket-total">
            <span>Total</span>
            <strong>${total.toFixed(2)}</strong>
          </div>
          <div className="row">
            <button type="button" className="btn ghost" onClick={clearOrder}>Clear</button>
            <button
              type="button"
              className="btn primary grow"
              disabled={isSubmitting || !isConfigured}
              onClick={() => { void submitOrder(venueId, authToken); }}
            >
              {isSubmitting ? "Sending…" : "Send to terminal"}
            </button>
          </div>
        </div>
      )}

      <Shortcuts authToken={authToken} venueId={venueId ? Number(venueId) : undefined} />
    </div>
  );
}

const SHORTCUTS = [
  { slug: "opening_checklist", label: "Open today" },
  { slug: "stock_take", label: "Stock take" },
  { slug: "end_of_day_close", label: "Close out" },
];

function Shortcuts({ authToken, venueId }: { authToken: string | null; venueId?: number }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = useCallback(async (slug: string) => {
    if (!authToken || !venueId) return;
    setRunning(slug);
    setResult(null);
    try {
      const res = await fetch(`${getBaseUrl()}api/v1/workflows/${slug}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ venueId }),
      });
      const reader = res.body?.getReader();
      if (!reader) { setResult("No response."); return; }
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "step") text += `${data.ok ? "✓" : "✕"} ${data.step}\n${data.result}\n\n`;
            if (data.type === "done") text += data.summary;
            if (data.type === "error") text += `Error: ${data.message}`;
          } catch { /* skip */ }
        }
        setResult(text);
      }
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(null);
    }
  }, [authToken, venueId]);

  if (!authToken || !venueId) return null;

  return (
    <div className="group">
      <p className="group-label">Routines</p>
      <div className="row wrap">
        {SHORTCUTS.map((s) => (
          <button key={s.slug} type="button" className={`chip${running === s.slug ? " is-busy" : ""}`} disabled={running !== null} onClick={() => run(s.slug)}>
            {running === s.slug ? "Running…" : s.label}
          </button>
        ))}
      </div>
      {result && <pre className="result">{result}</pre>}
    </div>
  );
}

/* ── Settings ─────────────────────────────────────────────────── */

function dashboardUrl(path: string): string {
  const { protocol, hostname, port, origin } = window.location;
  const isLocalPwa = (hostname === "localhost" || hostname === "127.0.0.1") && port === "8081";
  const base = isLocalPwa ? `${protocol}//${hostname}:5173` : origin;
  return `${base}${path}`;
}

function voiceEngineLabel(provider?: string): string {
  switch (provider) {
    case "openai_realtime_webrtc": return "OpenAI, direct";
    case "openai_realtime_server_ws": return "OpenAI, relayed";
    case "google_gemini_3_1_flash_live": return "Gemini 3.1 Flash Live";
    case "google_gemini_2_5_flash_native_audio": return "Gemini 2.5 Native Audio";
    case "xai_grok_realtime_ws": return "Grok Voice";
    case "browser_speech_api_fallback": return "Browser speech";
    case "push_to_talk_text_fallback": return "Push to talk";
    case "text_only_fallback": return "Text only";
    default: return provider ? provider.replace(/_/g, " ") : "Default";
  }
}

function roomLabel(mode?: string): string {
  switch (mode) {
    case "loud": return "Loud room";
    case "push_to_talk": return "Push to talk";
    default: return "Standard room";
  }
}

function screenLabel(status: WakeLockStatus): string {
  if (!isScreenWakeLockSupported()) return "Browser may sleep";
  switch (status) {
    case "active": return "Stays on";
    case "blocked": return "Device may sleep";
    case "unsupported": return "Browser may sleep";
    default: return "Off";
  }
}

function SettingsScreen({ screenWakeStatus }: { screenWakeStatus: WakeLockStatus }) {
  const sq = useSquare();
  const signedIn = !!sq.userInfo;

  if (!signedIn && !sq.isConfigured) return <SignIn />;
  if (signedIn && !sq.isConfigured && sq.assistantKind === "venue") return <ConnectSquare />;
  return <AssistantSettings screenWakeStatus={screenWakeStatus} />;
}

function SignIn() {
  const { login, signup } = useSquare();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && !name.trim()) { setError("Your name is required."); return; }
    if (!email.trim() || !password) { setError("Email and password are required."); return; }
    setBusy(true);
    try {
      const err = mode === "login" ? await login(email.trim(), password) : await signup(name.trim(), email.trim(), password);
      if (err) setError(err);
    } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div>
        <h2 className="title">{mode === "login" ? "Sign in" : "Create account"}</h2>
        <p className="quiet">{mode === "login" ? "Bring your assistant online on this device." : "A minute from now your assistant is live."}</p>
      </div>
      {mode === "signup" && (
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </label>
      {error && <p className="note bad">{error}</p>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}>
        {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </form>
  );
}

function ConnectSquare() {
  const {
    venues, pendingSquareLocations, connectSquare, selectSquareLocation, selectVenue, loadCatalog,
    isConnectingSquare, connectionError, refreshCredentials, isReconnecting, logout,
  } = useSquare();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up a connection made in the dashboard tab without a manual refresh.
  useEffect(() => {
    const onFocus = () => { if (!document.hidden) void refreshCredentials(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickLocation(loc: { id: string; name: string; address?: string }) {
    setError(null); setBusy(true);
    try {
      const err = await selectSquareLocation(loc);
      if (err) setError(err); else await loadCatalog();
    } finally { setBusy(false); }
  }
  async function pickVenue(id: number) {
    setError(null); setBusy(true);
    try {
      const err = await selectVenue(id);
      if (err) setError(err); else await loadCatalog();
    } finally { setBusy(false); }
  }

  const hasChoices = pendingSquareLocations.length > 0 || venues.length > 0;

  return (
    <div className="stack">
      <div>
        <h2 className="title">{pendingSquareLocations.length > 0 ? "Choose a location" : "Connect Square"}</h2>
        <p className="quiet">Your assistant runs the venue through Square: tickets, reports, stock.</p>
      </div>
      {pendingSquareLocations.length > 0 ? (
        <ul className="choices">
          {pendingSquareLocations.map((loc) => (
            <li key={loc.id}>
              <button type="button" className="choice" disabled={busy || isConnectingSquare} onClick={() => pickLocation(loc)}>
                <span>{loc.name}</span>
                {loc.address && <small>{loc.address}</small>}
              </button>
            </li>
          ))}
        </ul>
      ) : venues.length > 0 ? (
        <ul className="choices">
          {venues.map((v) => (
            <li key={v.id}>
              <button type="button" className="choice" disabled={busy} onClick={() => pickVenue(v.id)}>
                <span>{v.name}</span>
                {v.squareLocationName && <small>{v.squareLocationName}</small>}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {(error || connectionError) && <p className="note bad">{error ?? connectionError}</p>}
      <button type="button" className="btn primary" disabled={isConnectingSquare || busy} onClick={async () => { setError(null); const err = await connectSquare(); if (err) setError(err); }}>
        {isConnectingSquare ? "Connecting…" : hasChoices ? "Connect another Square account" : "Connect Square"}
      </button>
      <button type="button" className="link" disabled={isReconnecting} onClick={() => { void refreshCredentials(); }}>
        {isReconnecting ? "Checking…" : "Already connected in the dashboard? Refresh"}
      </button>
      <button type="button" className="link dim" onClick={() => { void logout(); }}>Sign out</button>
    </div>
  );
}

function AssistantSettings({ screenWakeStatus }: { screenWakeStatus: WakeLockStatus }) {
  const {
    userInfo, logout, agentProfile, assistantKind, isConfigured, clearCredentials,
    wakePhrase, wakeMode, updateWakeSettings, orderHandlingMode, updateOrderHandlingMode,
  } = useSquare();

  const [prefs, setPrefs] = useState(getVoicePrefs);
  const [phrase, setPhrase] = useState(wakePhrase || "Hey Voyce");
  const [mode, setMode] = useState<"ambient" | "tap">(wakeMode);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handlingBusy, setHandlingBusy] = useState(false);
  const [handlingError, setHandlingError] = useState<string | null>(null);
  const savedTimer = useRef<number | null>(null);

  const pushToTalk = agentProfile?.noiseMode === "push_to_talk";
  const effectiveMode = pushToTalk ? "tap" : mode;
  const provider = agentProfile?.voicePipelineProvider;
  const geminiVoice = provider?.startsWith("google_gemini_") ?? false;
  const name = agentProfile?.displayName ?? (assistantKind === "venue" ? "Venue assistant" : "Assistant");

  useEffect(() => { setPhrase(wakePhrase || "Hey Voyce"); setMode(wakeMode); }, [wakePhrase, wakeMode]);
  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current); }, []);

  const dirty = phrase.trim() !== wakePhrase || effectiveMode !== wakeMode;

  async function save() {
    const trimmed = phrase.trim();
    if (!trimmed) { setError("A wake phrase is required."); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      const err = await updateWakeSettings(trimmed, effectiveMode);
      if (err) setError(err);
      else {
        setSaved(true);
        savedTimer.current = window.setTimeout(() => setSaved(false), 2400);
      }
    } finally { setSaving(false); }
  }

  async function setHandling(next: "auto_complete" | "hold_for_review") {
    if (next === orderHandlingMode) return;
    setHandlingBusy(true); setHandlingError(null);
    try {
      const err = await updateOrderHandlingMode(next);
      if (err) setHandlingError(err);
    } finally { setHandlingBusy(false); }
  }

  return (
    <div className="stack">
      <div className="group">
        <p className="group-label">Assistant</p>
        <h2 className="title">{name}</h2>
        <dl className="facts">
          <div><dt>Voice engine</dt><dd>{voiceEngineLabel(provider)}</dd></div>
          <div><dt>Room</dt><dd>{roomLabel(agentProfile?.noiseMode)}</dd></div>
          <div><dt>Screen</dt><dd>{screenLabel(screenWakeStatus)}</dd></div>
          <div>
            <dt>Square</dt>
            <dd>
              <span className={`dot ${isConfigured ? "on" : ""}`} />
              {isConfigured ? "Connected" : assistantKind === "general" ? "Not needed" : "Not connected"}
            </dd>
          </div>
        </dl>
        <div className="row wrap">
          {agentProfile?.id && (
            <a className="chip" href={dashboardUrl(`/assistants/edit/${encodeURIComponent(agentProfile.id)}`)} target="_blank" rel="noopener noreferrer">
              Edit in dashboard
            </a>
          )}
          <a className="chip" href={dashboardUrl("/services")} target="_blank" rel="noopener noreferrer">Connected systems</a>
          {isConfigured && (
            <button type="button" className="chip" onClick={() => { if (confirm("Disconnect Square on this device?")) clearCredentials(); }}>
              Disconnect Square
            </button>
          )}
        </div>
      </div>

      <div className="group">
        <p className="group-label">Wake</p>
        <label className="field">
          <span>Wake phrase</span>
          <input value={phrase} maxLength={60} onChange={(e) => { setPhrase(e.target.value); setSaved(false); }} placeholder="Hey Voyce" />
        </label>
        <div className="seg" role="radiogroup" aria-label="How the assistant wakes">
          <button type="button" role="radio" aria-checked={effectiveMode === "ambient"} className={effectiveMode === "ambient" ? "is-on" : ""} disabled={pushToTalk} onClick={() => { setMode("ambient"); setSaved(false); }}>
            Always listening
          </button>
          <button type="button" role="radio" aria-checked={effectiveMode === "tap"} className={effectiveMode === "tap" ? "is-on" : ""} onClick={() => { setMode("tap"); setSaved(false); }}>
            Tap to talk
          </button>
        </div>
        {effectiveMode === "ambient" && !isWakeWordSupported() && (
          <p className="quiet">This browser can't listen for a wake phrase. The assistant will wake on tap here.</p>
        )}
        {pushToTalk && <p className="quiet">This assistant is set to push to talk.</p>}
        {error && <p className="note bad">{error}</p>}
        <button type="button" className="btn" disabled={saving || !dirty} onClick={save}>
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>

      {assistantKind === "venue" && (
        <div className="group">
          <p className="group-label">Tickets</p>
          <div className="seg" role="radiogroup" aria-label="What happens when a ticket is sent">
            <button type="button" role="radio" aria-checked={orderHandlingMode === "auto_complete"} className={orderHandlingMode === "auto_complete" ? "is-on" : ""} disabled={handlingBusy} onClick={() => setHandling("auto_complete")}>
              Complete on send
            </button>
            <button type="button" role="radio" aria-checked={orderHandlingMode === "hold_for_review"} className={orderHandlingMode === "hold_for_review" ? "is-on" : ""} disabled={handlingBusy} onClick={() => setHandling("hold_for_review")}>
              Hold for review
            </button>
          </div>
          <p className="quiet">
            {orderHandlingMode === "hold_for_review"
              ? "Sent tickets stay open on the POS for close-out. No payment is taken."
              : "Sent tickets record payment and close on the POS right away."}
          </p>
          {handlingError && <p className="note bad">{handlingError}</p>}
        </div>
      )}

      {!geminiVoice && (
        <div className="group">
          <p className="group-label">Voice</p>
          <div className="row wrap">
            {VOICES.map((v) => (
              <button key={v.id} type="button" className={`chip${prefs.voice === v.id ? " is-on" : ""}`} onClick={() => { setVoicePref(v.id); setPrefs(getVoicePrefs()); }}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="seg" role="radiogroup" aria-label="Speaking speed">
            {SPEEDS.map((s) => (
              <button key={s.label} type="button" role="radio" aria-checked={prefs.speed === s.id} className={prefs.speed === s.id ? "is-on" : ""} onClick={() => { setSpeedPref(s.id); setPrefs(getVoicePrefs()); }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="group account">
        <span className="quiet">{userInfo?.email}</span>
        <button type="button" className="link dim" onClick={() => { void logout(); }}>Sign out</button>
      </div>
    </div>
  );
}
