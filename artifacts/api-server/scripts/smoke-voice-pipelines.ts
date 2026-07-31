import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAiRealtimeServerWsAdapter } from "../src/voice-pipelines/openai/realtime-server-ws";
import {
  buildGeminiLiveSetupMessage,
  GEMINI_LIVE_ADAPTER_SPECS,
  GoogleGeminiLiveAdapter,
  toolDefinitionsToGeminiTools,
} from "../src/voice-pipelines/google/gemini-live";
import { getVoicePipelineAdapter } from "../src/voice-pipelines";
import type { VoicePipelineSessionContext } from "@workspace/voicelab-core/voice-pipeline";

process.env.OPENAI_API_KEY ||= "sk-test-voice-pipeline-smoke";
process.env.GOOGLE_GEMINI_API_KEY ||= "AIza-test-voice-pipeline-smoke";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const baseContext: VoicePipelineSessionContext = {
  connectionId: "conn_test",
  agentProfileId: "agent_test",
  agentDisplayName: "Bev",
  userId: "42",
  allowedToolNames: ["search_menu"],
  providerOptions: {
    voice: "Kore",
    speed: 1,
    tools: [
      {
        name: "search_menu",
        description: "Search the menu.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search text." },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
    ],
    noiseMode: "loud",
    proactiveAudio: true,
    affectiveDialog: true,
    thinkingLevel: "minimal",
    languageCodes: ["en-US"],
  },
  instructions: "You are Bev. Keep replies short and execute allowed commands.",
};

async function main(): Promise<void> {
  assert.deepEqual(
    GEMINI_LIVE_ADAPTER_SPECS.map((spec) => spec.provider),
    ["google_gemini_3_1_flash_live", "google_gemini_2_5_flash_native_audio"],
  );

  const openAiRelay = new OpenAiRealtimeServerWsAdapter();
  assert.equal(openAiRelay.supportsBrowser, true);
  const openAiSession = await openAiRelay.createSession(baseContext);
  assert.equal(openAiSession.clientHandshake?.kind, "ws_relay");
  assert.equal(openAiSession.clientHandshake?.payload.path, "/api/realtime");
  assert.deepEqual(openAiSession.clientHandshake?.payload.query, {
    sessionId: openAiSession.sessionId,
    agentProfileId: "agent_test",
  });

  const gemini31 = new GoogleGeminiLiveAdapter(GEMINI_LIVE_ADAPTER_SPECS[0]);
  const geminiSession = await gemini31.createSession(baseContext);
  assert.equal(geminiSession.clientHandshake?.kind, "ws_relay");
  assert.equal(geminiSession.clientHandshake?.payload.path, "/api/realtime/gemini");
  assert.equal((geminiSession.clientHandshake?.payload.query as Record<string, unknown>).modelId, "gemini-3.1-flash-live-preview");
  assert.equal((geminiSession.clientHandshake?.payload.query as Record<string, unknown>).thinkingLevel, "minimal");
  assert.equal((geminiSession.clientHandshake?.payload.query as Record<string, unknown>).languageCodes, "en-US");

  const setup31 = buildGeminiLiveSetupMessage({
    modelId: "gemini-3.1-flash-live-preview",
    instructions: baseContext.instructions,
    tools: baseContext.providerOptions.tools as Array<{
      name: string;
      description?: string;
      parameters?: unknown;
    }>,
    capabilityProfile: "preview_3_1",
    inputLanguageCodes: ["en-US"],
    thinkingLevel: "minimal",
    voiceName: "Kore",
    noiseMode: "loud",
  });
  const setupPayload = setup31.setup as Record<string, unknown>;
  assert.equal(setupPayload.model, "models/gemini-3.1-flash-live-preview");
  assert.deepEqual((setupPayload.generationConfig as Record<string, unknown>).responseModalities, ["AUDIO"]);
  assert.equal(
    (((setupPayload.generationConfig as Record<string, unknown>).speechConfig as Record<string, unknown>)
      .voiceConfig as Record<string, unknown>).prebuiltVoiceConfig instanceof Object,
    true,
  );
  assert.equal((setupPayload.realtimeInputConfig as Record<string, unknown>).activityHandling, "START_OF_ACTIVITY_INTERRUPTS");
  assert.deepEqual(setupPayload.inputAudioTranscription, {});
  assert.equal(Array.isArray(setupPayload.tools), true);

  const setup25 = buildGeminiLiveSetupMessage({
    modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
    instructions: baseContext.instructions,
    tools: [],
    capabilityProfile: "ga_2_5",
    proactiveAudio: true,
    affectiveDialog: true,
    voiceName: "Aoede",
  }).setup as Record<string, unknown>;
  assert.deepEqual(setup25.proactivity, { proactiveAudio: true });
  assert.equal(setup25.enableAffectiveDialog, true);

  const geminiTools = toolDefinitionsToGeminiTools([
    {
      name: "search_menu",
      description: "Search menu",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  ]);
  assert.equal(geminiTools[0].functionDeclarations[0].parameters.type, "OBJECT");
  assert.equal(
    ((geminiTools[0].functionDeclarations[0].parameters.properties as Record<string, unknown>).query as Record<string, unknown>).type,
    "STRING",
  );

  assert.equal(getVoicePipelineAdapter("openai_realtime_server_ws").supportsBrowser, true);
  assert.equal(getVoicePipelineAdapter("google_gemini_3_1_flash_live").requiresServerRelay, true);
  assert.equal(getVoicePipelineAdapter("google_gemini_2_5_flash_native_audio").requiresServerRelay, true);

  const pwaVoiceContext = readFileSync(
    resolve(repoRoot, "artifacts/voice-agent-pwa/src/contexts/VoiceAgentContext.tsx"),
    "utf8",
  );
  assert.match(pwaVoiceContext, /OPENAI_SERVER_WS_PROVIDER\s*=\s*"openai_realtime_server_ws"/);
  assert.match(pwaVoiceContext, /GEMINI_INPUT_SAMPLE_RATE\s*=\s*16000/);
  assert.match(pwaVoiceContext, /OPENAI_RELAY_INPUT_SAMPLE_RATE\s*=\s*24000/);
  assert.match(
    pwaVoiceContext,
    /voicePipelineProviderRef\.current\.startsWith\(GEMINI_PROVIDER_PREFIX\)\s*\|\|\s*voicePipelineProviderRef\.current\s*===\s*OPENAI_SERVER_WS_PROVIDER/,
  );
  assert.match(
    pwaVoiceContext,
    /startWsMicStreaming\(ws,\s*isGemini\s*\?\s*GEMINI_INPUT_SAMPLE_RATE\s*:\s*OPENAI_RELAY_INPUT_SAMPLE_RATE\)/,
  );

  const assistantWizard = readFileSync(
    resolve(repoRoot, "artifacts/voycelab-landing/src/pages/create-assistant.tsx"),
    "utf8",
  );
  assert.match(assistantWizard, /id:\s*"openai_realtime_server_ws"/);
  assert.match(assistantWizard, /id:\s*"google_gemini_3_1_flash_live"/);
  assert.match(assistantWizard, /id:\s*"google_gemini_2_5_flash_native_audio"/);
  assert.equal(assistantWizard.includes(["google", "gemini", "live", "native", "audio"].join("_")), false);
  assert.match(assistantWizard, /provider === "openai_realtime_server_ws"/);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
