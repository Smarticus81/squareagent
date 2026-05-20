/**
 * Voice UI termination — soft vs hard shutdown.
 * Soft: end live session, keep wake-word listening.
 * Hard: stop wake-word / listening surface until user taps to start again.
 *
 * Matching rules:
 *   - Phrase comparisons use word boundaries to prevent mid-word false
 *     positives (e.g. "hey bars" must not fire on "hey bartender").
 *   - When matching against a partial / interim transcript, soft phrases
 *     must occur at the END of the utterance so mid-sentence speech
 *     ("we're done with the apps, now add...") does not terminate the session.
 */

export type TerminationKind = "soft" | "hard";

export function normalizeVoiceUtterance(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
}

export const HARD_SHUTDOWN_PHRASES: readonly string[] = [
  "shut down",
  "shutdown",
  "shut it down",
  "stop listening",
  "quit listening",
  "stop the microphone",
  "stop the mic",
];

export const SOFT_BACK_TO_WAKE_PHRASES: readonly string[] = [
  "that's all for now",
  "thats all for now",
  "goodbye",
  "good bye",
  "bye for now",
  "we're done",
  "we are done",
  "were done",
  "we're finished",
  "we are finished",
  "were finished",
  "that's all",
  "thats all",
  "all done",
  "wake word mode",
  "back to sleep",
  "go to sleep",
  "stop agent",
  "stop the agent",
];

const REGEX_META = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_META, "\\$&");
}

function phraseRegex(phrase: string, opts?: { atEnd?: boolean }): RegExp {
  const escaped = escapeRegex(phrase);
  const before = "(?:^|[^a-z0-9])";
  const after = opts?.atEnd ? "[^a-z0-9]*$" : "(?:[^a-z0-9]|$)";
  return new RegExp(`${before}${escaped}${after}`, "i");
}

export function phraseInText(text: string, phrase: string, opts?: { atEnd?: boolean }): boolean {
  return phraseRegex(phrase, opts).test(text);
}

export interface MatchTerminationOptions {
  partial?: boolean;
}

export function matchTermination(
  text: string,
  opts: MatchTerminationOptions = {},
): TerminationKind | null {
  const t = normalizeVoiceUtterance(text);
  if (!t) return null;
  if (HARD_SHUTDOWN_PHRASES.some((p) => phraseInText(t, p))) return "hard";
  const atEnd = !!opts.partial;
  if (SOFT_BACK_TO_WAKE_PHRASES.some((p) => phraseInText(t, p, { atEnd }))) return "soft";
  return null;
}

export function matchWakeWord(text: string, wakeWords: readonly string[]): string | null {
  const t = normalizeVoiceUtterance(text);
  if (!t) return null;
  for (const w of wakeWords) {
    const wn = normalizeVoiceUtterance(w);
    if (!wn) continue;
    if (phraseInText(t, wn)) return wn;
  }
  return null;
}
