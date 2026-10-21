import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceAgent, type AgentState, type OrderCommand } from "@/contexts/VoiceAgentContext";
import { useOrder } from "@/contexts/OrderContext";
import { useSquare } from "@/contexts/SquareContext";
import { Presence, type PresenceState } from "@/components/Presence";
import { Sheet, type SheetScreen } from "@/components/Sheet";
import { useWakeWord, isWakeWordSupported } from "@/hooks/useWakeWord";
import { useWakeLock } from "@/hooks/useWakeLock";
import { soundWake, soundItemAdd, soundSubmit, soundError, soundSleep } from "@/lib/sounds";
import { matchTermination } from "@/lib/voice-termination";
import { commandLabel } from "@/lib/command-labels";
import { activityFromCommand, pushActivity, relativeTime, type ActivityEntry } from "@/lib/activity";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => { if (DEBUG) console.log("[surface]", ...args); };

/** The surface has four modes. Everything else is derived. */
type Mode = "idle" | "wake_word" | "command" | "shutdown";

function buildWakeWords(wakePhrase: string): string[] {
  const compact = wakePhrase.toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
  const words = new Set<string>(["hey voyce", "hey voicelab", "hey voycelab", "voycelab"]);
  if (compact) {
    words.add(compact);
    // Never the bare name alone: single words like "max" false-wake on "maximum".
    if (!compact.startsWith("hey ")) words.add(`hey ${compact}`);
  }
  return Array.from(words);
}

function presenceState(mode: Mode, agentState: AgentState, wakeListening: boolean): PresenceState {
  if (mode === "idle" || mode === "shutdown") return "dormant";
  if (mode === "wake_word") return wakeListening ? "ready" : "dormant";
  switch (agentState) {
    case "speaking": return "speaking";
    case "listening": return "listening";
    case "thinking": return "thinking";
    case "connecting": return "connecting";
    case "error": return "error";
    default: return "ready";
  }
}

