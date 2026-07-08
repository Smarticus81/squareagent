import { describe, it, expect } from "vitest";
import {
  CONNECTED_SERVICE_PROVIDERS,
  listConnectedServiceProviders,
} from "../src/connected-service/registry";
import {
  VOICE_PIPELINE_PROVIDERS,
  listVoicePipelineProviders,
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
  it("lists all registered voice pipeline providers across all categories", () => {
    const list = listVoicePipelineProviders();
    expect(list.length).toBe(7);
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
