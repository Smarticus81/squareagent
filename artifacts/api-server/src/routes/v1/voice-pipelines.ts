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
};

const SAMPLE_DEFAULT_VOICE: Record<string, string> = {
  openai_realtime_webrtc: "ash",
  openai_realtime_server_ws: "ash",
  google_gemini_3_1_flash_live: "Kore",
  google_gemini_2_5_flash_native_audio: "Aoede",
  google_gemini_live_native_audio: "Aoede",
};

const SAMPLE_PROVIDER_KIND: Record<string, "openai" | "gemini"> = {
  openai_realtime_webrtc: "openai",
  openai_realtime_server_ws: "openai",
  google_gemini_3_1_flash_live: "gemini",
  google_gemini_2_5_flash_native_audio: "gemini",
  google_gemini_live_native_audio: "gemini",
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
    const synth =
      kind === "openai"
        ? await synthesizeOpenAISample(voice, SAMPLE_LINE)
        : await synthesizeGeminiSample(voice, SAMPLE_LINE);
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
    const message = e instanceof Error ? e.message : "synthesis failed";
    res.status(502).json({ error: { code: "sample_failed", message } });
  }
});

export default router;
