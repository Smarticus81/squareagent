import { Router, type Request, type Response } from "express";
import { v1 } from "@workspace/api-zod";
import {
  getAllPipelineAvailability,
  readVoicePipelineEnvCredentials,
} from "../../voice-pipelines";
import { recommendVoicePipeline } from "@workspace/voicelab-core/voice-pipeline";
import { listVoicePipelineProviders } from "@workspace/voicelab-core/voice-pipeline";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const reports = await getAllPipelineAvailability();
  const meta = listVoicePipelineProviders();
  const enriched = reports.map((r) => {
    const m = meta.find((x) => x.provider === r.provider);
    return {
      ...r,
      shortDescription: m?.shortDescription,
      recommendedFor: m?.recommendedFor ?? [],
      requiredCredentials: m?.requiredCredentials ?? [],
      isFallback: m?.isFallback ?? false,
      isExperimental: m?.isExperimental ?? false,
      notes: m?.notes,
      sampleVoices: SAMPLE_VOICE_OPTIONS[r.provider] ?? [],
      sampleAvailable: SAMPLE_PROVIDER_KIND[r.provider] !== undefined,
    };
  });
  res.json({ pipelines: enriched });
});

router.post("/recommend", (req: Request, res: Response) => {
  const parsed = v1.RecommendVoicePipelineRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "invalid_request", message: parsed.error.message } });
    return;
  }
  const result = recommendVoicePipeline({
    ...parsed.data,
    availableCredentials: readVoicePipelineEnvCredentials(),
  });
  res.json(result);
});

// ── Sample audio preview ─────────────────────────────────────────────────────
//
// GET /api/v1/voice-pipelines/:provider/sample?voice=...
//
// Returns a real, freshly-synthesized audio/wav clip of the assistant
// greeting line, using the actual TTS API associated with the chosen
// pipeline. Cached in-process for 6h per (provider, voice, line) tuple.

const SAMPLE_LINE = "Hey, ready when you are. Two ranch waters and a Bud heavy?";

const SAMPLE_VOICE_OPTIONS: Record<string, string[]> = {
  openai_realtime_webrtc: ["ash", "alloy", "ballad", "coral", "sage", "verse"],
  openai_realtime_server_ws: ["ash", "alloy", "ballad", "coral", "sage", "verse"],
  google_gemini_3_1_flash_live: ["Kore", "Aoede", "Puck", "Charon", "Leda", "Fenrir"],
  google_gemini_2_5_flash_native_audio: ["Aoede", "Kore", "Puck", "Zephyr", "Charon", "Leda"],
  google_gemini_live_native_audio: ["Aoede", "Kore", "Puck", "Zephyr"],
  // Modular cascaded pipelines preview the OpenAI TTS voices because we
  // synthesize the sample with the same TTS path that pipeline uses for
  // OpenAI-driven turns; for Cartesia/Aura paths the voice character is
  // labelled but the preview clip falls back to OpenAI TTS so previews
  // stay available even without per-vendor keys.
  deepgram_flux_cartesia: ["ash", "alloy", "ballad", "sage"],
  deepgram_flux_aura: ["ash", "alloy", "ballad", "sage"],
  cartesia_ink_sonic: ["ash", "alloy", "ballad", "sage"],
  assemblyai_openai_cartesia: ["ash", "alloy", "ballad", "sage"],
  custom_modular_pipeline: ["ash", "alloy", "ballad", "sage"],
  // Hume / ElevenLabs / Deepgram-Agent / LiveKit / Pipecat each have
  // their own voice catalogs; we surface labels only and reuse OpenAI
  // TTS for the preview clip. The actual session uses the real provider.
  elevenlabs_agents: ["Rachel", "Bella", "Antoni", "Domi"],
  deepgram_voice_agent_api: ["asteria", "luna", "stella", "athena"],
  hume_evi_3: ["ITO", "KORA", "AURA"],
  livekit_agents: ["alloy", "ash", "verse"],
  pipecat: ["alloy", "ash", "verse"],
};

