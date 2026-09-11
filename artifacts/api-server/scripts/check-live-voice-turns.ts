import WebSocket from "ws";
import { readServerApiKey, requiredApiKeyEnv } from "../src/lib/api-keys";
import { renderLivePreview } from "../src/lib/openai-live-preview";
import {
  buildGeminiLiveSetupMessage,
  buildGeminiLiveUrl,
} from "../src/voice-pipelines/google/gemini-live";

const TIMEOUT_MS = Number(process.env.VOICE_PROVIDER_TURN_TIMEOUT_MS ?? 30000);
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_CHECK_MODEL ?? "gemini-3.1-flash-live-preview";

interface TurnResult {
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
    .slice(0, 700);
}

function closeSocket(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}

async function checkOpenAiAudioTurn(): Promise<TurnResult> {
  const apiKey = readServerApiKey("openai")?.value;
  if (!apiKey) {
    return { provider: "openai", ok: false, detail: `${requiredApiKeyEnv("openai")} is missing` };
  }

  try {
    const result = await renderLivePreview("marin", "Ready when you are.");
    return { provider: "openai", ok: result.pcm.length > 0, detail: `gpt-live-1 produced ${result.pcm.length} PCM bytes; finalized ${result.seconds} seconds` };
  } catch (error) {
    return { provider: "openai", ok: false, detail: sanitizeError(error) };
  }
}

async function checkGeminiAudioTurn(): Promise<TurnResult> {
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
    let setupComplete = false;
    let promptSent = false;
    let audioBytes = 0;
    let transcript = "";

    const timeout = setTimeout(() => {
      cleanup();
      resolve({
        provider: "gemini",
        ok: false,
        detail: setupComplete ? "Timed out waiting for audio inlineData" : "Timed out waiting for setupComplete",
      });
    }, TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      ws.removeAllListeners();
      closeSocket(ws);
    }

    function sendPrompt(): void {
      if (promptSent || ws.readyState !== WebSocket.OPEN) return;
      promptSent = true;
      ws.send(JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: "Say exactly: ready." }],
            },
          ],
          turnComplete: true,
        },
      }));
    }

    ws.on("open", () => {
      const setup = buildGeminiLiveSetupMessage({
        modelId: GEMINI_LIVE_MODEL,
        instructions: "Live audio-turn verification. Reply with one short spoken word.",
        tools: [],
        capabilityProfile: GEMINI_LIVE_MODEL.includes("3.1-flash-live") ? "preview_3_1" : "ga_2_5",
        voiceName: "Kore",
        thinkingLevel: "minimal",
        noiseMode: "standard",
      });
      ws.send(JSON.stringify(setup));
    });

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.error) {
          cleanup();
          resolve({ provider: "gemini", ok: false, detail: sanitizeError(JSON.stringify(event.error)) });
          return;
        }
        if (event.setupComplete !== undefined) {
          setupComplete = true;
          sendPrompt();
          return;
        }

        const serverContent = event.serverContent as Record<string, unknown> | undefined;
        const outputTranscription = serverContent?.outputTranscription as Record<string, unknown> | undefined;
        if (typeof outputTranscription?.text === "string") {
          transcript += outputTranscription.text;
        }
        const modelTurn = serverContent?.modelTurn as Record<string, unknown> | undefined;
        const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
        for (const part of parts) {
          if (!part || typeof part !== "object") continue;
          const inlineData = (part as Record<string, unknown>).inlineData as Record<string, unknown> | undefined;
          if (typeof inlineData?.data === "string") {
            audioBytes += Buffer.byteLength(inlineData.data, "base64");
          }
        }

        if ((serverContent?.generationComplete || serverContent?.turnComplete) && audioBytes > 0) {
          cleanup();
          resolve({
            provider: "gemini",
            ok: true,
            detail: `Audio turn completed on ${GEMINI_LIVE_MODEL} (${audioBytes} decoded bytes${transcript ? `, transcript: ${transcript.trim()}` : ""})`,
          });
        }
      } catch {
        // Ignore non-JSON provider frames.
      }
    });

    ws.on("error", (err) => {
      cleanup();
      resolve({ provider: "gemini", ok: false, detail: sanitizeError(err) });
    });

    ws.on("close", (code, reason) => {
      if (audioBytes > 0) {
        cleanup();
        resolve({
          provider: "gemini",
          ok: true,
          detail: `Audio turn produced ${audioBytes} decoded bytes before close ${code}`,
        });
        return;
      }
      cleanup();
      resolve({
        provider: "gemini",
        ok: false,
        detail: `Socket closed before audio: ${code} ${sanitizeError(reason.toString())}`,
      });
    });
  });
}

const results = await Promise.all([checkOpenAiAudioTurn()]);
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.provider}: ${result.detail}`);
}

if (results.some((result) => !result.ok)) {
  process.exit(1);
}
