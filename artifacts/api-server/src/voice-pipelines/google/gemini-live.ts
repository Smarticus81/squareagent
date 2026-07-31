/**
 * Google Gemini Live API adapter.
 *
 * Implements the BidiGenerateContent stateful WebSocket session against
 *   wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 *
 * The browser client cannot hold the long-lived authenticated session to
 * Google directly with the org's API key, so we mint a server-relayed
 * session: createSession returns a `ws_relay` handshake pointing at the
 * VoyceLab gateway path /api/realtime/gemini, and the gateway opens the
 * upstream Gemini WebSocket on behalf of the client. The relay logic
 * itself lives in routes/ws-relay.ts so it can share auth, plan checks,
 * and Square credential lookup with the OpenAI relay.
 *
 * One adapter class is registered twice with different model IDs:
 *   - google_gemini_3_1_flash_live              -> gemini-3.1-flash-live-preview
 *   - google_gemini_2_5_flash_native_audio      -> gemini-2.5-flash-native-audio-preview-12-2025
 */

import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineProvider,
  VoicePipelineSession,
  VoicePipelineSessionContext,
} from "@workspace/voicelab-core/voice-pipeline";
import type { NoiseMode } from "@workspace/voicelab-core/noise";
import { readServerApiKey, requireServerApiKey, requiredApiKeyEnv } from "../../lib/api-keys";

export interface GeminiLiveAdapterSpec {
  provider: VoicePipelineProvider;
  displayName: string;
  recommendedFor: VoicePipelineAdapter["recommendedFor"];
  /** Resource name suffix; full string sent to Gemini is `models/<modelId>`. */
  modelId: string;
  /** Adapter-level marker that influences the relay's default config. */
  capabilityProfile: "preview_3_1" | "ga_2_5";
}

function readApiKey(): string {
  return readServerApiKey("gemini")?.value ?? "";
}

function stringOption(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanOption(options: Record<string, unknown>, key: string): boolean | undefined {
  const value = options[key];
  return typeof value === "boolean" ? value : undefined;
}

function languageCodesOption(options: Record<string, unknown>): string | undefined {
  const value = options.languageCodes;
  if (!Array.isArray(value)) return undefined;
  const codes = value
    .filter((code): code is string => typeof code === "string" && code.trim().length > 0)
    .map((code) => code.trim());
  return codes.length > 0 ? codes.join(",") : undefined;
}

function noiseModeOption(options: Record<string, unknown>): NoiseMode | undefined {
  const value = options.noiseMode;
  return value === "standard" || value === "loud" || value === "push_to_talk" ? value : undefined;
}

/**
 * Cache the result of a real generation probe so the wizard shows a
 * truthful availability for each Gemini provider. We can't tell from key
 * format alone whether the underlying GCP project has been granted
 * access to the Generative Language API — a key that lists models can
 * still be denied at generation time. The probe sends one tiny text
 * request and remembers the verdict for a few minutes.
 */
type ProbeVerdict =
  | { ok: true }
  | { ok: false; status: number; reason: string };

let probeCache: { verdict: ProbeVerdict; expiresAt: number } | null = null;
const PROBE_TTL_MS = 5 * 60 * 1000;

async function probeGeminiAccess(): Promise<ProbeVerdict> {
  if (probeCache && probeCache.expiresAt > Date.now()) return probeCache.verdict;
  const apiKey = readApiKey();
  if (!apiKey) {
    const verdict: ProbeVerdict = { ok: false, status: 0, reason: `${requiredApiKeyEnv("gemini")} not set` };
    probeCache = { verdict, expiresAt: Date.now() + PROBE_TTL_MS };
    return verdict;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ok" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
    );
    if (res.ok) {
      const verdict: ProbeVerdict = { ok: true };
      probeCache = { verdict, expiresAt: Date.now() + PROBE_TTL_MS };
      return verdict;
    }
    let reason = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string; status?: string } };
      if (body.error?.message) reason = body.error.message;
      if (body.error?.status) reason = `${body.error.status}: ${reason}`;
    } catch {
      // ignore
    }
    const verdict: ProbeVerdict = { ok: false, status: res.status, reason };
    probeCache = { verdict, expiresAt: Date.now() + PROBE_TTL_MS };
    return verdict;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "probe failed";
    const verdict: ProbeVerdict = { ok: false, status: 0, reason };
    probeCache = { verdict, expiresAt: Date.now() + 30 * 1000 };
    return verdict;
  } finally {
    clearTimeout(timeout);
  }
}

export class GoogleGeminiLiveAdapter implements VoicePipelineAdapter {
  readonly provider: VoicePipelineProvider;
  readonly category = "native_realtime_speech_to_speech" as const;
  readonly displayName: string;
  readonly recommendedFor: VoicePipelineAdapter["recommendedFor"];
  readonly modelId: string;
  readonly capabilityProfile: GeminiLiveAdapterSpec["capabilityProfile"];

