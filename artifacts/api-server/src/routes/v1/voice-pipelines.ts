import { Router, type Request, type Response } from "express";
import { v1 } from "@workspace/api-zod";
import {
  getAllPipelineAvailability,
  readVoicePipelineEnvCredentials,
} from "../../voice-pipelines";
import { recommendVoicePipeline } from "@workspace/voicelab-core/voice-pipeline";
import { listVoicePipelineProviders } from "@workspace/voicelab-core/voice-pipeline";
import { readServerApiKey, requiredApiKeyEnv } from "../../lib/api-keys";
import { requireAuth } from "../auth";
import { createComponentLogger } from "../../lib/logger";

const router = Router();
router.use(requireAuth as never);
const log = createComponentLogger("voice-pipelines");

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
};

const SAMPLE_DEFAULT_VOICE: Record<string, string> = {
  openai_realtime_webrtc: "ash",
  openai_realtime_server_ws: "ash",
  google_gemini_3_1_flash_live: "Kore",
  google_gemini_2_5_flash_native_audio: "Aoede",
  google_gemini_live_native_audio: "Aoede",
};

// Provider kind for the sample renderer. Native realtime providers have
// their own TTS endpoints (openai/gemini).
const SAMPLE_PROVIDER_KIND: Record<string, "openai" | "gemini"> = {
  openai_realtime_webrtc: "openai",
  openai_realtime_server_ws: "openai",
  google_gemini_3_1_flash_live: "gemini",
  google_gemini_2_5_flash_native_audio: "gemini",
  google_gemini_live_native_audio: "gemini",
};

// Voice label -> OpenAI voice fallback for synthesis (currently unused
// since all remaining providers have native TTS, kept for future use).
const PREVIEW_VOICE_FALLBACK: Record<string, string> = {};

interface CachedSample {
  bytes: Buffer;
  contentType: string;
  expiresAt: number;
}
const sampleCache = new Map<string, CachedSample>();
const SAMPLE_TTL_MS = 6 * 60 * 60 * 1000;
const sampleHits = new Map<string, number[]>();
const SAMPLE_RATE_WINDOW_MS = 60 * 60 * 1000;
const SAMPLE_RATE_MAX = 60;

function sampleRateLimitOk(req: Request): boolean {
  const userId = (req as Request & { user?: { id?: number } }).user?.id;
  const key = userId ? `user:${userId}` : `ip:${req.ip ?? "unknown"}`;
  const now = Date.now();
  const fresh = (sampleHits.get(key) ?? []).filter((t) => now - t < SAMPLE_RATE_WINDOW_MS);
  if (fresh.length >= SAMPLE_RATE_MAX) {
    sampleHits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  sampleHits.set(key, fresh);
  return true;
}

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
  const apiKey = readServerApiKey("openai")?.value;
  if (!apiKey) throw new Error(`${requiredApiKeyEnv("openai")} not configured`);
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
  const apiKey = readServerApiKey("gemini")?.value;
  if (!apiKey) throw new Error(`${requiredApiKeyEnv("gemini")} not configured`);
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
          "Google denied this project access to Gemini audio previews. Enable billing/API access for the project that owns this key, or create a new key from a billed AI Studio project.",
        );
      }
      throw new Error(`Gemini TTS HTTP ${res.status}`);
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
  if (!sampleRateLimitOk(req)) {
    res.status(429).json({
      error: {
        code: "sample_rate_limited",
        message: "Too many voice previews. Try again later.",
      },
    });
    return;
  }
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
          details: { httpStatus: e.status },
        },
      });
      return;
    }
    const provider = String(req.params.provider);
    log.warn(
      {
        provider,
        reason: e instanceof Error ? e.message : "synthesis failed",
      },
      "voice sample synthesis failed",
    );
    const message =
      e instanceof Error && /access to Gemini audio previews/i.test(e.message)
        ? e.message
        : "Voice preview could not be generated right now. The assistant can still use the selected voice when the provider is configured.";
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
  const apiKey = readServerApiKey("openai")?.value ?? "";
  if (!apiKey) {
    const snapshot: OpenAiStatus = {
      ok: false,
      reason: "missing_key",
      message: `${requiredApiKeyEnv("openai")} is not set in the server environment.`,
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
    const reason: OpenAiStatus["reason"] =
      res.status === 429 && (errCode === "insufficient_quota" || errType === "insufficient_quota")
        ? "insufficient_quota"
        : res.status === 401 || res.status === 403
        ? "billing_disabled"
        : "unknown";
    const message =
      reason === "insufficient_quota"
        ? "OpenAI quota is exhausted for the configured project."
        : reason === "billing_disabled"
        ? "OpenAI rejected the configured project key. Verify that the key is active and billing is enabled."
        : `OpenAI status probe failed with HTTP ${res.status}.`;
    const snapshot: OpenAiStatus = { ok: false, reason, message, checkedAt: new Date().toISOString() };
    // Negative results live for the full TTL so we don't melt the upstream.
    openAiStatusCache = { snapshot, expiresAt: Date.now() + OPENAI_STATUS_TTL_MS };
    return snapshot;
  } catch (e) {
    const snapshot: OpenAiStatus = {
      ok: false,
      reason: "unknown",
      message: "OpenAI status probe could not complete right now.",
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
