/**
 * Voice UI termination — soft vs hard shutdown.
 * Soft: end live session, keep wake-word listening.
 * Hard: stop wake-word / listening surface until user taps to start again.
 *
 * Matching rules:
 *   - Phrase comparisons use word boundaries to prevent mid-word false
 *     positives by requiring a clean phrase boundary.
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

/**
 * Phrases that terminate only when they make up the ENTIRE utterance
 * (after stripping politeness fillers like "ok" / "please" / "thanks").
 * "stop" mid-command ("stop adding that") must NOT end the session, but a
 * bare "Stop" or "ok stop" should drop back to wake-word listening.
 */
export const STANDALONE_SOFT_PHRASES: readonly string[] = [
  "stop",
  "stop now",
];

const STANDALONE_FILLERS = new Set([
  "ok",
  "okay",
  "alright",
  "all",
  "right",
  "please",
  "thanks",
  "thank",
  "you",
  "now",
  "hey",
  "um",
  "uh",
  "yeah",
]);

function coreTokens(normalized: string): string[] {
  const tokens = normalized.split(/[^a-z0-9']+/).filter(Boolean);
  let start = 0;
  let end = tokens.length;
  while (start < end && STANDALONE_FILLERS.has(tokens[start])) start++;
  while (end > start && STANDALONE_FILLERS.has(tokens[end - 1])) end--;
  return tokens.slice(start, end);
}

/** True when the utterance is exactly the phrase, ignoring surrounding fillers. */
export function matchesStandalonePhrase(text: string, phrase: string): boolean {
  const core = coreTokens(normalizeVoiceUtterance(text)).join(" ");
  return core.length > 0 && core === normalizeVoiceUtterance(phrase);
}

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
  // Standalone phrases require the whole utterance, so they're safe to match
  // on both partial and final transcripts.
  if (STANDALONE_SOFT_PHRASES.some((p) => matchesStandalonePhrase(t, p))) return "soft";
  return null;
}

/* ── Fuzzy wake matching ─────────────────────────────────────────
 * Browser speech recognition almost never transcribes brand spellings or
 * unusual names verbatim: "Hey Voyce" arrives as "hey voice", "Voycelab"
 * as "voice lab", "Hey Lola" as "hey lowla". Exact matching alone makes
 * every custom wake phrase look broken, so after the exact pass we run a
 * bounded-edit-distance + phonetic-key pass over token windows of the
 * transcript. Tolerances are deliberately tight (≈1 edit per 4 chars) so
 * ordinary speech does not false-wake.
 */

function tokenizeUtterance(normalized: string): string[] {
  return normalized.split(/[^a-z0-9']+/).filter(Boolean);
}

function joinLetters(tokens: readonly string[]): string {
  return tokens.join("").replace(/'/g, "");
}

/** Levenshtein distance, early-exiting once it exceeds `cap` (returns cap+1). */
function boundedEditDistance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[lb];
}

/**
 * Collapse a word to a compact sound-alike key (soundex-flavored): common
 * digraphs are canonicalized, then non-leading vowels are dropped and runs
 * collapsed. "voyce" and "voice" both become "vs"; "voycelab" and
 * "voice lab" (joined) both become "vslb".
 */
export function phoneticKey(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    .replace(/kn/g, "n")
    .replace(/wr/g, "r")
    .replace(/qu/g, "kw")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k");
  const head = s[0];
  const tail = s.slice(1).replace(/[aeiouyhw]/g, "");
  return (head + tail).replace(/(.)\1+/g, "$1");
}

/** Phrases shorter than this (letters, spaces removed) never fuzzy-match. */
const FUZZY_MIN_PHRASE_LEN = 5;

function fuzzyPhraseInTokens(tokens: readonly string[], phraseTokens: readonly string[]): boolean {
  const phraseJoined = joinLetters(phraseTokens);
  if (phraseJoined.length < FUZZY_MIN_PHRASE_LEN) return false;
  const maxEdits = Math.max(1, Math.floor(phraseJoined.length / 4));
  const phraseKey = phoneticKey(phraseJoined);
  // ASR splits and merges words freely ("voycelab" -> "voice lab"), so
  // compare joined letters across windows of n-1, n, and n+1 tokens.
  const minWin = Math.max(1, phraseTokens.length - 1);
  const maxWin = phraseTokens.length + 1;
  for (let size = minWin; size <= maxWin; size++) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const windowJoined = joinLetters(tokens.slice(i, i + size));
      if (windowJoined.length < 4) continue;
      if (boundedEditDistance(windowJoined, phraseJoined, maxEdits) <= maxEdits) return true;
      if (phraseKey && phoneticKey(windowJoined) === phraseKey) return true;
    }
  }
  return false;
}

export function matchWakeWord(text: string, wakeWords: readonly string[]): string | null {
  const t = normalizeVoiceUtterance(text);
  if (!t) return null;
  // Exact word-boundary pass first: cheap, and preserves priority order.
  for (const w of wakeWords) {
    const wn = normalizeVoiceUtterance(w);
    if (!wn) continue;
    if (phraseInText(t, wn)) return wn;
  }
  // Fuzzy pass: tolerate the recognizer's spelling of the same sounds.
  const tokens = tokenizeUtterance(t);
  if (tokens.length === 0) return null;
  for (const w of wakeWords) {
    const wn = normalizeVoiceUtterance(w);
    if (!wn) continue;
    const phraseTokens = tokenizeUtterance(wn);
    if (phraseTokens.length === 0) continue;
    if (fuzzyPhraseInTokens(tokens, phraseTokens)) return wn;
  }
  return null;
}