  readonly supportsNativeAudio = true;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = true;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = true;
  // Wake detection is provided by the VoyceLab PWA before the Gemini relay
  // session starts, so Gemini assistants can use the same configurable wake
  // phrase flow as OpenAI WebRTC assistants.
  readonly supportsWakeWord = true;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = true;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  constructor(spec: GeminiLiveAdapterSpec) {
    this.provider = spec.provider;
    this.displayName = spec.displayName;
    this.recommendedFor = spec.recommendedFor;
    this.modelId = spec.modelId;
    this.capabilityProfile = spec.capabilityProfile;
  }

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    if (!readApiKey()) {
      return {
        status: "needs_configuration",
        reason: `${requiredApiKeyEnv("gemini")} not set on the server.`,
        missing: [requiredApiKeyEnv("gemini")],
      };
    }
    // Real probe — a key that lists models can still be denied at
    // generation time if the Google Cloud project hasn't enabled
    // billing or hasn't been granted Generative Language API access.
    // We surface that clearly so the wizard doesn't promise an engine
    // we can't actually start a session with.
    const probe = await probeGeminiAccess();
    if (!probe.ok) {
      const isPermissionIssue = probe.status === 403 || /PERMISSION_DENIED/i.test(probe.reason);
      return {
        status: "needs_configuration",
        reason: isPermissionIssue
          ? "Google denied this project access to the Gemini API. Enable billing/API access on the project tied to the key, or generate a new key from a billed AI Studio project."
          : `Gemini availability probe failed with HTTP ${probe.status ?? "unknown"}.`,
        missing: [requiredApiKeyEnv("gemini")],
      };
    }
    return {
      status: this.capabilityProfile === "preview_3_1" ? "experimental" : "available",
      reason:
        this.capabilityProfile === "preview_3_1"
          ? "Preview model. Production-ready relay implemented; pricing and quotas may shift while in preview."
          : undefined,
    };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    if (!readApiKey()) {
      requireServerApiKey("gemini");
    }
    const sessionId = `gemini-${ctx.userId}-${Date.now()}`;
    const voiceName = stringOption(ctx.providerOptions, "voiceName") ?? stringOption(ctx.providerOptions, "voice");
    const proactiveAudio = booleanOption(ctx.providerOptions, "proactiveAudio");
    const affectiveDialog = booleanOption(ctx.providerOptions, "affectiveDialog");
    const thinkingLevel = stringOption(ctx.providerOptions, "thinkingLevel");
    const languageCodes = languageCodesOption(ctx.providerOptions);
    const noiseMode = noiseModeOption(ctx.providerOptions);
    return {
      sessionId,
      provider: this.provider,
      clientHandshake: {
        kind: "ws_relay",
        payload: {
          path: "/api/realtime/gemini",
          query: {
            sessionId,
            agentProfileId: ctx.agentProfileId,
            modelId: this.modelId,
            ...(voiceName ? { voice: voiceName } : {}),
            ...(typeof proactiveAudio === "boolean" ? { proactiveAudio: String(proactiveAudio) } : {}),
            ...(typeof affectiveDialog === "boolean" ? { affectiveDialog: String(affectiveDialog) } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            ...(languageCodes ? { languageCodes } : {}),
            ...(noiseMode ? { noiseMode } : {}),
          },
        },
      },
      capabilities: {
        nativeAudio: true,
        realtimeToolCalling: true,
        bargeIn: true,
        serverVAD: true,
      },
    };
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    // Cleanup happens in ws-relay on socket close.
  }
}

/**
 * Convert a VoyceLab ToolDefinition (OpenAI/JSON-Schema shape) into the
 * Gemini Live `Tool.functionDeclarations` shape. The schemas are largely
 * compatible — Gemini uses the same JSON-Schema subset and the same
 * `name`, `description`, `parameters` keys — so this is a 1:1 pass-through.
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function toGeminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT", properties: {} };
  }

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const rawType = typeof input.type === "string" ? input.type.toUpperCase() : undefined;
  if (rawType) output.type = rawType;
  if (typeof input.description === "string") output.description = input.description;
  if (Array.isArray(input.enum)) output.enum = input.enum;
  if (Array.isArray(input.required)) output.required = input.required;

  if (input.properties && typeof input.properties === "object") {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.properties as Record<string, unknown>)) {
      properties[key] = toGeminiSchema(value);
    }
    output.properties = properties;
  }

  if (input.items) {
    output.items = toGeminiSchema(input.items);
  }

  if (!output.type) {
    output.type = output.properties ? "OBJECT" : "STRING";
  }

  return output;
}

export function toolDefinitionsToGeminiTools(
  definitions: ReadonlyArray<{
    type?: string;
    name: string;
    description?: string;
    parameters?: unknown;
  }>,
): { functionDeclarations: GeminiFunctionDeclaration[] }[] {
  const decls: GeminiFunctionDeclaration[] = definitions.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: toGeminiSchema(t.parameters),
  }));
  return [{ functionDeclarations: decls }];
}

/**
 * Build the `setup` payload that opens a Gemini Live session for a given
 * agent. Used by the WS relay route.
 */
