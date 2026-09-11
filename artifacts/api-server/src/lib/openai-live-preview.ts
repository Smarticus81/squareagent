import WebSocket from "ws";
import { requireServerApiKey } from "./api-keys";
import { buildLiveSessionPayload, OPENAI_LIVE_WS_URL } from "./openai-live";

/** Capture a short preview using the same voice model as a real conversation.
 * Live has no audio-done event: stop after an observed silence tail, then wait
 * for session.closed. This is a preview, not an exact-wording TTS contract.
 */
export async function renderLivePreview(voice: string, text: string): Promise<{ pcm: Buffer; seconds: number }> {
  const apiKey = requireServerApiKey("openai").value;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(OPENAI_LIVE_WS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    const chunks: Buffer[] = [];
    let heardSpeech = false;
    let closing = false;
    let settled = false;
    let silenceSamples = 0;
    let inputTimer: ReturnType<typeof setInterval> | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => fail(new Error("GPT-Live preview timed out")), 20000);
    const clean = () => { clearTimeout(timeout); clearTimeout(quietTimer); clearInterval(inputTimer); if (ws.readyState === WebSocket.OPEN) ws.close(); };
    const fail = (error: Error) => { if (settled) return; settled = true; clean(); ws.terminate(); reject(error); };
    const close = () => { if (closing || ws.readyState !== WebSocket.OPEN) return; closing = true; clearInterval(inputTimer); ws.send(JSON.stringify({ type: "session.close" })); };
    ws.on("open", () => {
      const config = buildLiveSessionPayload({ instructions: "Voice preview.", voice, transport: "websocket" });
      ws.send(JSON.stringify({ type: "session.start", session: {
        model: config.model, audio: config.audio, delegation: { type: "client" },
        instructions: "You are recording a short voice preview. Speak warmly and naturally. Do not delegate. After the requested line, remain silent.",
      } }));
    });
    ws.on("message", raw => {
      let event: Record<string, any>;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === "error") { fail(new Error(`GPT-Live preview failed: ${String(event.error?.code ?? "provider_error")}`)); return; }
      if (event.type === "session.started") {
        ws.send(JSON.stringify({ type: "session.instructions.append", delegation_id: null, content: `Say this short preview line once, then remain silent: ${text}` }));
        inputTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && !closing) ws.send(JSON.stringify({ type: "session.input_audio.append", audio: Buffer.alloc(4800).toString("base64") }));
        }, 100);
      }
      if (event.type === "session.output_audio.delta" && !closing) {
        const pcm = Buffer.from(event.delta, "base64");
        if (pcm.length % 2 !== 0) { fail(new Error("Invalid Live PCM frame")); return; }
        chunks.push(pcm);
        let energy = 0;
        for (let i = 0; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
        if (Math.sqrt(energy / Math.max(1, pcm.length / 2)) > 0.008) { heardSpeech = true; silenceSamples = 0; }
        else silenceSamples += pcm.length / 2;
        clearTimeout(quietTimer);
        if (heardSpeech) quietTimer = setTimeout(close, 1500);
        if (heardSpeech && silenceSamples >= 24000) close();
        if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > 24000 * 2 * 12) close();
      }
      if (event.type === "session.closed") {
        if (!heardSpeech) { fail(new Error("GPT-Live returned no audible preview")); return; }
        settled = true; clean();
        resolve({ pcm: Buffer.concat(chunks), seconds: Number(event.usage?.seconds ?? 0) });
      }
    });
    ws.on("error", () => fail(new Error("GPT-Live preview connection failed")));
    ws.on("close", () => { if (!settled) fail(new Error("GPT-Live preview closed without final usage")); });
  });
}
