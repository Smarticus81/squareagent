/**
 * Wake word detection using the browser's SpeechRecognition API.
 * Fixed: race condition in restart loop, proper cleanup on stop.
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
  const [isListening, setIsListening] = useState(false);
  const activeRef = useRef(false);
  const recRef = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupRec = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.stop(); } catch {}
    recRef.current = null;
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    cleanupRec();
    setIsListening(false);
  }, [cleanupRec]);

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

    rec.onresult = (event: any) => {
      if (!activeRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcripts: string[] = [];
        for (let j = 0; j < result.length; j++) {
          transcripts.push(result[j].transcript.toLowerCase().trim());
        }
        const combined = transcripts.join(" ");

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
        console.error("[WakeWord] Mic denied");
        stop();
        return;
      }
      console.warn("[WakeWord] Error:", e.error, "— will retry");
    };

    rec.onend = () => {
      if (!activeRef.current) return;
      recRef.current = null;
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (activeRef.current) spawnRec();
      }, 200);
    };

    try {
      rec.start();
    } catch (e) {
      console.warn("[WakeWord] Start error:", e);
      recRef.current = null;
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (activeRef.current) spawnRec();
      }, 500);
    }
  }, [wakeWords, stopPhrases, onWakeWordDetected, onStopDetected, stop, cleanupRec]);

  const start = useCallback(() => {
    if (!getSR()) { console.warn("[WakeWord] Not supported"); return; }
    if (activeRef.current) return;
    activeRef.current = true;
    setIsListening(true);
    spawnRec();
  }, [spawnRec]);

  return { isListening, startWakeWord: start, stopWakeWord: stop };
}
