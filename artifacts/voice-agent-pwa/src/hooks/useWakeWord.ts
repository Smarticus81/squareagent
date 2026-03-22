/**
 * Wake word detection using the browser's SpeechRecognition API.
 *
 * Continuously listens for wake words. When detected, fires onWakeWordDetected.
 * Also detects stop/terminate phrases for mode transitions.
 */
import { useRef, useCallback, useState } from "react";

export const WAKE_WORDS = ["hey bar", "hey bars", "a bar", "okay bar", "hey bev", "bevpro"];
export const STOP_PHRASES = [
  "that's all for now", "thats all for now",
  "goodbye", "good bye",
  "stop listening", "see you",
  "that's all", "thats all",
  "nothing else",
];
export const SHUTDOWN_PHRASES = ["shut down", "shut it down", "turn off"];

function getSR(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function isWakeWordSupported(): boolean {
  return getSR() !== null;
}

interface UseWakeWordOptions {
  wakeWords?: string[];
  stopPhrases?: string[];
  shutdownPhrases?: string[];
  confidenceThreshold?: number;
  onWakeWordDetected: () => void;
  /** Terminating words — go back to wake word mode */
  onStopDetected: () => void;
  /** Terminal words — stop listening completely */
  onShutdownDetected: () => void;
}

export function useWakeWord({
  wakeWords = WAKE_WORDS,
  stopPhrases = STOP_PHRASES,
  shutdownPhrases = SHUTDOWN_PHRASES,
  confidenceThreshold = 0.4,
  onWakeWordDetected,
  onStopDetected,
  onShutdownDetected,
}: UseWakeWordOptions) {
  const [isListening, setIsListening] = useState(false);

  const activeRef = useRef(false);
  const recRef = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    rec.onstart = () => {
      if (!activeRef.current) return;
      captureFailsRef.current = 0;
      setIsListening(true);
      console.log("[WakeWord] Mic confirmed open");
    };

    rec.onresult = (event: any) => {
      if (!activeRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcripts: string[] = [];
        for (let j = 0; j < result.length; j++) {
          // Apply confidence threshold
          if (result[j].confidence >= confidenceThreshold || result[j].confidence === 0) {
            transcripts.push(result[j].transcript.toLowerCase().trim());
          }
        }
        if (transcripts.length === 0) continue;
        const combined = transcripts.join(" ");
        console.log("[WakeWord] Transcript:", combined);

        // Check shutdown phrases first (highest priority)
        if (shutdownPhrases.some((p) => combined.includes(p))) {
          console.log("[WakeWord] Shutdown phrase:", combined);
          stop();
          onShutdownDetected();
          return;
        }

        // Check stop/terminate phrases
        if (stopPhrases.some((p) => combined.includes(p))) {
          console.log("[WakeWord] Stop phrase:", combined);
          // Don't stop wake word — caller handles transition
          stop();
          onStopDetected();
          return;
        }

        // Check wake words
        if (wakeWords.some((w) => combined.includes(w))) {
          console.log("[WakeWord] Wake word detected:", combined);
          stop();
          onWakeWordDetected();
          return;
        }
      }
    };

    rec.onerror = (e: any) => {
      if (!activeRef.current) return;

      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        console.error("[WakeWord] Mic permission denied — stopping");
        stop();
        return;
      }

      if (e.error === "audio-capture") {
        captureFailsRef.current += 1;
        const delay = Math.min(800 * captureFailsRef.current, 3000);
        console.warn(`[WakeWord] audio-capture (attempt ${captureFailsRef.current}) — retry in ${delay}ms`);
        setIsListening(false);
        if (captureFailsRef.current >= 6) {
          console.error("[WakeWord] audio-capture persistent — giving up");
          stop();
          return;
        }
        cleanupRec();
        scheduleRetry(delay);
        return;
      }

      console.warn("[WakeWord] Error:", e.error, "— retrying in 300ms");
    };

    rec.onend = () => {
      if (!activeRef.current) return;
      setIsListening(false);
      recRef.current = null;
      scheduleRetry(250);
    };

    try {
      rec.start();
    } catch (e) {
      console.warn("[WakeWord] start() threw:", e);
      recRef.current = null;
      scheduleRetry(500);
    }
  }, [wakeWords, stopPhrases, shutdownPhrases, confidenceThreshold, onWakeWordDetected, onStopDetected, onShutdownDetected, stop, cleanupRec, scheduleRetry]);

  spawnRecRef.current = spawnRec;

  const start = useCallback(() => {
    if (!getSR()) { console.warn("[WakeWord] Not supported"); return; }
    if (activeRef.current) return;
    activeRef.current = true;
    captureFailsRef.current = 0;
    spawnRec();
  }, [spawnRec]);

  return { isListening, startWakeWord: start, stopWakeWord: stop };
}
