/**
 * Native wake-word detection via expo-speech-recognition.
 *
 * Metro resolves this file on iOS / Android (`.native.ts` takes priority
 * over `.ts`).  The web build uses the sibling `useWakeWord.ts` which
 * relies on the browser SpeechRecognition API.
 *
 * Invariant: isListening === true only AFTER the native recogniser's
 * "start" event fires — i.e. the OS is actually capturing audio.
 */
import { useRef, useCallback, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

// ── Shared word lists (must match useWakeWord.ts) ────────────────────────────
export const WAKE_WORDS = [
  "hey bar", "hey bars", "a bar", "okay bar", "hey bev", "bevpro",
];
export const STOP_PHRASES = [
  "shut down", "stop listening", "shut it down", "turn off",
];
export const TERMINATE_PHRASES = [
  "goodbye", "good bye", "wake word mode", "back to sleep",
  "go to sleep", "nothing else", "that's all", "thats all",
  "see you", "stop agent",
];

export function isWakeWordSupported(): boolean {
  return true; // always available on native via expo-speech-recognition
}

// ── Hook types ───────────────────────────────────────────────────────────────
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
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);

  // Keep latest callbacks / word-lists in refs to avoid stale closures
  const onWakeRef = useRef(onWakeWordDetected);
  const onStopRef = useRef(onStopDetected);
  onWakeRef.current = onWakeWordDetected;
  onStopRef.current = onStopDetected;

  const wakeWordsRef = useRef(wakeWords);
  const stopPhrasesRef = useRef(stopPhrases);
  wakeWordsRef.current = wakeWords;
  stopPhrasesRef.current = stopPhrases;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const clearTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const beginRecognition = useCallback(() => {
    if (!activeRef.current) return;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: true,
        maxAlternatives: 3,
        contextualStrings: [...wakeWordsRef.current, ...stopPhrasesRef.current],
        iosCategory: {
          category: "playAndRecord",
          categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
          mode: "default",
        },
      });
    } catch (e) {
      console.warn("[WakeWord:native] start() threw:", e);
      scheduleRestart(500);
    }
  }, []); // scheduleRestart added below via ref

  // Ref so scheduleRestart → beginRecognition avoids dep cycle
  const beginRef = useRef(beginRecognition);
  beginRef.current = beginRecognition;

  const scheduleRestart = useCallback(
    (delayMs: number) => {
      clearTimer();
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (activeRef.current) beginRef.current();
      }, delayMs);
    },
    [clearTimer],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    failCountRef.current = 0;
    clearTimer();
    setIsListening(false);
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }, [clearTimer]);

  // ── Native event listeners (always registered — React rules of hooks) ──

  useSpeechRecognitionEvent("start", () => {
    if (!activeRef.current) return;
    failCountRef.current = 0;
    setIsListening(true);
    console.log("[WakeWord:native] Mic confirmed open");
  });

  useSpeechRecognitionEvent("result", (ev) => {
    if (!activeRef.current) return;
    for (const result of ev.results) {
      const text = result.transcript.toLowerCase().trim();
      console.log("[WakeWord:native] Transcript:", text);

      if (stopPhrasesRef.current.some((p) => text.includes(p))) {
        console.log("[WakeWord:native] Stop phrase:", text);
        stop();
        onStopRef.current();
        return;
      }
      if (wakeWordsRef.current.some((w) => text.includes(w))) {
        console.log("[WakeWord:native] Wake word:", text);
        stop();
        onWakeRef.current();
        return;
      }
    }
  });

  useSpeechRecognitionEvent("error", (ev) => {
    if (!activeRef.current) return;
    console.warn("[WakeWord:native] Error:", ev.error, ev.message);

    if (ev.error === "not-allowed") {
      console.error("[WakeWord:native] Permission denied — stopping");
      stop();
      return;
    }

    if (ev.error === "audio-capture" || ev.error === "busy") {
      failCountRef.current += 1;
      const delay = Math.min(800 * failCountRef.current, 3000);
      setIsListening(false);
      if (failCountRef.current >= 10) {
        console.error("[WakeWord:native] Persistent error — giving up");
        stop();
        return;
      }
      scheduleRestart(delay);
      return;
    }

    // Transient error — short retry
    scheduleRestart(300);
  });

  useSpeechRecognitionEvent("end", () => {
    if (!activeRef.current) return;
    setIsListening(false);
    // Restart after a short gap so the recogniser fully releases
    scheduleRestart(250);
  });

  // ── Public API ─────────────────────────────────────────────────────────
  const startWakeWord = useCallback(async () => {
    if (activeRef.current) return;

    // Request both speech-recognition + microphone permissions
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      console.error("[WakeWord:native] Permissions not granted");
      return;
    }

    activeRef.current = true;
    failCountRef.current = 0;
    beginRecognition();
  }, [beginRecognition]);

  return { isListening, startWakeWord, stopWakeWord: stop };
}
