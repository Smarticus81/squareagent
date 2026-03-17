/**
 * Wake word detection using the browser's built-in SpeechRecognition API.
 * Runs locally in the browser — no API calls, zero cost, zero latency.
 *
 * Flow:
 *   startWakeWord() → listen for WAKE_WORDS → onWakeWordDetected()
 *   while listening: detect STOP_PHRASES → onStopDetected()
 *
 * Automatically restarts on `onend` so recognition stays continuous.
 */

import { useRef, useCallback, useState } from "react";
import { Platform } from "react-native";

export const WAKE_WORDS = ["hey bar", "hey bars", "a bar", "okay bar"];
export const STOP_PHRASES = ["shut down", "stop listening", "shut it down", "turn off"];
export const TERMINATE_PHRASES = [
  "goodbye",
  "good bye",
  "wake word mode",
  "back to sleep",
  "go to sleep",
  "nothing else",
  "that's all",
  "thats all",
  "see you",
];

function getSpeechRecognition(): typeof SpeechRecognition | null {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}

export function isWakeWordSupported(): boolean {
  return getSpeechRecognition() !== null;
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
  const recognitionRef = useRef<any>(null);
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      console.warn("[WakeWord] SpeechRecognition not supported");
      return;
    }
    if (activeRef.current) return;

    activeRef.current = true;
    setIsListening(true);

    function spawnRecognition() {
      if (!activeRef.current) return;

      const rec = new SpeechRecognition!();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.maxAlternatives = 3;

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
            console.log("[WakeWord] Stop phrase detected:", combined);
            stop();
            onStopDetected();
            return;
          }

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
          console.error("[WakeWord] Mic permission denied");
          stop();
          return;
        }
        console.warn("[WakeWord] Recognition error:", e.error, "— restarting");
      };

      rec.onend = () => {
        if (!activeRef.current) return;
        try { spawnRecognition(); } catch {}
      };

      try {
        rec.start();
        recognitionRef.current = rec;
      } catch (e) {
        console.warn("[WakeWord] Failed to start:", e);
        setTimeout(() => { if (activeRef.current) spawnRecognition(); }, 500);
      }
    }

    spawnRecognition();
  }, [wakeWords, stopPhrases, onWakeWordDetected, onStopDetected, stop]);

  return { isListening, startWakeWord: start, stopWakeWord: stop };
}
