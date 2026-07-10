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
    setCatalog, setCurrentOrder, setAuthParams, setOrderHandlingMode,
    confirmPending, denyPending, sessionUsage,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItemByName, clearOrder, markVoiceOrderSubmitted, submitOrder, isSubmitting,
  } = useOrder();

  const {
    isConfigured,
    credentialsReady,
    catalogItems,
    isLoadingCatalog,
    catalogError,
    venueId: sqVenueId,
    authToken: sqAuthToken,
    agentProfile,
    agentProfileId,
    wakePhrase,
    wakeMode,
    orderHandlingMode,
    updateOrderHandlingMode,
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

  // Keep the voice agent's live order-handling override in sync with the
  // assistant's configured mode so submitted orders settle correctly.
  useEffect(() => {
    setOrderHandlingMode(orderHandlingMode);
  }, [orderHandlingMode, setOrderHandlingMode]);

  // Push current order to voice agent
  useEffect(() => {
    setCurrentOrder(
      (currentOrder?.items ?? []).map((i) => ({
        item_id: i.catalogItem.id, variationId: i.catalogItem.variationId,
        name: i.catalogItem.name, item_name: i.catalogItem.name,
        price: i.catalogItem.price, quantity: i.quantity,
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
          if (cmd.item_name) removeItemByName(cmd.item_name, cmd.quantity ?? 1);
          break;
        }
        case "clear":
          clearOrder();
          break;
        case "submit": {
          soundSubmit();
          markVoiceOrderSubmitted(cmd.squareOrderId);
          setPanelScreen("order");
          setPanelOpen(true);
          break;
        }
      }
    }
  }, [addItem, removeItemByName, clearOrder, markVoiceOrderSubmitted]);

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

  const onWakePermissionDenied = useCallback(() => {
    // Without this the orb sits at "Waking up" forever with no explanation.
    setMicError("Microphone blocked. Enable it in your browser site settings, then tap the wave.");
    setMode("idle");
  }, []);

  const { isListening: wakeWordListening, startWakeWord, stopWakeWord } = useWakeWord({
    wakeWords,
    confidenceThreshold: 0.5,
    onWakeWordDetected,
    onStopDetected,
    onShutdownDetected,
    onPermissionDenied: onWakePermissionDenied,
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
    // micError guard: after a permission denial, stay idle instead of
    // re-entering wake mode and re-triggering the denied mic loop.
    if (mode === "idle" && sqAuthToken && wakeWordAvailable && !micError) {
      setMode("wake_word");
    }
  }, [mode, sqAuthToken, wakeWordAvailable, micError]);

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
      if (agentState === "connecting") {
        // An impatient second tap during connect must not cancel the session.
        return;
      }
      if (agentState === "error") {
        // Tap on a failed session = reconnect, matching the on-screen hint.
        await disconnect();
        setMode("command");
        connect();
        return;
      }
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
          {/* Waveform mark traced from brand/voycelab-logo.png — bar positions and
              heights match the original asset (solid orange, no gradient). */}
          <svg width="42" height="26" viewBox="0 0 675 418" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="0" y="179" width="79" height="141" rx="39.5" fill="#EC5B2C"/>
            <rect x="100" y="205" width="79" height="213" rx="39.5" fill="#EC5B2C"/>
            <rect x="199" y="152" width="79" height="168" rx="39.5" fill="#EC5B2C"/>
            <rect x="299" y="96" width="79" height="272" rx="39.5" fill="#EC5B2C"/>
            <rect x="398" y="0" width="79" height="418" rx="39.5" fill="#EC5B2C"/>
            <rect x="497" y="205" width="79" height="115" rx="39.5" fill="#EC5B2C"/>
            <rect x="596" y="179" width="79" height="141" rx="39.5" fill="#EC5B2C"/>
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

      {/* ── Resource Limits / Overage Banners ───────────────── */}
      {sessionUsage && sessionUsage.risk !== "ok" && (
        <div className="mx-4 my-2.5 p-3.5 rounded-2xl border text-[12px] leading-relaxed font-semibold shadow-xs flex items-start gap-3"
             style={{
               background: sessionUsage.risk === "blocked" ? "rgba(239,68,68,0.06)" : sessionUsage.risk === "near_cap" ? "rgba(245,158,11,0.06)" : "rgba(255,107,71,0.05)",
               borderColor: sessionUsage.risk === "blocked" ? "rgba(239,68,68,0.22)" : sessionUsage.risk === "near_cap" ? "rgba(245,158,11,0.22)" : "rgba(255,107,71,0.20)",
               color: sessionUsage.risk === "blocked" ? "#991B1B" : sessionUsage.risk === "near_cap" ? "#92400E" : "#9A3412"
             }}>
          <div className="shrink-0 mt-0.5">
            {sessionUsage.risk === "blocked" ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-red-100 text-red-600 font-black">!</span>
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-amber-100 text-amber-600 font-black">!</span>
            )}
          </div>
          <div className="flex-1">
            <p className="font-bold mb-0.5">
              {sessionUsage.risk === "blocked" ? "Assistant Suspended" : sessionUsage.risk === "near_cap" ? "Overage Limit Critical" : "Overage Mode Active"}
            </p>
            <p style={{ opacity: 0.85 }}>
              {sessionUsage.risk === "blocked" 
                ? `This assistant is suspended because your organization has reached its monthly overage cap (${sessionUsage.hardCap} min). Please upgrade on the billing dashboard.`
                : sessionUsage.risk === "near_cap"
                ? `Using overage minutes (${sessionUsage.used} / ${sessionUsage.hardCap} min cap). Upgrade soon to prevent automated suspension.`
                : `Currently using overage minutes (${sessionUsage.used} used of ${sessionUsage.limit} included min). Monthly overage rates apply.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Conversation area ────────────────────────────────── */}
      <div className="content">
        <div className="convo-area">
          {!credentialsReady && msgs.length === 0 && (
            // Boot is still resolving the stored session / launch code —
            // don't flash "Offline / Sign in" at an already signed-in user.
            <div className="welcome">
              <span className="welcome-eyebrow">VoyceLab · Live</span>
              <h1 className="welcome-title">Waking <em>up</em>…</h1>
            </div>
          )}
          {credentialsReady && msgs.length === 0 && !partialTranscript && (mode === "idle" || mode === "shutdown" || mode === "wake_word") && (
            <div className="welcome">
              <span className="welcome-eyebrow">VoyceLab · Live</span>
              <h1 className="welcome-title">
                {!sqAuthToken
                  ? <>Voice Terminal <em>Offline</em>.</>
                  : <>Voice Terminal <em>Online</em>.</>}
              </h1>
              <p className="welcome-sub">
                {!sqAuthToken
                  ? "Sign in to connect your venue and start the real-time operations console."
                  : assistantKind === "general"
                    ? "Tap the wave and speak. I can handle email, look things up, and answer questions. Connect Square in settings to unlock POS commands."
                    : "Tap the wave and speak to execute orders, adjust inventory levels, or generate reporting summaries."}
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
          {mode === "idle" && (
            <div className="orb-hint">
              {wakeWordAvailable
                ? "tap for wake mode"
                : wakeEnabled && !isWakeWordSupported()
                  ? "tap to speak — hands-free wake isn't supported in this browser"
                  : "tap to speak"}
            </div>
          )}
          {mode === "wake_word" && wakeWordAvailable && <div className="orb-hint">say {wakePhrase || "Hey Voyce"}</div>}
          {agentState === "speaking" && <div className="orb-hint">tap to interrupt</div>}
          {mode === "command" && agentState === "error" && <div className="orb-hint">tap to reconnect</div>}
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

      {/* Voice confirmation — the panel renders its own banner when open, so
          only show the floating one when the panel is closed. */}
      {pendingConfirmation && !panelOpen && (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: "calc(148px + env(safe-area-inset-bottom))",
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