const SAMPLE_DEFAULT_VOICE: Record<string, string> = {
  openai_realtime_webrtc: "ash",
  openai_realtime_server_ws: "ash",
  google_gemini_3_1_flash_live: "Kore",
  google_gemini_2_5_flash_native_audio: "Aoede",
  google_gemini_live_native_audio: "Aoede",
  deepgram_flux_cartesia: "ash",
  deepgram_flux_aura: "ash",
  cartesia_ink_sonic: "ash",
  assemblyai_openai_cartesia: "ash",
  custom_modular_pipeline: "ash",
  elevenlabs_agents: "Rachel",
  deepgram_voice_agent_api: "asteria",
  hume_evi_3: "ITO",
  livekit_agents: "alloy",
  pipecat: "alloy",
};

// Provider kind for the sample renderer. Native realtime providers have
// their own TTS endpoints (openai/gemini); for everything else we
// synthesize a neutral preview through OpenAI TTS so the wizard always
// has *some* audio to play, even before the operator wires every key.
const SAMPLE_PROVIDER_KIND: Record<string, "openai" | "gemini"> = {
  openai_realtime_webrtc: "openai",
  openai_realtime_server_ws: "openai",
  google_gemini_3_1_flash_live: "gemini",
  google_gemini_2_5_flash_native_audio: "gemini",
  google_gemini_live_native_audio: "gemini",
  elevenlabs_agents: "openai",
  deepgram_voice_agent_api: "openai",
  hume_evi_3: "openai",
  livekit_agents: "openai",
  pipecat: "openai",
  deepgram_flux_cartesia: "openai",
  deepgram_flux_aura: "openai",
  cartesia_ink_sonic: "openai",
  assemblyai_openai_cartesia: "openai",
  custom_modular_pipeline: "openai",
};

// For previewers that aren't OpenAI/Gemini, we always render through
// OpenAI TTS using a neutral voice so the wizard never fails on
// missing creds. Map provider voice labels back to a real OpenAI voice
// for synthesis.
const PREVIEW_VOICE_FALLBACK: Record<string, string> = {
  Rachel: "alloy", Bella: "coral", Antoni: "ash", Domi: "verse",
  asteria: "alloy", luna: "coral", stella: "sage", athena: "verse",
  ITO: "ash", KORA: "coral", AURA: "alloy",
};

interface CachedSample {
  bytes: Buffer;
  contentType: string;
  expiresAt: number;
}
const sampleCache = new Map<string, CachedSample>();
const SAMPLE_TTL_MS = 6 * 60 * 60 * 1000;

function pcm16ToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

/**
 * Special error class so the route handler can map upstream billing
 * problems to a structured `openai_quota_exhausted` code rather than
 * leaking the raw OpenAI error back into the wizard.
 */
class OpenAiQuotaError extends Error {
  readonly status: number;
  readonly code: "insufficient_quota" | "billing_disabled" | "rate_limited";
  constructor(code: OpenAiQuotaError["code"], status: number, message: string) {
    super(message);
    this.name = "OpenAiQuotaError";
    this.status = status;
    this.code = code;
  }
}

