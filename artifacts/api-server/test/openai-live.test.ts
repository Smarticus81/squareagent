import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveSessionPayload, createLiveWebRtcSession, validLiveSdp } from "../src/lib/openai-live";

afterEach(() => vi.unstubAllGlobals());
describe("GPT-Live session contract", () => {
  it("separates persona and business rules, preserving optional function parameters", () => {
    const config = buildLiveSessionPayload({
      instructions: "Require confirmation before refund_payment.", displayName: "Bev", personality: "Friendly bartender.",
      voice: "quartz", speed: 1.2, turnDetection: { type: "semantic_vad" },
      tools: [{ name: "refund_payment", description: "Refund", parameters: { type: "object", properties: { reason: { type: "string" } } } }, { name: "wait_for_user" }],
    });
    expect(config.model).toBe("gpt-live-1");
    expect(config.instructions).toContain("Bev");
    expect(config.instructions).not.toContain("refund_payment");
    expect(config.delegation.responses.instructions).toContain("Require confirmation before refund_payment");
    expect(config.delegation.responses.parallel_tool_calls).toBe(false);
    expect(config.delegation.responses.tools).toHaveLength(1);
    expect(config.delegation.responses.tools[0]).toMatchObject({ name: "refund_payment", strict: false });
    expect(config.audio).toEqual({ output: { voice: "quartz" } });
    expect(JSON.stringify(config)).not.toMatch(/turn_detection|output_modalities|transcription|"speed"/);
  });
  it("configures PCM only for WS and sanitizes migrated provider voices", () => {
    const config = buildLiveSessionPayload({ instructions: "Test", voice: "Kore", transport: "websocket" });
    expect(config.audio).toEqual({ format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } });
    expect(buildLiveSessionPayload({ instructions: "Test", voice: "voice_abc123" }).audio.output.voice).toEqual({ id: "voice_abc123" });
  });
  it("exchanges SDP through the server and returns no credentials", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ session: { id: "live-123" }, transport: { sdp: "answer" } }) });
    vi.stubGlobal("fetch", fetch);
    const config = buildLiveSessionPayload({ instructions: "Test" });
    const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
    expect(await createLiveWebRtcSession("test-key", config, sdp)).toEqual({ id: "live-123", model: "gpt-live-1", transport: { type: "webrtc", sdp: "answer" } });
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/live/sessions");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ session: config, transport: { type: "webrtc", sdp } });
    expect(validLiveSdp("not sdp")).toBe(false);
    expect(validLiveSdp("v=0" + "x".repeat(65536) + "m=audio")).toBe(false);
    await expect(createLiveWebRtcSession("test", config, "bad")).rejects.toThrow("SDP");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed provider success and sanitizes upstream failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetch);
    const config = buildLiveSessionPayload({ instructions: "Test" });
    await expect(createLiveWebRtcSession("test", config, "v=0\nm=audio")).rejects.toThrow("incomplete");
    await expect(createLiveWebRtcSession("test", config, "v=0\nm=audio")).rejects.toThrow("403");
  });
});
