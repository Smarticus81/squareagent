/**
 * Shared OpenAI Realtime (GA) session configuration.
 *
 * Every surface that talks to the Realtime API — the WebRTC token mint in
 * routes/realtime.ts, the server WS relay, the voice-pipeline adapter, and the
 * live readiness scripts — builds its session payload through this module so
 * the parameter shape is defined exactly once and stays schema-valid.
 *
 * The GA API rejects requests with `invalid_request_error` when a payload
 * carries parameters the selected model doesn't support. The three cases that
 * have bitten us:
 *   1. `reasoning` on a non-reasoning model (gpt-realtime / gpt-realtime-mini).
 *   2. `gpt-realtime-whisper` input transcription combined with VAD — that
 *      transcription model requires `turn_detection: null`, so it can never be
 *      used in a hands-free voice session.
 *   3. Unvalidated `voice` / `speed` pass-through: a Gemini voice name saved
 *      on an assistant profile, or a NaN speed (serialized to JSON `null`),
 *      both fail the session mint.
 * Everything here exists to make those states unrepresentable.
 */

import type { NoiseMode } from "@workspace/voicelab-core/noise";

// ── Model selection ────────────────────────────────────────────────────────────

/**
 * gpt-realtime-2.1 — current production speech-to-speech reasoning model
 * (improved alphanumeric recognition, noise handling, and interruption
 * behavior over gpt-realtime-2). Override with OPENAI_REALTIME_MODEL only for
 * a deliberate compatibility or cost test.
 */
export const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";

/**
 * Reasoning-capable Realtime models (the gpt-realtime-2.x family). Sending a
 * `reasoning` block to any other model is a parameter error, so callers must
 * gate on this.
 */
export function isReasoningRealtimeModel(model: string): boolean {
  return /^gpt-realtime-2(\.|$|-)/.test(model);
}

export type RealtimeReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

const REASONING_EFFORTS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high", "xhigh"]);

/**
 * OpenAI recommends reasoning.effort="low" as the production starting point
 * for Realtime 2 voice agents. It preserves fast first-audio latency while
 * giving tool selection, entity capture, and multi-step requests more headroom
 * than the minimum setting. Override with OPENAI_REALTIME_REASONING_EFFORT when
 * a measured workload needs a different latency/quality trade-off. An
 * unrecognized env value falls back to "low" instead of reaching the API.
 */
export const OPENAI_REALTIME_REASONING_EFFORT: RealtimeReasoningEffort = (() => {
  const raw = process.env.OPENAI_REALTIME_REASONING_EFFORT?.trim().toLowerCase();
  return raw && REASONING_EFFORTS.has(raw) ? (raw as RealtimeReasoningEffort) : "low";
})();

/**
 * Reasoning config for the given model, or an empty object for models that
 * would reject the parameter. Spread the result into the session payload.
 */
export function reasoningConfigFor(model: string): { reasoning?: { effort: RealtimeReasoningEffort } } {
  return isReasoningRealtimeModel(model) ? { reasoning: { effort: OPENAI_REALTIME_REASONING_EFFORT } } : {};
}

// ── Voice + speed sanitization ─────────────────────────────────────────────────

/** Built-in GA Realtime voices. OpenAI recommends marin and cedar for quality. */
export const OPENAI_REALTIME_VOICES: ReadonlySet<string> = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
]);

export const DEFAULT_REALTIME_VOICE = "marin";

/**
 * Clamp an arbitrary configured voice to one OpenAI accepts. Assistant
 * profiles can carry a Gemini voice name (e.g. "Kore") after an engine
 * switch — forwarding that fails the whole session mint.
 */
export function sanitizeRealtimeVoice(voice: unknown, fallback: string = DEFAULT_REALTIME_VOICE): string {
  if (typeof voice === "string") {
    const normalized = voice.trim().toLowerCase();
    if (OPENAI_REALTIME_VOICES.has(normalized)) return normalized;
    // Custom cloned voices are referenced as {id: "voice_..."} objects by the
    // API, but arrive here as plain strings from profile config.
    if (/^voice_[A-Za-z0-9]+$/.test(voice.trim())) return voice.trim();
  }
  return fallback;
}

/** API-accepted playback speed range. */
const MIN_SPEED = 0.25;
const MAX_SPEED = 1.5;

/**
 * Coerce speed to a finite number within the API's accepted range. NaN (e.g.
 * parseFloat of a corrupted client pref) would serialize to JSON null and be
 * rejected as an invalid type.
 */
export function sanitizeRealtimeSpeed(speed: unknown, fallback = 1.0): number {
  const value = Number(speed);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

// ── Audio configuration ────────────────────────────────────────────────────────

/**
 * Input transcription model. gpt-4o-mini-transcribe runs alongside any VAD
 * mode with low latency; transcripts drive the on-screen ghost lines and
 * termination-phrase matching, not the model's own hearing.
 *
 * Do NOT default this to gpt-realtime-whisper: that model requires
 * turn_detection null and rejects hands-free sessions.
 */
export const OPENAI_REALTIME_TRANSCRIPTION_MODEL =
  process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";

const PCM_24K = { type: "audio/pcm" as const, rate: 24000 as const };

/**
 * Input noise reduction by venue noise mode. near_field suits phones/tablets
 * at arm's length; far_field suits loud rooms where the device sits away from
 * the speaker. Filtering feeds VAD and the model, improving turn detection.
 */
function noiseReductionFor(noiseMode: NoiseMode): { type: "near_field" | "far_field" } {
  return { type: noiseMode === "loud" ? "far_field" : "near_field" };
}

export interface RealtimeAudioOptions {
  voice: unknown;
  speed: unknown;
  turnDetection: Record<string, unknown> | null;
  noiseMode?: NoiseMode;
}

/** Build the GA `session.audio` block with sanitized voice/speed. */
export function buildRealtimeAudioConfig(opts: RealtimeAudioOptions) {
  return {
    input: {
      format: PCM_24K,
      transcription: { model: OPENAI_REALTIME_TRANSCRIPTION_MODEL },
      noise_reduction: noiseReductionFor(opts.noiseMode ?? "standard"),
      turn_detection: opts.turnDetection,
    },
    output: {
      format: PCM_24K,
      voice: sanitizeRealtimeVoice(opts.voice),
      speed: sanitizeRealtimeSpeed(opts.speed),
    },
  };
}

// ── Session payload ────────────────────────────────────────────────────────────

export interface RealtimeSessionOptions extends RealtimeAudioOptions {
  instructions: string;
  tools?: unknown[];
  model?: string;
}

/**
 * Build a complete GA session payload for POST /v1/realtime/client_secrets
 * (`{ session: ... }`) or a WS `session.update` (`{ type: "session.update",
 * session: ... }`).
 */
export function buildRealtimeSessionPayload(opts: RealtimeSessionOptions) {
  const model = opts.model ?? OPENAI_REALTIME_MODEL;
  return {
    type: "realtime" as const,
    model,
    instructions: opts.instructions,
    ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" as const } : {}),
    output_modalities: ["audio" as const],
    ...reasoningConfigFor(model),
    audio: buildRealtimeAudioConfig(opts),
  };
}