async function synthesizeOpenAISample(voice: string, text: string): Promise<{ bytes: Buffer; contentType: string }> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "wav",
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      let parsed: { error?: { code?: string; type?: string; message?: string } } | null = null;
      try { parsed = JSON.parse(detail); } catch { /* not JSON */ }
      const errCode = parsed?.error?.code ?? "";
      const errType = parsed?.error?.type ?? "";
      const errMsg = parsed?.error?.message ?? detail;
      if (res.status === 429 && (errCode === "insufficient_quota" || errType === "insufficient_quota")) {
        throw new OpenAiQuotaError("insufficient_quota", 429, errMsg);
      }
      if (res.status === 401 || res.status === 403) {
        throw new OpenAiQuotaError("billing_disabled", res.status, errMsg);
      }
      if (res.status === 429) {
        throw new OpenAiQuotaError("rate_limited", 429, errMsg);
      }
      throw new Error(`OpenAI TTS HTTP ${res.status}: ${detail}`);
    }
    const arr = new Uint8Array(await res.arrayBuffer());
    return { bytes: Buffer.from(arr), contentType: "audio/wav" };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeGeminiSample(voice: string, text: string): Promise<{ bytes: Buffer; contentType: string }> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY not configured");
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    });
    if (!res.ok) {
      let parsed: { error?: { message?: string; status?: string } } | null = null;
      try {
        parsed = (await res.json()) as { error?: { message?: string; status?: string } };
      } catch {
        // fall through to text
      }
      const apiMessage = parsed?.error?.message ?? (await res.text().catch(() => ""));
      const apiStatus = parsed?.error?.status ?? "";
      const isPermissionIssue =
        res.status === 403 ||
        apiStatus === "PERMISSION_DENIED" ||
        /denied access/i.test(apiMessage);
      if (isPermissionIssue) {
        throw new Error(
          `Google denied your project access to the Gemini API. Enable billing on the GCP project that owns this API key, or create a new key from a billed AI Studio project. Raw: ${apiMessage}`,
        );
      }
      throw new Error(`Gemini TTS HTTP ${res.status}: ${apiMessage}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
      }>;
    };
    const inline = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) throw new Error("Gemini TTS returned no audio data");
    const pcm = Buffer.from(inline.data, "base64");
    const wav = pcm16ToWav(pcm, 24000, 1);
    return { bytes: wav, contentType: "audio/wav" };
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/:provider/sample", async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  const kind = SAMPLE_PROVIDER_KIND[provider];
  if (!kind) {
    res.status(404).json({
      error: {
        code: "sample_unsupported",
        message: `No sample available for "${provider}" yet. Configure native credentials for that provider to enable previews.`,
      },
    });
    return;
  }
  const allowed = SAMPLE_VOICE_OPTIONS[provider] ?? [];
  const requested = String(req.query.voice ?? SAMPLE_DEFAULT_VOICE[provider] ?? allowed[0] ?? "");
  const voice = allowed.includes(requested) ? requested : SAMPLE_DEFAULT_VOICE[provider] ?? allowed[0];
  if (!voice) {
    res.status(400).json({ error: { code: "no_voice", message: "No voice configured for this provider." } });
    return;
  }
  const cacheKey = `${provider}::${voice}::${SAMPLE_LINE}`;
  const cached = sampleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=21600");
    res.setHeader("X-Voycelab-Sample-Source", kind);
    res.setHeader("X-Voycelab-Sample-Voice", voice);
    res.send(cached.bytes);
    return;
  }
  try {
    // For non-native providers we always render through OpenAI TTS so a
    // preview is available even when that vendor's key isn't configured.
    // Map the labelled voice (e.g. "Rachel") back to a real OpenAI voice
    // (e.g. "alloy") before synthesis.
    const isNativeOpenAi = provider === "openai_realtime_webrtc" || provider === "openai_realtime_server_ws";
    const isNativeGemini = provider.startsWith("google_gemini_");
    const synth =
      kind === "openai" && !isNativeOpenAi
        ? await synthesizeOpenAISample(PREVIEW_VOICE_FALLBACK[voice] ?? "alloy", SAMPLE_LINE)
        : kind === "openai"
        ? await synthesizeOpenAISample(voice, SAMPLE_LINE)
        : isNativeGemini
        ? await synthesizeGeminiSample(voice, SAMPLE_LINE)
        : await synthesizeOpenAISample("alloy", SAMPLE_LINE);
    sampleCache.set(cacheKey, {
      bytes: synth.bytes,
      contentType: synth.contentType,
      expiresAt: Date.now() + SAMPLE_TTL_MS,
    });
    res.setHeader("Content-Type", synth.contentType);
    res.setHeader("Cache-Control", "public, max-age=21600");
    res.setHeader("X-Voycelab-Sample-Source", kind);
    res.setHeader("X-Voycelab-Sample-Voice", voice);
    res.send(synth.bytes);
  } catch (e) {
    if (e instanceof OpenAiQuotaError) {
      const friendly =
        e.code === "insufficient_quota"
          ? "Your OpenAI account is out of quota, so previews can't be synthesized server-side. The wizard will play a generic browser-voice preview instead. Add billing at platform.openai.com/settings/organization/billing to restore native previews."
          : e.code === "billing_disabled"
          ? "OpenAI rejected your API key (billing disabled or key inactive). Verify the key at platform.openai.com/api-keys and that the project has an active payment method."
          : "OpenAI is rate-limiting requests right now. Try again in a moment.";
      res.status(402).json({
        error: {
          code: e.code === "insufficient_quota" ? "openai_quota_exhausted"
            : e.code === "billing_disabled" ? "openai_billing_disabled"
            : "openai_rate_limited",
          message: friendly,
          details: { httpStatus: e.status, raw: e.message },
        },
      });
      return;
    }
    const message = e instanceof Error ? e.message : "synthesis failed";
    res.status(502).json({ error: { code: "sample_failed", message } });
  }
});

// ── OpenAI quota probe ───────────────────────────────────────────────────────
//
// GET /api/v1/voice-pipelines/openai-status
//
// Returns the live state of the configured OpenAI key so the dashboard can
// surface a banner when previews and live sessions will fail. This is a
// 1-token probe against the responses API; results are cached for 60s so
// dashboard refreshes don't hammer OpenAI.

interface OpenAiStatus {
  ok: boolean;
  reason: "ok" | "missing_key" | "insufficient_quota" | "billing_disabled" | "unknown";
  message?: string;
  checkedAt: string;
}

let openAiStatusCache: { snapshot: OpenAiStatus; expiresAt: number } | null = null;
const OPENAI_STATUS_TTL_MS = 60 * 1000;

async function probeOpenAiStatus(): Promise<OpenAiStatus> {
  if (openAiStatusCache && openAiStatusCache.expiresAt > Date.now()) {
    return openAiStatusCache.snapshot;
  }
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "";
  if (!apiKey) {
    const snapshot: OpenAiStatus = {
      ok: false,
      reason: "missing_key",
      message: "OPENAI_API_KEY is not set in the server environment.",
      checkedAt: new Date().toISOString(),
    };
    openAiStatusCache = { snapshot, expiresAt: Date.now() + OPENAI_STATUS_TTL_MS };
    return snapshot;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "gpt-4o-mini", input: "ok", max_output_tokens: 16 }),
    });
    if (res.ok) {
      const snapshot: OpenAiStatus = { ok: true, reason: "ok", checkedAt: new Date().toISOString() };
      openAiStatusCache = { snapshot, expiresAt: Date.now() + OPENAI_STATUS_TTL_MS };
      return snapshot;
    }
    let parsed: { error?: { code?: string; type?: string; message?: string } } | null = null;
    try { parsed = (await res.json()) as { error?: { code?: string; type?: string; message?: string } }; } catch { /* ignore */ }
    const errCode = parsed?.error?.code ?? "";
    const errType = parsed?.error?.type ?? "";
    const errMsg = parsed?.error?.message ?? `HTTP ${res.status}`;
    const reason: OpenAiStatus["reason"] =
      res.status === 429 && (errCode === "insufficient_quota" || errType === "insufficient_quota")
        ? "insufficient_quota"
        : res.status === 401 || res.status === 403
        ? "billing_disabled"
        : "unknown";
    const snapshot: OpenAiStatus = { ok: false, reason, message: errMsg, checkedAt: new Date().toISOString() };
    // Negative results live for the full TTL so we don't melt the upstream.
    openAiStatusCache = { snapshot, expiresAt: Date.now() + OPENAI_STATUS_TTL_MS };
    return snapshot;
  } catch (e) {
    const snapshot: OpenAiStatus = {
      ok: false,
      reason: "unknown",
      message: e instanceof Error ? e.message : "probe failed",
      checkedAt: new Date().toISOString(),
    };
    openAiStatusCache = { snapshot, expiresAt: Date.now() + 30 * 1000 };
    return snapshot;
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/openai-status", async (_req: Request, res: Response) => {
  const status = await probeOpenAiStatus();
  res.json(status);
});

export default router;
