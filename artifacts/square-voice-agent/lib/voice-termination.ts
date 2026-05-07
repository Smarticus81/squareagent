/**
 * Voice UI termination — soft vs hard shutdown (shared semantics with PWA).
 */

export type TerminationKind = "soft" | "hard";

export function normalizeVoiceUtterance(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .trim();
}

export const HARD_SHUTDOWN_PHRASES: readonly string[] = [
  "shut down",
  "shutdown",
  "shut it down",
  "stop listening",
  "quit listening",
  "stop the microphone",
];

export const SOFT_BACK_TO_WAKE_PHRASES: readonly string[] = [
  "that's all for now",
  "thats all for now",
  "goodbye",
  "good bye",
  "bye for now",
  "no more",
  "we're done",
  "we are done",
  "were done",
  "we're finished",
  "we are finished",
  "were finished",
  "that's all",
  "thats all",
  "nothing else",
  "see you",
  "that's enough",
  "thats enough",
  "all done",
  "wake word mode",
  "back to sleep",
  "go to sleep",
  "stop agent",
];

export function matchTermination(text: string): TerminationKind | null {
  const t = normalizeVoiceUtterance(text);
  if (!t) return null;
  if (HARD_SHUTDOWN_PHRASES.some((p) => t.includes(p))) return "hard";
  if (SOFT_BACK_TO_WAKE_PHRASES.some((p) => t.includes(p))) return "soft";
  return null;
}
