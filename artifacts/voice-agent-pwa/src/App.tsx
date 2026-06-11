import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { useVoiceAgent, type AgentState, type OrderCommand, type ConversationMessage, type PendingConfirmation } from "@/contexts/VoiceAgentContext";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { OrderPanel } from "@/components/OrderPanel";
import { VoiceOrb } from "@/components/VoiceOrb";
import { useWakeWord, isWakeWordSupported } from "@/hooks/useWakeWord";
import { useWakeLock } from "@/hooks/useWakeLock";
import { soundWake, soundItemAdd, soundSubmit, soundError, soundSleep } from "@/lib/sounds";
import { matchTermination } from "@/lib/voice-termination";
import { commandLabel } from "@/lib/command-labels";

const DEBUG_APP_EVENTS = import.meta.env.DEV;

function debugAppLog(message: string, ...args: unknown[]): void {
  if (DEBUG_APP_EVENTS) console.log(message, ...args);
}

const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, "/");

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

function buildWakeWords(wakePhrase: string): string[] {
  const normalized = wakePhrase.toLowerCase().trim();
  const compact = normalized.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
  // Always include a small set of safe, multi-syllable defaults.
  const words = new Set<string>(["hey voyce", "hey voicelab", "hey voycelab", "voycelab"]);
  if (compact) {
    // Always include the full configured phrase as-is.
    words.add(compact);
    // Ensure a "hey {name}" variant exists, but never the bare name on its
    // own — single-word names like "bev" or "max" overlap with common
    // English ("beverage", "maximum") and produce false wakes.
    if (!compact.startsWith("hey ")) {
      words.add(`hey ${compact}`);
    }
  } else {
    words.add("hey voyce");
  }
  return Array.from(words);
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
    agentState, isConnected, conversation, partialTranscript, error, remoteStream,
    pendingConfirmation, connect, prewarm, activate, releaseStandby, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setAuthParams,
    confirmPending, denyPending,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, markVoiceOrderSubmitted, submitOrder, isSubmitting,
  } = useOrder();

  const {
    isConfigured,
    catalogItems,
    isLoadingCatalog,
    catalogError,
    venueId: sqVenueId,
    authToken: sqAuthToken,
    agentProfile,
    agentProfileId,
    wakePhrase,
    wakeMode,
    assistantKind,
  } = useSquare();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelScreen, setPanelScreen] = useState<"order" | "settings">("order");
  const [mode, setMode] = useState<AppMode>("idle");
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const modeRef = useRef<AppMode>("idle");
  const prevItemCountRef = useRef(0);
  const terminationHandledRef = useRef(false);
  const pushToTalkRequired = agentProfile?.noiseMode === "push_to_talk";
  const wakeEnabled = wakeMode !== "tap" && !pushToTalkRequired;
  const wakeWordAvailable = wakeEnabled && isWakeWordSupported();

  // Venue mode is an always-on surface: keep the display awake whenever the
  // PWA is online, even before microphone permission has been granted.
  const keepScreenAwake = mode !== "shutdown";
  const wakeLockStatus = useWakeLock(keepScreenAwake);

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
  useEffect(() => { catalogRef.current = catalogItems; }, [catalogItems]);
  useEffect(() => { orderRef.current = currentOrder; }, [currentOrder]);

  // Push catalog to voice agent
  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({
      id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category,
    })));
  }, [catalogItems, setCatalog]);

  // Pass venueId + auth JWT to voice agent for server-side credential lookup.
  // Always pass the auth token whenever we have one — the general assistant
  // works without a venue or assistant profile and just needs the JWT.
  useEffect(() => {
    const venueId = sqVenueId || "";
    const authToken = sqAuthToken || "";
    setAuthParams(
      venueId,
      authToken,
      agentProfileId ?? undefined,
      agentProfile?.voicePipelineProvider,
      agentProfile?.voicePipelineConfig,
    );
  }, [sqVenueId, sqAuthToken, agentProfileId, agentProfile, setAuthParams]);

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
            setPanelScreen("order");
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
    debugAppLog("[App] Wake word detected - activating session");
    // Instant local cue; the assistant's spoken greeting follows from the
    // pre-warmed session, so skip the old delayed chime to avoid overlap.
    soundWake();
    setMode("command");
    void activate({ greet: true });
  }, [activate]);

  const onStopDetected = useCallback(() => {
    debugAppLog("[App] Terminating phrase - back to wake word mode");
    soundSleep();
    const wasCommand = modeRef.current === "command";
    setMode(wakeWordAvailable ? "wake_word" : "idle");
    if (wasCommand) void disconnect();
  }, [disconnect, wakeWordAvailable]);

  const onShutdownDetected = useCallback(() => {
    debugAppLog("[App] Shutdown phrase - stopping completely");
    soundSleep();
    const wasCommand = modeRef.current === "command";
    setMode("shutdown");
    if (wasCommand) void disconnect();
  }, [disconnect]);

  const wakeWords = useMemo(() => buildWakeWords(wakePhrase), [wakePhrase]);

  const { isListening: wakeWordListening, startWakeWord, stopWakeWord } = useWakeWord({
    wakeWords,
    confidenceThreshold: 0.5,
    onWakeWordDetected,
    onStopDetected,
    onShutdownDetected,
  });

  useEffect(() => {
    let cancelled = false;
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        const sync = () => {
          if (!cancelled) setMicPermissionGranted(status.state === "granted");
        };
        sync();
        status.onchange = sync;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // If the app opens with a valid session and ambient wake is available, move
  // straight into wake mode. Browsers that need mic permission will prompt or
  // fall back to the existing tap flow.
  useEffect(() => {
    if (mode === "idle" && sqAuthToken && wakeWordAvailable) {
      setMode("wake_word");
    }
  }, [mode, sqAuthToken, wakeWordAvailable]);

  useEffect(() => {
    if (mode === "wake_word" && !wakeWordAvailable) {
      setMode("idle");
    }
  }, [mode, wakeWordAvailable]);

  // When agent disconnects naturally or via response, return to wake listening (unless fully shut down)
  useEffect(() => {
    if (mode === "command" && agentState === "disconnected") {
      setMode(wakeWordAvailable ? "wake_word" : "idle");
    }
  }, [mode, agentState, wakeWordAvailable]);

  useEffect(() => {
    if (mode === "command") terminationHandledRef.current = false;
  }, [mode]);

  // Play error sound on error state
  useEffect(() => {
    if (agentState === "error") soundError();
  }, [agentState]);

  // Start/stop wake word based on mode. The short delay lets the previous
  // session's mic tracks release; the hook's own retry loop covers stragglers.
  useEffect(() => {
    if (mode === "wake_word" && wakeWordAvailable) {
      const timer = setTimeout(() => startWakeWord(), 250);
      return () => clearTimeout(timer);
    } else {
      stopWakeWord();
    }
  }, [mode, wakeWordAvailable, startWakeWord, stopWakeWord]);

  // Keep a pre-connected standby voice session while waiting for the wake word
  // so activation (and the spoken greeting) starts in milliseconds, not after
  // a full token-mint + WebRTC handshake. Dropped when leaving wake mode.
  useEffect(() => {
    if (mode === "wake_word") {
      const timer = setTimeout(() => { void prewarm(); }, 150);
      return () => clearTimeout(timer);
    }
    if (mode === "idle" || mode === "shutdown") releaseStandby();
  }, [mode, prewarm, releaseStandby]);

  const applyVoiceTermination = useCallback(
    (kind: "soft" | "hard") => {
      if (terminationHandledRef.current) return;
      terminationHandledRef.current = true;
      soundSleep();
      setMode(kind === "hard" ? "shutdown" : wakeWordAvailable ? "wake_word" : "idle");
      void disconnect();
    },
    [disconnect, wakeWordAvailable],
  );

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
      const kind = matchTermination(lastMsg.content);
      if (kind) applyVoiceTermination(kind);
    }
  }, [conversation, mode, applyVoiceTermination]);

  useEffect(() => {
    if (mode !== "command" || !partialTranscript?.trim()) return;
    const kind = matchTermination(partialTranscript, { partial: true });
    if (kind) applyVoiceTermination(kind);
  }, [partialTranscript, mode, applyVoiceTermination]);

  const openPanel = useCallback((screen: "order" | "settings") => {
    setPanelScreen(screen);
    setPanelOpen(true);
  }, []);

  // ── Rail tap / initial activation ─────────────────────────────
  async function handleRailTap() {
    debugAppLog("[App] rail tap", { mode, micGranted: micPermissionGranted, agentState });
    if (!sqAuthToken) {
      // Not signed in — voice sessions can't start. Send the user to the
      // sign-in sheet instead of surfacing a connection error.
      openPanel("settings");
      return;
    }
    if (mode === "idle" || mode === "shutdown") {
      if (!micPermissionGranted) {
        if (!navigator.mediaDevices?.getUserMedia) {
          setMicError("Microphone unavailable. Use HTTPS or localhost.");
          console.warn("[App] navigator.mediaDevices.getUserMedia not available");
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          setMicPermissionGranted(true);
          setMicError(null);
        } catch (e) {
          const err = e as DOMException;
          const msg = err?.name === "NotAllowedError"
            ? "Microphone permission denied. Enable it in your browser site settings."
            : err?.name === "NotFoundError"
              ? "No microphone found."
              : `Microphone error: ${err?.message ?? String(e)}`;
          console.warn("[App] getUserMedia failed:", err);
          setMicError(msg);
          return;
        }
      }
      soundWake();
      if (wakeWordAvailable) {
        setMode("wake_word");
      } else {
        setMode("command");
        connect();
      }
    } else if (mode === "wake_word") {
      stopWakeWord();
      soundWake();
      setMode("command");
      // Tap means the user is about to speak — consume the warm standby
      // session without the spoken greeting so the mic opens instantly.
      void activate({ greet: false });
    } else if (mode === "command") {
      if (agentState === "speaking") {
        interrupt();
      } else {
        soundSleep();
        disconnect();
        setMode(wakeWordAvailable ? "wake_word" : "idle");
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
        <button className="hamburger" onClick={() => openPanel(sqAuthToken ? "order" : "settings")} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="brand-row">
          <svg width="46" height="26" viewBox="0 0 184 104" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <clipPath id="vl-top-clip">
                <rect x="0" y="39" width="22" height="54" rx="11"/>
                <rect x="27" y="25" width="22" height="76" rx="11"/>
                <rect x="54" y="10" width="22" height="94" rx="11"/>
                <rect x="81" y="0" width="22" height="104" rx="11"/>
                <rect x="108" y="18" width="22" height="82" rx="11"/>
                <rect x="135" y="26" width="22" height="66" rx="11"/>
                <rect x="162" y="37" width="22" height="53" rx="11"/>
              </clipPath>
              <linearGradient id="vl-top-wave" x1="0" y1="0" x2="0" y2="104" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#AD91D8"/>
                <stop offset="32%" stopColor="#E44B9A"/>
                <stop offset="62%" stopColor="#FF6245"/>
                <stop offset="100%" stopColor="#FDBA2E"/>
              </linearGradient>
            </defs>
            <rect x="0" y="39" width="22" height="54" rx="11" fill="url(#vl-top-wave)" opacity="0.72"/>
            <rect x="27" y="25" width="22" height="76" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="54" y="10" width="22" height="94" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="81" y="0" width="22" height="104" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="108" y="18" width="22" height="82" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="135" y="26" width="22" height="66" rx="11" fill="url(#vl-top-wave)"/>
            <rect x="162" y="37" width="22" height="53" rx="11" fill="url(#vl-top-wave)"/>
            <g clipPath="url(#vl-top-clip)">
              <ellipse cx="13" cy="61" rx="25" ry="24" fill="#E2C7E8" fillOpacity="0.62"/>
              <ellipse cx="55" cy="73" rx="63" ry="31" fill="#E52F8E" fillOpacity="0.46"/>
              <ellipse cx="98" cy="78" rx="45" ry="31" fill="#FF6B37" fillOpacity="0.45"/>
              <ellipse cx="144" cy="49" rx="18" ry="18" fill="#F2A0C6" fillOpacity="0.58"/>
              <ellipse cx="166" cy="72" rx="19" ry="22" fill="#FDB62F" fillOpacity="0.76"/>
            </g>
          </svg>
          <span className="brand-text" style={{ color: "var(--logo-text)" }}>
            Voycelab
          </span>
        </div>
        {orderCount > 0 && assistantKind === "venue" ? (
          <button className="order-badge" onClick={() => openPanel("order")} aria-label={`${orderCount} items in order`}>
            <span className="order-badge-num">{orderCount}</span>
          </button>
        ) : <div style={{ width: 22 }} />}
      </div>

      {/* Status chips — assistant · connected service · room */}
      <div className="status-chips">
        <span className="vl-pill vl-pill-brass">{agentProfile?.displayName ?? "Assistant"}</span>
        {assistantKind === "venue" && isConfigured && (
          <span className="vl-pill vl-pill-success"><span className="vl-pill-dot" />Square synced</span>
        )}
        {assistantKind === "general" && (
          <span className="vl-pill vl-pill-muted">Connect Square to unlock POS</span>
        )}
      </div>

      {/* ── Conversation area ────────────────────────────────── */}
      <div className="content">
        <div className="convo-area">
          {msgs.length === 0 && !partialTranscript && (mode === "idle" || mode === "shutdown" || mode === "wake_word") && (
            <div className="welcome">
              <span className="welcome-eyebrow">VoyceLab · Live</span>
              <h1 className="welcome-title">
                {!sqAuthToken
                  ? <>Your venue, <em>on voice</em>.</>
                  : assistantKind === "general"
                    ? <>Your venue assistant <em>is ready</em>.</>
                    : <>Your venue, <em>on voice</em>.</>}
              </h1>
              <p className="welcome-sub">
                {!sqAuthToken
                  ? "Sign in to connect your venue and start talking — orders, inventory and reports, hands-free."
                  : assistantKind === "general"
                    ? "Tap the orb and speak. I can handle email, look things up, and answer questions. Connect Square in settings to unlock POS commands."
                    : "Tap the orb and speak — I’ll handle orders, inventory and reports across your connected systems."}
              </p>
              {!sqAuthToken ? (
                <div className="suggestion-row">
                  <button className="welcome-signin" onClick={() => openPanel("settings")}>Sign in to get started</button>
                </div>
              ) : (
                <div className="suggestion-row">
                  {(assistantKind === "general"
                    ? ["Check my inbox", "What's in the knowledge base?", "Search for suppliers"]
                    : ["What sold today?", "Open orders", "Low stock report"]
                  ).map((s) => (
                    <button key={s} className="suggestion-chip" onClick={handleRailTap}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {msgs.map((m, i) => (
            <GhostLine key={m.id} msg={m} rank={msgs.length - 1 - i} />
          ))}
          {partialTranscript && <p className="partial">{partialTranscript}</p>}
        </div>

        {/* Status messages */}
        <div className="status-area">
          {error && <div className="error-text">{error}</div>}
          {micError && <div className="error-text">{micError}</div>}
          {assistantKind === "venue" && isLoadingCatalog && <div className="state-label">LOADING MENU</div>}
          {assistantKind === "venue" && catalogError && <div className="error-text">Menu: {catalogError}</div>}
        </div>
      </div>

      {/* ── Voice Orb ────────────────────────────────────────── */}
      <div className="orb-stage">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <VoiceOrb
            state={
              mode === "idle" || mode === "shutdown" ? "idle" :
              mode === "wake_word" ? (wakeWordListening ? "wake" : "idle") :
              agentState === "speaking" ? "speaking" :
              agentState === "listening" ? "listening" :
              agentState === "thinking" ? "thinking" :
              agentState === "connecting" ? "connecting" :
              agentState === "error" ? "error" :
              "idle"
            }
            remoteStream={remoteStream}
            onTap={handleRailTap}
          />
          <div className="orb-label">{label ?? (mode === "idle" ? "" : "")}</div>
          {mode === "idle" && <div className="orb-hint">{wakeWordAvailable ? "tap for wake mode" : "tap to speak"}</div>}
          {mode === "wake_word" && wakeWordAvailable && <div className="orb-hint">say {wakePhrase || "Hey Voyce"}</div>}
          {agentState === "speaking" && <div className="orb-hint">tap to interrupt</div>}
        </div>
      </div>

      {/* Connected systems — brand strip */}
      <div className="brand-strip" aria-label="Connected systems">
        <span className="brand-strip-label">Powered by</span>
        {assistantKind === "venue" && (
          <img src={assetUrl("brand/square-logo.png")} alt="Square" className="brand-strip-logo" />
        )}
        <img src={assetUrl("brand/openai-wordmark.png")} alt="OpenAI" className="brand-strip-logo brand-strip-logo-narrow" />
        <img src={assetUrl("brand/google-g.png")} alt="Google" className="brand-strip-logo brand-strip-logo-narrow" />
      </div>

      {/* Voice confirmation — visible even when order panel is closed */}
      {pendingConfirmation && (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 148,
            zIndex: 40,
            background: "linear-gradient(135deg, #FFF3E0, #FFE0B2)",
            border: "2px solid #FF9800",
            borderRadius: 16,
            padding: "12px 16px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#E65100", marginBottom: 8 }}>
            Confirm {commandLabel(pendingConfirmation.tool_name)}
          </div>
          {pendingConfirmation.prompt && (
            <div style={{ fontSize: 12, lineHeight: 1.35, color: "#8A3E00", marginBottom: 8 }}>
              {pendingConfirmation.prompt}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={confirmPending}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 999,
                background: "#FF6B47",
                color: "white",
                border: "none",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font)",
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={denyPending}
              style={{
                padding: "10px 20px",
                borderRadius: 999,
                background: "transparent",
                border: "1px solid rgba(0,0,0,0.2)",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "var(--font)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Panel */}
      <OrderPanel
        open={panelOpen}
        initialScreen={panelScreen}
        onClose={() => setPanelOpen(false)}
        pendingConfirmation={pendingConfirmation}
        onConfirm={confirmPending}
        onDeny={denyPending}
        screenWakeStatus={wakeLockStatus}
      />
    </div>
  );
}
