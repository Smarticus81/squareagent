/**
 * Wake word detection using the browser's SpeechRecognition API.
 *
 * Key invariant: isListening === true ONLY after SpeechRecognition.onstart
 * fires — i.e. the OS mic indicator is actually on.  We never trust that
 * rec.start() succeeded until the browser confirms it.
 */
import { useRef, useCallback, useState } from "react";
import { Platform } from "react-native";

export const WAKE_WORDS = ["hey bar", "hey bars", "a bar", "okay bar", "hey bev", "bevpro"];
export const STOP_PHRASES = ["shut down", "stop listening", "shut it down", "turn off"];
export const TERMINATE_PHRASES = [
  "goodbye", "good bye", "wake word mode", "back to sleep",
  "go to sleep", "nothing else", "that's all", "thats all",
  "see you", "stop agent",
];

function getSR(): any {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function isWakeWordSupported(): boolean {
  return getSR() !== null;
}

interface UseWakeWordOptions {
  wakeWords?: string[];
  stopPhrases?: string[];
  onWakeWordDetected: () => void;
  onStopDetected: () => void;
}

export function useWakeWord({
  wakeWords = WAKE_WORDS,
  stopPhrases = STOP_PHRASES,
  onWakeWordDetected,
  onStopDetected,
}: UseWakeWordOptions) {
  // true only once the OS mic indicator is confirmed on (onstart fired)
  const [isListening, setIsListening] = useState(false);

  const activeRef = useRef(false);
  const recRef = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks how many consecutive audio-capture failures (mic still held by WebAudio)
  const captureFailsRef = useRef(0);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const cleanupRec = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    r.onstart = null;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.stop(); } catch {}
    recRef.current = null;
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    captureFailsRef.current = 0;
    clearRestartTimer();
    cleanupRec();
    setIsListening(false);
  }, [cleanupRec, clearRestartTimer]);

  // spawnRecRef lets scheduleRetry call spawnRec without a forward-reference dep
  const spawnRecRef = useRef<() => void>(() => {});

  const scheduleRetry = useCallback((delayMs: number) => {
    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (activeRef.current) spawnRecRef.current();
    }, delayMs);
  }, [clearRestartTimer]);

  const spawnRec = useCallback(() => {
    if (!activeRef.current) return;

    const SR = getSR();
    if (!SR) return;

    cleanupRec();

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 3;
    recRef.current = rec;

    // ── onstart: mic is ACTUALLY on now ──────────────────────────────────────
    rec.onstart = () => {
      if (!activeRef.current) return;
      captureFailsRef.current = 0; // reset failure counter on success
      setIsListening(true);
      console.log("[WakeWord] Mic confirmed open");
    };

    rec.onresult = (event: any) => {
      if (!activeRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcripts: string[] = [];
        for (let j = 0; j < result.length; j++) {
          transcripts.push(result[j].transcript.toLowerCase().trim());
        }
        const combined = transcripts.join(" ");
        console.log("[WakeWord] Transcript:", combined);

        if (stopPhrases.some((p) => combined.includes(p))) {
          console.log("[WakeWord] Stop phrase:", combined);
          stop();
          onStopDetected();
          return;
        }

        if (wakeWords.some((w) => combined.includes(w))) {
          console.log("[WakeWord] Wake word:", combined);
          stop();
          onWakeWordDetected();
          return;
        }
      }
    };

    rec.onerror = (e: any) => {
      if (!activeRef.current) return;

      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        // Permanent denial — stop trying
        console.error("[WakeWord] Mic permission denied — stopping");
        stop();
        return;
      }

      if (e.error === "audio-capture") {
        // Mic is temporarily held by another stream (e.g. just-closed WebAudio).
        // Back off progressively, up to 3 s, then give up.
        captureFailsRef.current += 1;
        const delay = Math.min(800 * captureFailsRef.current, 3000);
        console.warn(`[WakeWord] audio-capture (attempt ${captureFailsRef.current}) — retry in ${delay}ms`);
        setIsListening(false); // mic is NOT on despite activeRef=true
        if (captureFailsRef.current >= 6) {
          console.error("[WakeWord] audio-capture persistent — giving up");
          stop();
          return;
        }
        cleanupRec();
        scheduleRetry(delay);
        return;
      }

      // All other transient errors (network, aborted, etc.) — short retry
      console.warn("[WakeWord] Error:", e.error, "— retrying in 300ms");
    };

    rec.onend = () => {
      if (!activeRef.current) return;
      // Mic closed — no longer listening until next onstart
      setIsListening(false);
      recRef.current = null;
      // Short pause before restarting (Chrome requires a gap)
      scheduleRetry(250);
    };

    try {
      rec.start();
      // Do NOT set isListening here — wait for onstart
    } catch (e) {
      console.warn("[WakeWord] start() threw:", e);
      recRef.current = null;
      scheduleRetry(500);
    }
  }, [wakeWords, stopPhrases, onWakeWordDetected, onStopDetected, stop, cleanupRec, scheduleRetry]);

  // Wire the ref so scheduleRetry can call spawnRec without a dep cycle
  spawnRecRef.current = spawnRec;

  const start = useCallback(() => {
    if (!getSR()) { console.warn("[WakeWord] Not supported"); return; }
    if (activeRef.current) return;
    activeRef.current = true;
    captureFailsRef.current = 0;
    // isListening stays false until onstart confirms the mic
    spawnRec();
  }, [spawnRec]);

  return { isListening, startWakeWord: start, stopWakeWord: stop };
}