export default function App() {
  const {
    agentState, conversation, partialTranscript, error, remoteStream,
    pendingConfirmation, connect, prewarm, activate, releaseStandby, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setAuthParams, setOrderHandlingMode,
    confirmPending, denyPending, sessionUsage,
  } = useVoiceAgent();

  const { currentOrder, addItem, removeItemByName, clearOrder, markVoiceOrderSubmitted } = useOrder();

  const {
    credentialsReady, sessionStatus, squareStatus, catalogItems, isLoadingCatalog, catalogError,
    venueId: sqVenueId, authToken: sqAuthToken, agentProfile, agentProfileId,
    wakePhrase, wakeMode, orderHandlingMode, assistantKind,
  } = useSquare();

  const [mode, setMode] = useState<Mode>("idle");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetScreen, setSheetScreen] = useState<SheetScreen>("ticket");
  const [micGranted, setMicGranted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [, bumpClock] = useState(0);

  const modeRef = useRef<Mode>("idle");
  const prevItemCount = useRef(0);
  const terminationHandled = useRef(false);
  const lastConversationLen = useRef(0);
  const catalogRef = useRef(catalogItems);
  const orderRef = useRef(currentOrder);

  const pushToTalkRequired = agentProfile?.noiseMode === "push_to_talk";
  const wakeEnabled = wakeMode !== "tap" && !pushToTalkRequired;
  const wakeWordAvailable = wakeEnabled && isWakeWordSupported();

  // Voice gate: the stored session must be verified against the server, and
  // a venue assistant needs a live Square connection, before any voice starts.
  const sessionVerified = sessionStatus === "authenticated";
  const squareBlocked = squareStatus === "disconnected";
  const bootChecking = !credentialsReady || sessionStatus === "checking" || squareStatus === "checking";
  const voiceReady = sessionVerified && !squareBlocked && !bootChecking;

  // Always-on: keep the display awake whenever the surface is online.
  const wakeLockStatus = useWakeLock(mode !== "shutdown");

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { catalogRef.current = catalogItems; }, [catalogItems]);
  useEffect(() => { orderRef.current = currentOrder; }, [currentOrder]);

  // Relative timestamps in the ledger tick once a second while anything is listed.
  useEffect(() => {
    if (activity.length === 0) return;
    const t = window.setInterval(() => bumpClock((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [activity.length]);

  useEffect(() => {
    const count = currentOrder?.items.length ?? 0;
    if (count > prevItemCount.current) soundItemAdd();
    prevItemCount.current = count;
  }, [currentOrder?.items.length]);

  // ── Feed the voice engine ───────────────────────────────────────
  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({ id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category })));
  }, [catalogItems, setCatalog]);

  useEffect(() => {
    setAuthParams(sqVenueId || "", sqAuthToken || "", agentProfileId ?? undefined, agentProfile?.voicePipelineProvider, agentProfile?.voicePipelineConfig);
  }, [sqVenueId, sqAuthToken, agentProfileId, agentProfile, setAuthParams]);

  useEffect(() => { setOrderHandlingMode(orderHandlingMode); }, [orderHandlingMode, setOrderHandlingMode]);

  useEffect(() => {
    setCurrentOrder((currentOrder?.items ?? []).map((i) => ({
      item_id: i.catalogItem.id, variationId: i.catalogItem.variationId,
      name: i.catalogItem.name, item_name: i.catalogItem.name,
      price: i.catalogItem.price, quantity: i.quantity,
    })));
  }, [currentOrder, setCurrentOrder]);

  const handleCommands = useCallback((cmds: OrderCommand[]) => {
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
        case "remove":
          if (cmd.item_name) removeItemByName(cmd.item_name, cmd.quantity ?? 1);
          break;
        case "clear":
          clearOrder();
          break;
        case "submit":
          soundSubmit();
          markVoiceOrderSubmitted(cmd.squareOrderId);
          break;
      }
      const line = activityFromCommand(cmd);
      if (line) setActivity((list) => pushActivity(list, line));
    }
  }, [addItem, removeItemByName, clearOrder, markVoiceOrderSubmitted]);

  useEffect(() => { setToolHandler(handleCommands); }, [handleCommands, setToolHandler]);

  // ── Wake word ───────────────────────────────────────────────────
  const onWake = useCallback(() => {
    log("wake");
    soundWake();
    setMode("command");
    void activate({ greet: true });
  }, [activate]);

  const onStop = useCallback(() => {
    soundSleep();
    const wasCommand = modeRef.current === "command";
    setMode(wakeWordAvailable ? "wake_word" : "idle");
    if (wasCommand) void disconnect();
  }, [disconnect, wakeWordAvailable]);

  const onShutdown = useCallback(() => {
    soundSleep();
    const wasCommand = modeRef.current === "command";
    setMode("shutdown");
    if (wasCommand) void disconnect();
  }, [disconnect]);

  const onPermissionDenied = useCallback(() => {
    setMicError("The microphone is blocked. Allow it in your browser's site settings, then tap the light.");
    setMode("idle");
  }, []);

  const wakeWords = useMemo(() => buildWakeWords(wakePhrase), [wakePhrase]);
  const { isListening: wakeListening, startWakeWord, stopWakeWord } = useWakeWord({
    wakeWords, confidenceThreshold: 0.5,
    onWakeWordDetected: onWake, onStopDetected: onStop, onShutdownDetected: onShutdown, onPermissionDenied,
  });

  useEffect(() => {
    let cancelled = false;
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    permissions.query({ name: "microphone" as PermissionName }).then((status) => {
      const sync = () => { if (!cancelled) setMicGranted(status.state === "granted"); };
      sync();
      status.onchange = sync;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Verified session + wake support → straight into always-on listening.
  useEffect(() => {
    if (mode === "idle" && voiceReady && wakeWordAvailable && !micError) setMode("wake_word");
  }, [mode, voiceReady, wakeWordAvailable, micError]);

  useEffect(() => {
    if (voiceReady) return;
    if (mode === "wake_word" || mode === "command") { setMode("idle"); void disconnect(); }
  }, [voiceReady, mode, disconnect]);

  useEffect(() => { if (mode === "wake_word" && !wakeWordAvailable) setMode("idle"); }, [mode, wakeWordAvailable]);

  useEffect(() => {
    if (mode === "command" && agentState === "disconnected") setMode(wakeWordAvailable ? "wake_word" : "idle");
  }, [mode, agentState, wakeWordAvailable]);

  useEffect(() => { if (mode === "command") terminationHandled.current = false; }, [mode]);
  useEffect(() => { if (agentState === "error") soundError(); }, [agentState]);

  useEffect(() => {
    if (mode === "wake_word" && wakeWordAvailable) {
      const t = setTimeout(() => startWakeWord(), 250);
      return () => clearTimeout(t);
    }
    stopWakeWord();
  }, [mode, wakeWordAvailable, startWakeWord, stopWakeWord]);

  // Standby session so the first word after the wake phrase lands in ms.
  useEffect(() => {
    if (mode === "wake_word") {
      const t = setTimeout(() => { void prewarm(); }, 150);
      return () => clearTimeout(t);
    }
    if (mode === "idle" || mode === "shutdown") releaseStandby();
  }, [mode, prewarm, releaseStandby]);

  const applyTermination = useCallback((kind: "soft" | "hard") => {
    if (terminationHandled.current) return;
    terminationHandled.current = true;
    soundSleep();
    setMode(kind === "hard" ? "shutdown" : wakeWordAvailable ? "wake_word" : "idle");
    void disconnect();
  }, [disconnect, wakeWordAvailable]);

  useEffect(() => {
    if (mode !== "command") return;
    if (conversation.length <= lastConversationLen.current) { lastConversationLen.current = conversation.length; return; }
    lastConversationLen.current = conversation.length;
    const last = conversation[conversation.length - 1];
    if (last?.role === "user") {
      const kind = matchTermination(last.content);
      if (kind) applyTermination(kind);
    }
  }, [conversation, mode, applyTermination]);

  useEffect(() => {
    if (mode !== "command" || !partialTranscript?.trim()) return;
    const kind = matchTermination(partialTranscript, { partial: true });
    if (kind) applyTermination(kind);
  }, [partialTranscript, mode, applyTermination]);

  const openSheet = useCallback((screen: SheetScreen) => { setSheetScreen(screen); setSheetOpen(true); }, []);

  // ── Tapping the presence ────────────────────────────────────────
  async function handleTap() {
    log("tap", { mode, micGranted, agentState });
    if (!voiceReady) {
      if (bootChecking) return;
      openSheet("settings");
      return;
    }
    if (mode === "idle" || mode === "shutdown") {
      if (!micGranted) {
        if (!navigator.mediaDevices?.getUserMedia) { setMicError("No microphone access. Open this on HTTPS or localhost."); return; }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          setMicGranted(true);
          setMicError(null);
        } catch (e) {
          const err = e as DOMException;
          setMicError(
            err?.name === "NotAllowedError" ? "Microphone permission was denied. Allow it in your browser's site settings."
            : err?.name === "NotFoundError" ? "No microphone found."
            : `Microphone error: ${err?.message ?? String(e)}`,
          );
          return;
        }
      }
      soundWake();
      if (wakeWordAvailable) setMode("wake_word");
      else { setMode("command"); connect(); }
      return;
    }
    if (mode === "wake_word") {
      stopWakeWord();
      soundWake();
      setMode("command");
      void activate({ greet: false });
      return;
    }
    // command mode
    if (agentState === "connecting") return;
    if (agentState === "error") { await disconnect(); setMode("command"); connect(); return; }
    if (agentState === "speaking") { interrupt(); return; }
    soundSleep();
    disconnect();
    setMode(wakeWordAvailable ? "wake_word" : "idle");
  }

  // ── Derived copy ────────────────────────────────────────────────
  const state = presenceState(mode, agentState, wakeListening);
  const name = agentProfile?.displayName ?? "Your assistant";
  const phrase = wakePhrase || "Hey Voyce";
  const lastAgent = [...conversation].reverse().find((m) => m.role === "agent")?.content ?? null;
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.content ?? null;
  const live = mode === "command";
  const itemCount = currentOrder?.items.length ?? 0;
  const total = currentOrder?.total ?? 0;

  let status: string;
  if (bootChecking) status = "Waking up";
  else if (sessionStatus === "offline") status = "Can't reach VoyceLab · retrying";
  else if (!sessionVerified) status = "Signed out";
  else if (squareBlocked) status = "Square disconnected";
  else if (mode === "shutdown") status = "Off";
  else if (mode === "wake_word") status = wakeListening ? `Listening for “${phrase}”` : "Getting ready";
  else if (mode === "command") {
    status = agentState === "connecting" ? "Connecting"
      : agentState === "thinking" ? "Working on it"
      : agentState === "speaking" ? "Speaking"
      : agentState === "listening" ? "Listening"
      : agentState === "error" ? "Needs attention"
      : "Online";
  } else status = "Tap to talk";

  // The one line the surface says when there is no conversation yet.
  let headline: React.ReactNode = null;
  let action: { label: string; onClick: () => void } | null = null;
  if (!bootChecking && !lastAgent && !partialTranscript) {
    if (!sessionVerified && sessionStatus !== "offline") {
      headline = "Sign in to bring your assistant online.";
      action = { label: "Sign in", onClick: () => openSheet("settings") };
    } else if (sessionStatus === "offline") {
      headline = "Waiting for the connection to come back.";
    } else if (squareBlocked) {
      headline = "Square needs reconnecting before I can run the room.";
      action = { label: "Reconnect", onClick: () => openSheet("settings") };
    } else if (mode === "shutdown") {
      headline = "I'm off. Tap the light to come back.";
    } else if (mode === "idle") {
      headline = wakeEnabled && !isWakeWordSupported()
        ? "Tap the light and talk. This browser can't listen for a wake phrase."
        : "Tap the light and talk.";
    } else if (mode === "wake_word") {
      headline = <>Say <em>{phrase}</em> whenever you need me.</>;
    } else if (mode === "command" && agentState === "listening") {
      headline = "I'm listening.";
    }
  }

  const problem = error ?? micError ?? (assistantKind === "venue" && catalogError ? `Menu: ${catalogError}` : null);
  const now = Date.now();

  return (
    <div className={`surface is-${state}`}>
      <header className="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span className="status-text">{sessionVerified && !bootChecking ? `${name} · ${status}` : status}</span>
        {sessionUsage && sessionUsage.risk !== "ok" && (
          <span className={`usage ${sessionUsage.risk}`} role="status">
            {sessionUsage.risk === "blocked"
              ? `Suspended: your workspace reached its ${sessionUsage.hardCap} minute cap this month.`
              : sessionUsage.risk === "near_cap"
              ? `Overage minutes · ${sessionUsage.used} of ${sessionUsage.hardCap} cap`
              : `Overage minutes · ${sessionUsage.used} used of ${sessionUsage.limit} included`}
          </span>
        )}
      </header>

      <main className="stage">
        <Presence state={state} remoteStream={remoteStream} onTap={handleTap} label={status} />

        <div className="words">
          {lastUser && live && <p className="heard">{lastUser}</p>}
          {partialTranscript && <p className="heard partial">{partialTranscript}</p>}
          {lastAgent ? <p className="said">{lastAgent}</p> : headline && <p className="said">{headline}</p>}
          {action && (
            <button type="button" className="btn primary" onClick={action.onClick}>{action.label}</button>
          )}
          {problem && <p className="problem">{problem}</p>}
          {assistantKind === "venue" && isLoadingCatalog && <p className="hint">Loading the menu</p>}
          {state === "speaking" && <p className="hint">tap to interrupt</p>}
          {state === "error" && <p className="hint">tap to reconnect</p>}
        </div>

        {pendingConfirmation && (
          <div className="confirm" role="alertdialog" aria-live="assertive">
            <p>{pendingConfirmation.prompt || `${commandLabel(pendingConfirmation.tool_name)}?`}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={confirmPending}>Yes, do it</button>
              <button type="button" className="btn ghost" onClick={denyPending}>No</button>
            </div>
          </div>
        )}
      </main>

      <footer className="foot">
        {activity.length > 0 && (
          <ol className="ledger" aria-label="Recent actions">
            {activity.map((a) => (
              <li key={a.id} className={`ledger-${a.tone}`}>
                <span>{a.text}</span>
                <time>{relativeTime(a.at, now)}</time>
              </li>
            ))}
          </ol>
        )}
        <div className="foot-row">
          {itemCount > 0 && assistantKind === "venue" ? (
            <button type="button" className="ticket-pill" onClick={() => openSheet("ticket")}>
              <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
              <strong>${total.toFixed(2)}</strong>
            </button>
          ) : <span />}
          <button type="button" className="more" aria-label="Open ticket and settings" onClick={() => openSheet(sessionVerified && assistantKind === "venue" ? "ticket" : "settings")}>
            <span /><span /><span />
          </button>
        </div>
      </footer>

      <Sheet
        open={sheetOpen}
        screen={sheetScreen}
        onScreen={setSheetScreen}
        onClose={() => setSheetOpen(false)}
        screenWakeStatus={wakeLockStatus}
      />
    </div>
  );
}
