/** Shared voice and speaking-pace validation for GPT-Live. */
/** Supported GPT-Live voices. Defaults to Marin. */
export const OPENAI_LIVE_VOICES: ReadonlySet<string> = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
  "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa", "tempo", "beacon", "delta", "cinder",
]);

export const DEFAULT_LIVE_VOICE = "marin";

/**
 * Clamp an arbitrary configured voice to one OpenAI accepts. Assistant
 * profiles can carry a Gemini voice name (e.g. "Kore") after an engine
 * switch — forwarding that fails the whole session mint.
 */
export function sanitizeLiveVoice(voice: unknown, fallback: string = DEFAULT_LIVE_VOICE): string {
  if (typeof voice === "string") {
    const normalized = voice.trim().toLowerCase();
    if (OPENAI_LIVE_VOICES.has(normalized)) return normalized;
    // Custom cloned voices are referenced as {id: "voice_..."} objects by the
    // API, but arrive here as plain strings from profile config.
    if (/^voice_[A-Za-z0-9]+$/.test(voice.trim())) return voice.trim();
  }
  return fallback;
}

/** Legacy preference range, translated to a pace instruction for Live. */
const MIN_SPEED = 0.25;
const MAX_SPEED = 1.5;

/**
 * Preserve the legacy preference range for the spoken pace instruction.
 */
export function sanitizeLivePace(speed: unknown, fallback = 1.0): number {
  const value = Number(speed);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}
