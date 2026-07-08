import { z } from "zod";

/**
 * v1 API schemas — request and response shapes for the new
 * provider-agnostic endpoints.
 */

// ── Connected service providers ───────────────────────────────────────────────

const ConnectedServiceProvider = z.enum([
  "square",
  "toast",
  "clover",
  "lightspeed",
  "shopify_pos",
  "gopayments_poynt",
  "revel",
  "generic_rest",
  "webhook",
  "mock",
]);

// ── Voice pipelines ───────────────────────────────────────────────────────────

const VoicePipelineProvider = z.enum([
  "openai_realtime_webrtc",
  "openai_realtime_server_ws",
  "google_gemini_3_1_flash_live",
  "google_gemini_2_5_flash_native_audio",
  "browser_speech_api_fallback",
  "push_to_talk_text_fallback",
  "text_only_fallback",
]);

const NoiseMode = z.enum([
  "standard",
  "loud",
  "push_to_talk",
]);

export const RecommendVoicePipelineRequest = z.object({
  deviceType: z.enum([
    "desktop_browser",
    "mobile_browser",
    "ios_native",
    "android_native",
    "server",
    "unknown",
  ]),
  environment: NoiseMode,
  connectedServiceProvider: ConnectedServiceProvider,
  requiresToolCalling: z.boolean().default(true),
  requiresBestVoiceQuality: z.boolean().default(false),
  requiresLowestLatency: z.boolean().default(false),
  requiresEnterpriseObservability: z.boolean().default(false),
});

// ── Agent profiles ────────────────────────────────────────────────────────────

export const CreateAgentProfileRequest = z.object({
  organizationId: z.string().uuid(),
  venueId: z.number().int().positive().optional(),
  // Optional foreign key to service_connections.id. Only accept UUIDs;
  // empty strings or provider slugs ("square", "toast", …) are coerced to
  // undefined so the server stores NULL instead of failing validation.
  connectedServiceId: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      return isUuid ? v : undefined;
    }),
  displayName: z.string().min(1).max(60),
  wakePhrase: z.string().min(1).max(60).optional(),
  wakeMode: z.enum(["ambient", "tap"]).default("ambient"),
  voicePipelineProvider: VoicePipelineProvider,
  voicePipelineConfig: z.record(z.unknown()).default({}),
  noiseMode: NoiseMode.default("standard"),
  orderHandlingMode: z.enum(["auto_complete", "hold_for_review"]).default("auto_complete"),
  allowedTools: z.array(z.string()).default([]),
  confirmationPolicy: z.record(z.unknown()).default({}),
  personality: z.string().default(""),
});

export const UpdateAgentProfileRequest = CreateAgentProfileRequest.partial();

// ── Realtime sessions ─────────────────────────────────────────────────────────

export const CreateRealtimeSessionRequest = z.object({
  agentProfileId: z.string().uuid(),
  /** Override the profile's pipeline for testing/debugging. */
  pipelineOverride: VoicePipelineProvider.optional(),
});

