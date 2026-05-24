import { describe, it, expect } from "vitest";
import {
  CONNECTED_SERVICE_PROVIDERS,
  listConnectedServiceProviders,
} from "../src/connected-service/registry";
import {
  VOICE_PIPELINE_PROVIDERS,
  listVoicePipelineProviders,
  listVoicePipelineProvidersByCategory,
} from "../src/voice-pipeline/registry";
import { defaultWakePhraseFor } from "../src/agent-profile/types";

describe("connected-service registry", () => {
  it("lists every documented provider", () => {
    const list = listConnectedServiceProviders();
    const ids = list.map((p) => p.provider);
    for (const expected of [
      "square",
      "toast",
      "clover",
      "lightspeed",
      "shopify_pos",
      "gopayments_poynt",
      "revel",
      "generic_rest",
      "webhook",
      "mock",
    ] as const) {
      expect(ids).toContain(expected);
    }
  });

  it("marks Square as available and Toast as request_access", () => {
    expect(CONNECTED_SERVICE_PROVIDERS.square.status).toBe("available");
    expect(CONNECTED_SERVICE_PROVIDERS.toast.status).toBe("request_access");
  });
});

describe("voice-pipeline registry", () => {
  it("lists 8 voice pipeline providers across all categories", () => {
    const list = listVoicePipelineProviders();
    expect(list.length).toBe(8);
  });

  it("filters by category", () => {
    const native = listVoicePipelineProvidersByCategory("native_realtime_speech_to_speech");
    expect(native.map((p) => p.provider)).toEqual(
      expect.arrayContaining([
        "openai_realtime_webrtc",
        "openai_realtime_server_ws",
        "google_gemini_3_1_flash_live",
        "google_gemini_2_5_flash_native_audio",
        "google_gemini_live_native_audio",
      ]),
    );
  });

  it("marks fallbacks correctly", () => {
    expect(VOICE_PIPELINE_PROVIDERS.push_to_talk_text_fallback.isFallback).toBe(true);
    expect(VOICE_PIPELINE_PROVIDERS.openai_realtime_webrtc.isFallback).toBeFalsy();
  });
});

describe("agent profile defaults", () => {
  it("derives a wake phrase from a custom display name", () => {
    expect(defaultWakePhraseFor("Aurora")).toBe("Hey Aurora");
    expect(defaultWakePhraseFor("Bev")).toBe("Hey Bev");
  });

  it("falls back when display name is empty", () => {
    expect(defaultWakePhraseFor("")).toBe("Hey assistant");
  });
});
