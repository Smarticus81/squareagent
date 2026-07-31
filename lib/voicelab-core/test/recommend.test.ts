import { describe, it, expect } from "vitest";
import { recommendVoicePipeline } from "../src/voice-pipeline/recommend";

const baseInput = {
  deviceType: "desktop_browser" as const,
  environment: "standard" as const,
  connectedServiceProvider: "square" as const,
  requiresToolCalling: true,
  requiresBestVoiceQuality: false,
  requiresLowestLatency: true,
  requiresEnterpriseObservability: false,
  availableCredentials: { OPENAI_API_KEY: true },
};

describe("recommendVoicePipeline", () => {
  it("recommends OpenAI WebRTC for browser low-latency", () => {
    const result = recommendVoicePipeline(baseInput);
    expect(result.recommendedProvider).toBe("openai_realtime_webrtc");
    expect(result.fallbackProviders).toContain("push_to_talk_text_fallback");
  });

  it("falls back to push-to-talk when no credentials are available", () => {
    const result = recommendVoicePipeline({ ...baseInput, availableCredentials: {} });
    expect(result.recommendedProvider).toBe("push_to_talk_text_fallback");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("recommends Gemini 3.1 Flash Live in a loud venue with Gemini credentials", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      environment: "loud",
      availableCredentials: { GOOGLE_GEMINI_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("google_gemini_3_1_flash_live");
  });

  it("recommends noise-appropriate pipeline for push_to_talk", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      environment: "push_to_talk",
      availableCredentials: { GOOGLE_GEMINI_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("google_gemini_3_1_flash_live");
  });

  it("recommends OpenAI server WS when enterprise observability is requested", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      requiresEnterpriseObservability: true,
      availableCredentials: { OPENAI_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("openai_realtime_server_ws");
  });

  it("recommends Gemini 2.5 when best voice quality is requested with Gemini credentials", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      requiresBestVoiceQuality: true,
      availableCredentials: { GOOGLE_GEMINI_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("google_gemini_2_5_flash_native_audio");
  });

  it("recommends server WS for iOS native", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      deviceType: "ios_native",
      availableCredentials: { OPENAI_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("openai_realtime_server_ws");
  });

  it("warns when fallback can't do realtime tool calling", () => {
    const result = recommendVoicePipeline({ ...baseInput, availableCredentials: {} });
    expect(
      result.warnings.some((w) => w.toLowerCase().includes("tool calling")),
    ).toBe(true);
  });
});
