/**
 * Modular cascaded pipeline adapter.
 *
 * Drives modular STT → LLM → TTS flows. The wizard picks one of five
 * preset compositions; each one is a different combination of provider
 * components. The adapter probes the credentials for every component
 * and reports honestly when any are missing. Sessions return a
 * `ws_relay` handshake pointing at /api/realtime/modular and the relay
 * (in routes/ws-relay.ts) orchestrates the full STT → LLM → tools → TTS
 * loop on the server.
 *
 * Component vendors:
 *   - STT:   deepgram (Flux), assemblyai (Streaming), cartesia (Ink)
 *   - LLM:   openai (gpt-4o-mini default)
 *   - TTS:   cartesia (Sonic), deepgram (Aura), openai (gpt-4o-mini-tts)
 *
 * Custom modular: STT/LLM/TTS components are read from
 * `voicePipelineConfig` so the operator can pick any combination
 * supported by the runtime.
 */

import type {
  VoicePipelineAdapter,
  VoicePipelineAvailability,
  VoicePipelineCloseContext,
  VoicePipelineEnvContext,
  VoicePipelineProvider,
  VoicePipelineSession,
  VoicePipelineSessionContext,
  VoicePipelineUseCase,
} from "@workspace/voicelab-core/voice-pipeline";

export type ModularSttVendor = "deepgram_flux" | "assemblyai_streaming" | "cartesia_ink";
export type ModularLlmVendor = "openai";
export type ModularTtsVendor = "cartesia_sonic" | "deepgram_aura" | "openai_tts";

export interface ModularComposition {
  stt: ModularSttVendor;
  llm: ModularLlmVendor;
  llmModel: string;
  tts: ModularTtsVendor;
}

export interface ModularAdapterSpec {
  provider: VoicePipelineProvider;
  displayName: string;
  recommendedFor: VoicePipelineUseCase[];
  composition: ModularComposition;
  /** When true, the wizard is allowed to override every vendor at runtime. */
  configurable: boolean;
}

const VENDOR_ENV: Record<ModularSttVendor | ModularTtsVendor, string[]> = {
  deepgram_flux: ["DEEPGRAM_API_KEY"],
  assemblyai_streaming: ["ASSEMBLYAI_API_KEY"],
  cartesia_ink: ["CARTESIA_API_KEY"],
  cartesia_sonic: ["CARTESIA_API_KEY"],
  deepgram_aura: ["DEEPGRAM_API_KEY"],
  openai_tts: ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
};
const LLM_ENV: Record<ModularLlmVendor, string[]> = {
  openai: ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
};

function envPresent(keys: string[]): boolean {
  return keys.some((k) => Boolean(process.env[k]));
}

function envMissing(keys: string[]): string {
  return keys.length === 1 ? keys[0] : `one of [${keys.join(", ")}]`;
}

const probeCache = new Map<string, { ok: boolean; reason?: string; expiresAt: number }>();
const PROBE_TTL_MS = 5 * 60_000;

async function probeVendor(label: string, fn: () => Promise<boolean>): Promise<{ ok: boolean; reason?: string }> {
  const cached = probeCache.get(label);
  if (cached && cached.expiresAt > Date.now()) return cached;
  try {
    const ok = await fn();
    const verdict = { ok, expiresAt: Date.now() + PROBE_TTL_MS };
    probeCache.set(label, verdict);
    return verdict;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "probe failed";
    const verdict = { ok: false, reason, expiresAt: Date.now() + 30_000 };
    probeCache.set(label, verdict);
    return verdict;
  }
}

async function probeDeepgramKey(): Promise<{ ok: boolean; reason?: string }> {
  return probeVendor("deepgram", async () => {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) return false;
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    return res.ok;
  });
}

async function probeAssemblyAiKey(): Promise<{ ok: boolean; reason?: string }> {
  return probeVendor("assemblyai", async () => {
    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) return false;
    const res = await fetch("https://api.assemblyai.com/v2/transcript?limit=1", {
      headers: { authorization: key },
    });
    return res.ok;
  });
}

async function probeCartesiaKey(): Promise<{ ok: boolean; reason?: string }> {
  return probeVendor("cartesia", async () => {
    const key = process.env.CARTESIA_API_KEY;
    if (!key) return false;
    const res = await fetch("https://api.cartesia.ai/voices/", {
      headers: {
        "X-API-Key": key,
        "Cartesia-Version": "2024-11-13",
      },
    });
    return res.ok;
  });
}

async function probeOpenAiKey(): Promise<{ ok: boolean; reason?: string }> {
  return probeVendor("openai", async () => {
    const key = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!key) return false;
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  });
}

async function probeVendorByName(v: ModularSttVendor | ModularLlmVendor | ModularTtsVendor): Promise<{ ok: boolean; reason?: string }> {
  switch (v) {
    case "deepgram_flux":
    case "deepgram_aura":
      return probeDeepgramKey();
    case "assemblyai_streaming":
      return probeAssemblyAiKey();
    case "cartesia_ink":
    case "cartesia_sonic":
      return probeCartesiaKey();
    case "openai":
    case "openai_tts":
      return probeOpenAiKey();
    default:
      return { ok: false, reason: `unknown vendor: ${v}` };
  }
}

export class ModularCascadedAdapter implements VoicePipelineAdapter {
  readonly provider: VoicePipelineProvider;
  readonly category = "modular_cascaded_pipeline" as const;
  readonly displayName: string;
  readonly recommendedFor: VoicePipelineUseCase[];
  readonly composition: ModularComposition;
  readonly configurable: boolean;

