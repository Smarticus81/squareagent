/**
 * Wake word detection using the browser's SpeechRecognition API.
 *
 * Continuously listens for wake words. When detected, fires onWakeWordDetected.
 * Also detects stop/terminate phrases for mode transitions.
 */
import { useRef, useCallback, useState } from "react";
import {
  HARD_SHUTDOWN_PHRASES,
  SOFT_BACK_TO_WAKE_PHRASES,
  matchTermination,
  matchWakeWord,
} from "@/lib/voice-termination";

export const WAKE_WORDS = ["hey bar", "hey bars", "okay bar", "hey voyce", "hey voicelab", "voycelab"];

/** Soft termination — back to wake listening after closing live agent session */
export const STOP_PHRASES = [...SOFT_BACK_TO_WAKE_PHRASES];

/** Hard shutdown — stop all ambient listening until user taps to resume */
export const SHUTDOWN_PHRASES = [...HARD_SHUTDOWN_PHRASES];

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
  const wakeWordsRef = useRef(wakeWords);
  const stopPhrasesRef = useRef(stopPhrases);
  const shutdownPhrasesRef = useRef(shutdownPhrases);
  const onWakeRef = useRef(onWakeWordDetected);
  const onStopRef = useRef(onStopDetected);
  const onShutdownRef = useRef(onShutdownDetected);

  wakeWordsRef.current = wakeWords;
  stopPhrasesRef.current = stopPhrases;
  shutdownPhrasesRef.current = shutdownPhrases;
  onWakeRef.current = onWakeWordDetected;
  onStopRef.current = onStopDetected;
  onShutdownRef.current = onShutdownDetected;

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
        const isFinal = !!result.isFinal;
        console.log("[WakeWord] Transcript:", combined, isFinal ? "(final)" : "(interim)");

        // Termination phrases use the shared matcher: hard anywhere, soft
        // requires end-of-utterance for interim transcripts.
        const term = matchTermination(combined, { partial: !isFinal });
        if (term === "hard") {
          console.log("[WakeWord] Shutdown phrase:", combined);
          stop();
          onShutdownRef.current();
          return;
        }
        if (term === "soft") {
          console.log("[WakeWord] Stop phrase:", combined);
          stop();
          onStopRef.current();
          return;
        }

        // Wake words: word-boundary match so "hey bars" doesn't fire on
        // "hey bartender".
        const hit = matchWakeWord(combined, wakeWordsRef.current);
        if (hit) {
          console.log("[WakeWord] Wake word detected:", hit, "in", combined);
          stop();
          onWakeRef.current();
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
        const delay = Math.min(600 * captureFailsRef.current, 3000);
        console.warn(`[WakeWord] audio-capture (attempt ${captureFailsRef.current}) — retry in ${delay}ms`);
        setIsListening(false);
        if (captureFailsRef.current >= 10) {
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
  }, [confidenceThreshold, stop, cleanupRec, scheduleRetry]);

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
