import WebSocket from "ws";
import { readServerApiKey, requiredApiKeyEnv } from "../src/lib/api-keys";
import { OPENAI_LIVE_MODEL, OPENAI_LIVE_WS_URL, buildLiveSessionPayload } from "../src/lib/openai-live";
import {
  buildGeminiLiveSetupMessage,
  buildGeminiLiveUrl,
} from "../src/voice-pipelines/google/gemini-live";

const TIMEOUT_MS = Number(process.env.VOICE_PROVIDER_CHECK_TIMEOUT_MS ?? 15000);
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

  return new Promise(resolve => {
    const ws = new WebSocket(OPENAI_LIVE_WS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    let started = false;
    let settled = false;
    const done = (ok: boolean, detail: string) => {
      if (settled) return; settled = true; clearTimeout(timer); ws.terminate();
      resolve({ provider: "openai", ok, detail });
    };
    const timer = setTimeout(() => done(false, "Live startup/finalization timed out"), TIMEOUT_MS);
    ws.on("open", () => ws.send(JSON.stringify({ type: "session.start", session: buildLiveSessionPayload({ instructions: "Readiness check. Stay silent.", transport: "websocket" }) })));
    ws.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.started") { started = true; ws.send(JSON.stringify({ type: "session.close" })); }
      if (event.type === "session.closed") done(started, `${OPENAI_LIVE_MODEL} started and finalized`);
      if (event.type === "error") done(false, sanitizeError(event.error?.code ?? "Live error"));
    });
    ws.on("error", error => done(false, sanitizeError(error)));
    ws.on("close", () => done(false, "Live closed before finalization"));
  });
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

const results = await Promise.all([checkOpenAiRealtime()]);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.provider}: ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exit(1);
}