  readonly supportsNativeAudio = false;
  readonly supportsRealtimeToolCalling = true;
  readonly supportsBargeIn = true;
  readonly supportsServerVAD = true;
  readonly supportsClientVAD = false;
  readonly supportsTurnDetection = true;
  readonly supportsNoiseSuppression = false;
  readonly supportsWakeWord = false;
  readonly supportsMultilingual = true;
  readonly supportsMobile = true;
  readonly supportsBrowser = true;

  readonly requiresServerRelay = true;
  readonly requiresEphemeralToken = false;
  readonly requiresProviderAgentConfig = false;

  constructor(spec: ModularAdapterSpec) {
    this.provider = spec.provider;
    this.displayName = spec.displayName;
    this.recommendedFor = spec.recommendedFor;
    this.composition = spec.composition;
    this.configurable = spec.configurable;
  }

  async availability(_ctx: VoicePipelineEnvContext): Promise<VoicePipelineAvailability> {
    if (this.configurable) {
      // Custom pipeline: at minimum we need an LLM provider; STT/TTS are
      // selectable per-session via the agent profile config.
      if (!envPresent(LLM_ENV.openai)) {
        return {
          status: "needs_configuration",
          reason: `Custom modular pipeline needs at least one LLM provider configured. Set ${envMissing(LLM_ENV.openai)}.`,
          missing: LLM_ENV.openai,
        };
      }
      return { status: "available", reason: "Configurable per agent profile (STT, LLM, TTS)." };
    }

    const checks: Array<{ vendor: string; envKeys: string[]; runtime: () => Promise<{ ok: boolean; reason?: string }> }> = [
      { vendor: this.composition.stt, envKeys: VENDOR_ENV[this.composition.stt], runtime: () => probeVendorByName(this.composition.stt) },
      { vendor: this.composition.llm, envKeys: LLM_ENV[this.composition.llm], runtime: () => probeVendorByName(this.composition.llm) },
      { vendor: this.composition.tts, envKeys: VENDOR_ENV[this.composition.tts], runtime: () => probeVendorByName(this.composition.tts) },
    ];

    const missing = new Set<string>();
    const reasons: string[] = [];
    for (const c of checks) {
      if (!envPresent(c.envKeys)) {
        for (const k of c.envKeys) missing.add(k);
        reasons.push(`${c.vendor}: missing ${envMissing(c.envKeys)}`);
        continue;
      }
      const probe = await c.runtime();
      if (!probe.ok) {
        for (const k of c.envKeys) missing.add(k);
        reasons.push(`${c.vendor}: ${probe.reason ?? "credentials rejected"}`);
      }
    }
    if (missing.size > 0 || reasons.length > 0) {
      return {
        status: "needs_configuration",
        reason: reasons.join("; "),
        missing: Array.from(missing),
      };
    }
    return { status: "available" };
  }

  async createSession(ctx: VoicePipelineSessionContext): Promise<VoicePipelineSession> {
    const sessionId = `mod-${this.provider}-${ctx.userId}-${Date.now()}`;
    const composition: ModularComposition = this.configurable
      ? {
          stt: ((ctx.providerOptions.stt as ModularSttVendor) ?? this.composition.stt),
          llm: ((ctx.providerOptions.llm as ModularLlmVendor) ?? this.composition.llm),
          llmModel: ((ctx.providerOptions.llmModel as string) ?? this.composition.llmModel),
          tts: ((ctx.providerOptions.tts as ModularTtsVendor) ?? this.composition.tts),
        }
      : this.composition;

    return {
      sessionId,
      provider: this.provider,
      clientHandshake: {
        kind: "ws_relay",
        payload: {
          path: "/api/realtime/modular",
          query: {
            sessionId,
            provider: this.provider,
            stt: composition.stt,
            llm: composition.llm,
            llmModel: composition.llmModel,
            tts: composition.tts,
            agentProfileId: ctx.agentProfileId,
          },
        },
      },
      capabilities: {
        nativeAudio: false,
        realtimeToolCalling: true,
        bargeIn: true,
        serverVAD: true,
      },
    };
  }

  async closeSession(_ctx: VoicePipelineCloseContext): Promise<void> {
    /* Cleanup happens in the modular relay. */
  }
}

export const MODULAR_ADAPTER_SPECS: ModularAdapterSpec[] = [
  {
    provider: "deepgram_flux_cartesia",
    displayName: "Deepgram Flux + Cartesia Sonic",
    recommendedFor: ["noisy_bar", "nightclub", "best_turn_taking"],
    composition: { stt: "deepgram_flux", llm: "openai", llmModel: "gpt-4o-mini", tts: "cartesia_sonic" },
    configurable: false,
  },
  {
    provider: "deepgram_flux_aura",
    displayName: "Deepgram Flux + Aura",
    recommendedFor: ["noisy_bar", "best_turn_taking"],
    composition: { stt: "deepgram_flux", llm: "openai", llmModel: "gpt-4o-mini", tts: "deepgram_aura" },
    configurable: false,
  },
  {
    provider: "cartesia_ink_sonic",
    displayName: "Cartesia Ink + Sonic",
    recommendedFor: ["best_voice_quality"],
    composition: { stt: "cartesia_ink", llm: "openai", llmModel: "gpt-4o-mini", tts: "cartesia_sonic" },
    configurable: false,
  },
  {
    provider: "assemblyai_openai_cartesia",
    displayName: "AssemblyAI + OpenAI + Cartesia",
    recommendedFor: ["best_tool_control"],
    composition: { stt: "assemblyai_streaming", llm: "openai", llmModel: "gpt-4o-mini", tts: "cartesia_sonic" },
    configurable: false,
  },
  {
    provider: "custom_modular_pipeline",
    displayName: "Custom modular pipeline",
    recommendedFor: [],
    composition: { stt: "deepgram_flux", llm: "openai", llmModel: "gpt-4o-mini", tts: "openai_tts" },
    configurable: true,
  },
];
