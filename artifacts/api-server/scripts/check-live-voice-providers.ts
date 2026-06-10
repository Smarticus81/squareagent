import WebSocket from "ws";
import { readServerApiKey, requiredApiKeyEnv } from "../src/lib/api-keys";
import {
  buildGeminiLiveSetupMessage,
  buildGeminiLiveUrl,
} from "../src/voice-pipelines/google/gemini-live";

const TIMEOUT_MS = Number(process.env.VOICE_PROVIDER_CHECK_TIMEOUT_MS ?? 15000);
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_CHECK_MODEL ?? "gemini-3.1-flash-live-preview";

interface CheckResult {
  provider: "openai" | "gemini";
  ok: boolean;
  detail: string;
}

function sanitizeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "AIza[redacted]")
    .replace(/key=([^&\s]+)/g, "key=[redacted]")
    .slice(0, 500);
}

async function checkOpenAiRealtime(): Promise<CheckResult> {
  const apiKey = readServerApiKey("openai")?.value;
  if (!apiKey) {
    return { provider: "openai", ok: false, detail: `${requiredApiKeyEnv("openai")} is missing` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: OPENAI_REALTIME_MODEL,
          instructions: "Voice provider readiness check. Do not generate a response.",
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-realtime-whisper" },
              turn_detection: null,
            },
            output: {
              format: { type: "audio/pcm", rate: 24000 },
              voice: "ash",
              speed: 1,
            },
          },
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        provider: "openai",
        ok: false,
        detail: `Realtime client_secret failed with HTTP ${response.status}: ${sanitizeError(body)}`,
      };
    }
    const data = (await response.json()) as { value?: string; session?: { id?: string } };
    return {
      provider: "openai",
      ok: Boolean(data.value),
      detail: data.value ? `Realtime session minted for ${OPENAI_REALTIME_MODEL}` : "No client secret returned",
    };
  } catch (err) {
    return { provider: "openai", ok: false, detail: sanitizeError(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function waitForGeminiSetupComplete(ws: WebSocket): Promise<CheckResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ provider: "gemini", ok: false, detail: "Timed out waiting for setupComplete" });
    }, TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      ws.removeAllListeners("message");
      ws.removeAllListeners("error");
      ws.removeAllListeners("close");
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    ws.on("message", (data) => {
      const raw = data.toString();
      try {
        const event = JSON.parse(raw) as Record<string, unknown>;
        if (event.setupComplete !== undefined) {
          cleanup();
          resolve({ provider: "gemini", ok: true, detail: `Live setup completed for ${GEMINI_LIVE_MODEL}` });
          return;
        }
        if (event.error) {
          cleanup();
          resolve({ provider: "gemini", ok: false, detail: sanitizeError(JSON.stringify(event.error)) });
        }
      } catch {
        // Ignore non-JSON provider frames for this readiness check.
      }
    });

    ws.on("error", (err) => {
      cleanup();
      resolve({ provider: "gemini", ok: false, detail: sanitizeError(err) });
    });

    ws.on("close", (code, reason) => {
      cleanup();
      resolve({
        provider: "gemini",
        ok: false,
        detail: `Socket closed before setupComplete: ${code} ${sanitizeError(reason.toString())}`,
      });
    });
  });
}

async function checkGeminiLive(): Promise<CheckResult> {
  if (!readServerApiKey("gemini")) {
    return { provider: "gemini", ok: false, detail: `${requiredApiKeyEnv("gemini")} is missing` };
  }

  let url: string;
  try {
    url = buildGeminiLiveUrl("v1beta");
  } catch (err) {
    return { provider: "gemini", ok: false, detail: sanitizeError(err) };
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const connectTimeout = setTimeout(() => {
      ws.close();
      resolve({ provider: "gemini", ok: false, detail: "Timed out opening Live WebSocket" });
    }, TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(connectTimeout);
      const setup = buildGeminiLiveSetupMessage({
        modelId: GEMINI_LIVE_MODEL,
        instructions: "Voice provider readiness check. Reply only if audio is later provided.",
        tools: [],
        capabilityProfile: GEMINI_LIVE_MODEL.includes("3.1-flash-live") ? "preview_3_1" : "ga_2_5",
        voiceName: "Kore",
        thinkingLevel: "minimal",
        noiseMode: "standard",
      });
      ws.send(JSON.stringify(setup));
      waitForGeminiSetupComplete(ws).then(resolve);
    });

    ws.on("error", (err) => {
      clearTimeout(connectTimeout);
      resolve({ provider: "gemini", ok: false, detail: sanitizeError(err) });
    });
  });
}

const results = await Promise.all([checkOpenAiRealtime(), checkGeminiLive()]);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.provider}: ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exit(1);
}