export interface GeminiSetupOptions {
  modelId: string;
  instructions: string;
  tools: ReadonlyArray<{
    type?: string;
    name: string;
    description?: string;
    parameters?: unknown;
  }>;
  capabilityProfile: GeminiLiveAdapterSpec["capabilityProfile"];
  /** ISO-639 / BCP-47 language codes for ASR; first wins for output. */
  inputLanguageCodes?: string[];
  /** Whether to enable Proactive Audio (2.5 native only). */
  proactiveAudio?: boolean;
  /** Whether to enable Affective Dialog (2.5 native only, v1alpha endpoint). */
  affectiveDialog?: boolean;
  /** Thinking depth for 3.1 Flash Live. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  /** Output voice (for native audio). Optional — Gemini uses defaults. */
  voiceName?: string;
  noiseMode?: NoiseMode;
}

function geminiRealtimeInputConfig(noiseMode: NoiseMode | undefined): Record<string, unknown> {
  const timing =
    noiseMode === "loud"
      ? { prefixPaddingMs: 500, silenceDurationMs: 1100 }
      : noiseMode === "push_to_talk"
        ? { prefixPaddingMs: 150, silenceDurationMs: 500 }
        : { prefixPaddingMs: 300, silenceDurationMs: 700 };

  return {
    automaticActivityDetection: {
      disabled: false,
      ...timing,
      startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
      endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
    },
    activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
  };
}

export function buildGeminiLiveSetupMessage(opts: GeminiSetupOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["AUDIO"],
    speechConfig: opts.voiceName
      ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } } }
      : undefined,
  };
  if (opts.thinkingLevel && opts.capabilityProfile === "preview_3_1") {
    (generationConfig as Record<string, unknown>).thinkingConfig = {
      thinkingLevel: opts.thinkingLevel.toUpperCase(),
    };
  }
  // Drop undefined so we don't send literal nulls.
  for (const k of Object.keys(generationConfig)) {
    if (generationConfig[k] === undefined) delete generationConfig[k];
  }

  const setup: Record<string, unknown> = {
    model: `models/${opts.modelId}`,
    generationConfig,
    systemInstruction: {
      parts: [{ text: opts.instructions }],
    },
    tools: toolDefinitionsToGeminiTools(opts.tools),
    realtimeInputConfig: geminiRealtimeInputConfig(opts.noiseMode),
    // The Live WebSocket AudioTranscriptionConfig currently has no fields.
    // Keep languageCodes in VoyceLab config/handshake for future provider
    // support, but do not send them here or Gemini closes setup as invalid.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };

  // Proactive audio: lets the model stay silent on irrelevant speech. Only
  // valid on the 2.5 native-audio model per the public schema.
  if (opts.proactiveAudio && opts.capabilityProfile === "ga_2_5") {
    setup.proactivity = { proactiveAudio: true };
  }
  if (opts.affectiveDialog && opts.capabilityProfile === "ga_2_5") {
    setup.enableAffectiveDialog = true;
  }

  return { setup };
}

function geminiLiveEndpoint(apiVersion: "v1alpha" | "v1beta" = "v1beta"): string {
  // Test/proxy hook: lets the relay smoke test stand up a local fake
  // upstream without touching Google. Never set in normal deployments.
  const override = process.env.GEMINI_LIVE_ENDPOINT_OVERRIDE?.trim();
  if (override) return override;
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent`;
}

export function buildGeminiLiveUrl(apiVersion: "v1alpha" | "v1beta" = "v1beta"): string {
  const apiKey = readApiKey();
  if (!apiKey) throw new Error(`${requiredApiKeyEnv("gemini")} missing`);
  return `${geminiLiveEndpoint(apiVersion)}?key=${encodeURIComponent(apiKey)}`;
}

export const GEMINI_LIVE_ADAPTER_SPECS: GeminiLiveAdapterSpec[] = [
  {
    provider: "google_gemini_3_1_flash_live",
    displayName: "Gemini 3.1 Flash Live",
    recommendedFor: [
      "lowest_latency_browser",
      "lowest_latency_mobile",
      "noisy_bar",
      "best_turn_taking",
      "best_tool_control",
    ],
    modelId: "gemini-3.1-flash-live-preview",
    capabilityProfile: "preview_3_1",
  },
  {
    provider: "google_gemini_2_5_flash_native_audio",
    displayName: "Gemini 2.5 Flash Native Audio",
    recommendedFor: ["best_voice_quality", "best_turn_taking", "enterprise_observability"],
    modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
    capabilityProfile: "ga_2_5",
  },
];
