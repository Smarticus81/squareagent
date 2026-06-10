/**
 * Offline end-to-end smoke test for the Gemini Live WebSocket relay.
 *
 * Drives the real handleGeminiRelay() against a fake Gemini upstream
 * (via GEMINI_LIVE_ENDPOINT_OVERRIDE) and a real client WebSocket, and
 * asserts the full protocol translation:
 *
 *   1. The relay opens the upstream and sends a valid `setup` message.
 *   2. Nothing else is forwarded upstream until `setupComplete` arrives
 *      (regression check: early mic audio must be queued, not sent).
 *   3. After the ack, queued client audio arrives as 16 kHz realtimeInput.
 *   4. An upstream toolCall is executed server-side and answered with a
 *      toolResponse (search_menu against the catalog from x.context_update).
 *   5. Upstream serverContent (audio + transcriptions + turnComplete) is
 *      translated into Realtime-style events for the client.
 *
 * Requires no network and no real credentials.
 */

process.env.GOOGLE_GEMINI_API_KEY ||= "AIza-test-gemini-relay-smoke";

import assert from "node:assert/strict";
import WebSocket, { WebSocketServer } from "ws";
import { handleGeminiRelay, type RelayCtx } from "../src/routes/ws-relay";

const STARTUP_QUIET_MS = 300;
const STEP_TIMEOUT_MS = 10_000;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for: ${label}`)), STEP_TIMEOUT_MS),
    ),
  ]);
}

function listeningPort(server: WebSocketServer): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server has no port");
  return address.port;
}

async function main(): Promise<void> {
  // ── Fake Gemini upstream ──────────────────────────────────────────────────
  const upstreamServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => upstreamServer.once("listening", resolve));
  process.env.GEMINI_LIVE_ENDPOINT_OVERRIDE = `ws://127.0.0.1:${listeningPort(upstreamServer)}`;

  const setupReceived = deferred<Record<string, unknown>>();
  const audioReceived = deferred<Record<string, unknown>>();
  const toolResponseReceived = deferred<Record<string, unknown>>();
  let upstreamSocket: WebSocket | null = null;
  let earlyMessagesAfterSetup = 0;
  let setupCompleteSent = false;

  upstreamServer.on("connection", (ws) => {
    upstreamSocket = ws;
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      if (event.setup) {
        setupReceived.resolve(event.setup as Record<string, unknown>);
        return;
      }
      if (!setupCompleteSent) {
        // Anything else before the ack is the bug this test guards against.
        earlyMessagesAfterSetup += 1;
        return;
      }
      if (event.realtimeInput) {
        audioReceived.resolve(event.realtimeInput as Record<string, unknown>);
        return;
      }
      if (event.toolResponse) {
        toolResponseReceived.resolve(event.toolResponse as Record<string, unknown>);
        return;
      }
    });
  });

  // ── Relay under test, exposed on a local client-facing WS server ──────────
  const ctx: RelayCtx = {
    userId: 42,
    organizationId: "org_smoke",
    venueId: 7,
    agentProfileId: "profile_smoke",
    plan: "trial",
    allowedToolNames: null,
    includeGeneralTools: false,
    squareToken: "fake-square-token",
    squareLocationId: "fake-location",
    kind: "gemini",
    voicePipelineProvider: "google_gemini_2_5_flash_native_audio",
    profileDisplayName: "Bev",
    profilePersonality: "Friendly and quick.",
    geminiModelId: "gemini-2.5-flash-native-audio-preview-12-2025",
    noiseMode: "standard",
    query: { sessionId: "gemini-smoke-1", voice: "Aoede" },
  };

  const relayServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => relayServer.once("listening", resolve));
  relayServer.on("connection", (ws) => handleGeminiRelay(ws, ctx));

  // ── Test client (plays the PWA's role) ────────────────────────────────────
  const client = new WebSocket(`ws://127.0.0.1:${listeningPort(relayServer)}`);
  const sessionCreated = deferred<Record<string, unknown>>();
  const clientEvents: Record<string, unknown>[] = [];
  const audioDelta = deferred<Record<string, unknown>>();
  const transcriptDone = deferred<Record<string, unknown>>();
  const responseDone = deferred<Record<string, unknown>>();

  client.on("message", (data) => {
    const event = JSON.parse(data.toString()) as Record<string, unknown>;
    clientEvents.push(event);
    if (event.type === "session.created") sessionCreated.resolve(event);
    if (event.type === "response.audio.delta") audioDelta.resolve(event);
    if (event.type === "response.audio_transcript.done") transcriptDone.resolve(event);
    if (event.type === "response.done") responseDone.resolve(event);
  });

  // 16 kHz mono PCM16: 160 samples of a ramp, exactly what the PWA streams.
  const pcm = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) pcm.writeInt16LE((i - 80) * 100, i * 2);
  const pcmBase64 = pcm.toString("base64");

  await withTimeout(new Promise<void>((resolve) => client.once("open", () => resolve())), "client open");

  // Like the PWA: context update immediately on open.
  client.send(JSON.stringify({
    type: "x.context_update",
    catalog: [
      { id: "item_1", variationId: "var_1", name: "Margarita", price: 12, category: "Cocktails" },
      { id: "item_2", variationId: "var_2", name: "Old Fashioned", price: 14, category: "Cocktails" },
    ],
    order: [],
  }));

  // 1. Relay must send a well-formed setup first.
  const setup = await withTimeout(setupReceived.promise, "upstream setup message");

  // Send mic audio squarely inside the setup-sent-but-not-acked window,
  // where the pre-fix relay forwarded it upstream immediately.
  client.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: pcmBase64,
    sample_rate: 16000,
  }));
  assert.equal(setup.model, "models/gemini-2.5-flash-native-audio-preview-12-2025");
  const declarations = (setup.tools as Array<{ functionDeclarations: Array<{ name: string }> }>)[0].functionDeclarations;
  assert.ok(declarations.some((d) => d.name === "search_menu"), "setup tools include search_menu");
  assert.ok((setup.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text.includes("Bev"));
  assert.deepEqual(setup.inputAudioTranscription, {});
  console.log("PASS setup: model, tools, and instructions sent upstream");

  // 2. Nothing else may reach the upstream before setupComplete.
  await new Promise((resolve) => setTimeout(resolve, STARTUP_QUIET_MS));
  assert.equal(
    earlyMessagesAfterSetup,
    0,
    `relay forwarded ${earlyMessagesAfterSetup} message(s) upstream before setupComplete`,
  );
  console.log("PASS handshake: client audio held back until setupComplete");

  // 3. Ack the setup; queued audio must flush as 16 kHz realtimeInput.
  setupCompleteSent = true;
  upstreamSocket!.send(JSON.stringify({ setupComplete: {} }));

  await withTimeout(sessionCreated.promise, "session.created for client");
  const realtimeInput = await withTimeout(audioReceived.promise, "queued realtimeInput flush");
  const audio = realtimeInput.audio as { data: string; mimeType: string };
  assert.equal(audio.mimeType, "audio/pcm;rate=16000");
  assert.equal(audio.data, pcmBase64, "16 kHz input must pass through without resampling");
  console.log("PASS audio: queued mic audio flushed upstream at 16 kHz");

  // 4. Upstream tool call executes server-side against the relay catalog.
  upstreamSocket!.send(JSON.stringify({
    toolCall: {
      functionCalls: [{ id: "call_1", name: "search_menu", args: { query: "margarita" } }],
    },
  }));
  const toolResponse = await withTimeout(toolResponseReceived.promise, "toolResponse for search_menu");
  const responses = toolResponse.functionResponses as Array<{ id: string; name: string; response: { result?: string } }>;
  assert.equal(responses[0].id, "call_1");
  assert.equal(responses[0].name, "search_menu");
  assert.match(responses[0].response.result ?? "", /Margarita: \$12\.00/);
  console.log("PASS tools: search_menu executed server-side and answered upstream");

  // 5. Upstream server content translates to Realtime-style client events.
  upstreamSocket!.send(JSON.stringify({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: pcmBase64 } }] },
      outputTranscription: { text: "One margarita coming up." },
      turnComplete: true,
    },
  }));
  const delta = await withTimeout(audioDelta.promise, "response.audio.delta for client");
  assert.equal(delta.delta, pcmBase64);
  const transcript = await withTimeout(transcriptDone.promise, "response.audio_transcript.done for client");
  assert.equal(transcript.transcript, "One margarita coming up.");
  await withTimeout(responseDone.promise, "response.done for client");
  console.log("PASS downlink: serverContent translated to client audio/transcript/done events");

  client.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  upstreamServer.close();
  relayServer.close();
  console.log("PASS gemini relay end-to-end smoke");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
