import { z } from "zod";

/**
 * v1 API schemas — request and response shapes for the new
 * provider-agnostic endpoints.
 */

// ── Common ────────────────────────────────────────────────────────────────────

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

// ── Connected service providers ───────────────────────────────────────────────

export const ConnectedServiceProvider = z.enum([
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

export const ConnectedServiceAvailabilityStatus = z.enum([
  "available",
  "needs_configuration",
  "request_access",
  "unavailable",
]);

export const ConnectedServiceProviderMetadata = z.object({
  provider: ConnectedServiceProvider,
  displayName: z.string(),
  description: z.string(),
  status: ConnectedServiceAvailabilityStatus,
  capabilities: z.array(z.string()),
  notes: z.string().optional(),
  requestAccessUrl: z.string().optional(),
});

export const ListProvidersResponse = z.object({
  providers: z.array(ConnectedServiceProviderMetadata),
});

// ── Service connections ───────────────────────────────────────────────────────

export const CreateServiceConnectionRequest = z.object({
  organizationId: z.string().uuid(),
  venueId: z.number().int().positive().optional(),
  provider: ConnectedServiceProvider,
  credentials: z.record(z.unknown()).default({}),
  config: z.record(z.unknown()).default({}),
});

export const ServiceConnectionResponse = z.object({
  id: z.string(),
  organizationId: z.string(),
  venueId: z.string(),
  provider: ConnectedServiceProvider,
  status: ConnectedServiceAvailabilityStatus,
  config: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Voice pipelines ───────────────────────────────────────────────────────────

export const VoicePipelineProvider = z.enum([
  "openai_realtime_webrtc",
  "openai_realtime_server_ws",
  "google_gemini_3_1_flash_live",
  "google_gemini_2_5_flash_native_audio",
  "google_gemini_live_native_audio",
  "browser_speech_api_fallback",
  "push_to_talk_text_fallback",
  "text_only_fallback",
]);

export const VoicePipelineCategory = z.enum([
  "native_realtime_speech_to_speech",
  "browser_or_manual_fallback",
]);

export const VoicePipelineAvailabilityStatus = z.enum([
  "available",
  "needs_configuration",
  "request_access",
  "experimental",
  "unavailable",
]);

export const VoicePipelineAvailabilityReport = z.object({
  provider: VoicePipelineProvider,
  displayName: z.string(),
  category: z.string(),
  status: VoicePipelineAvailabilityStatus,
  reason: z.string().optional(),
  missing: z.array(z.string()).optional(),
});

export const ListVoicePipelinesResponse = z.object({
  pipelines: z.array(VoicePipelineAvailabilityReport),
});

export const NoiseMode = z.enum([
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

export const RecommendVoicePipelineResponse = z.object({
  recommendedProvider: VoicePipelineProvider,
  fallbackProviders: z.array(VoicePipelineProvider),
  reason: z.string(),
  warnings: z.array(z.string()),
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
  voicePipelineProvider: VoicePipelineProvider,
  voicePipelineConfig: z.record(z.unknown()).default({}),
  noiseMode: NoiseMode.default("standard"),
  allowedTools: z.array(z.string()).default([]),
  confirmationPolicy: z.record(z.unknown()).default({}),
  personality: z.string().default(""),
});

export const UpdateAgentProfileRequest = CreateAgentProfileRequest.partial();

export const AgentProfileResponse = z.object({
  id: z.string(),
  organizationId: z.string(),
  venueId: z.number().nullable(),
  connectedServiceId: z.string().nullable(),
  displayName: z.string(),
  wakePhrase: z.string(),
  voicePipelineProvider: VoicePipelineProvider,
  voicePipelineConfig: z.record(z.unknown()),
  noiseMode: NoiseMode,
  allowedTools: z.array(z.string()),
  confirmationPolicy: z.record(z.unknown()),
  personality: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Realtime sessions ─────────────────────────────────────────────────────────

export const CreateRealtimeSessionRequest = z.object({
  agentProfileId: z.string().uuid(),
  /** Override the profile's pipeline for testing/debugging. */
  pipelineOverride: VoicePipelineProvider.optional(),
});

export const RealtimeSessionResponse = z.object({
  sessionId: z.string(),
  provider: VoicePipelineProvider,
  agentDisplayName: z.string(),
  noiseMode: NoiseMode,
  clientHandshake: z.object({
    kind: z.enum(["ephemeral_token", "signed_url", "ws_relay", "config_only", "noop"]),
    expiresAt: z.string().optional(),
    payload: z.record(z.unknown()),
  }).optional(),
  capabilities: z.object({
    nativeAudio: z.boolean(),
    realtimeToolCalling: z.boolean(),
    bargeIn: z.boolean(),
    serverVAD: z.boolean(),
  }),
});

// ── Tool calls ────────────────────────────────────────────────────────────────

export const ExecuteToolCallRequest = z.object({
  sessionId: z.string(),
  agentProfileId: z.string().uuid(),
  toolName: z.string(),
  args: z.record(z.unknown()).default({}),
  /** Set when the user has already confirmed at the client. */
  confirmation: z
    .object({ token: z.string(), confirmedAt: z.string() })
    .optional(),
});

export const ExecuteToolCallResponse = z.object({
  status: z.enum(["succeeded", "needs_confirmation", "failed", "denied"]),
  result: z.string().optional(),
  command: z.record(z.unknown()).nullable().optional(),
  confirmation: z
    .object({
      gateId: z.string(),
      prompt: z.string(),
      riskLevel: z.enum(["low", "medium", "high", "destructive"]),
    })
    .optional(),
  toolCallId: z.string().optional(),
});

// ── Integration health ───────────────────────────────────────────────────────

export const IntegrationHealthResponse = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      provider: ConnectedServiceProvider,
      status: z.enum(["healthy", "degraded", "down", "unauthorized"]),
      message: z.string().optional(),
      checkedAt: z.string(),
    }),
  ),
});

export type CreateAgentProfileBody = z.infer<typeof CreateAgentProfileRequest>;
export type UpdateAgentProfileBody = z.infer<typeof UpdateAgentProfileRequest>;
export type RecommendVoicePipelineBody = z.infer<typeof RecommendVoicePipelineRequest>;
export type CreateRealtimeSessionBody = z.infer<typeof CreateRealtimeSessionRequest>;
export type ExecuteToolCallBody = z.infer<typeof ExecuteToolCallRequest>;
