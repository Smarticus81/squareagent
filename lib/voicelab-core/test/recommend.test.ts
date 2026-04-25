import { describe, it, expect } from "vitest";
import { recommendVoicePipeline } from "../src/voice-pipeline/recommend";

const baseInput = {
  deviceType: "desktop_browser" as const,
  environment: "restaurant" as const,
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

  it("recommends Flux+Cartesia when in a noisy bar with credentials", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      environment: "bar",
      availableCredentials: { DEEPGRAM_API_KEY: true, CARTESIA_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("deepgram_flux_cartesia");
  });

  it("recommends nightclub-appropriate pipeline with very-strict turn detection", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      environment: "nightclub",
      availableCredentials: { DEEPGRAM_API_KEY: true, CARTESIA_API_KEY: true },
    });
    expect(result.recommendedProvider).toBe("deepgram_flux_cartesia");
  });

  it("recommends LiveKit when enterprise observability is requested and creds are present", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      requiresEnterpriseObservability: true,
      availableCredentials: {
        LIVEKIT_URL: true,
        LIVEKIT_API_KEY: true,
        LIVEKIT_API_SECRET: true,
        OPENAI_API_KEY: true,
      },
    });
    expect(result.recommendedProvider).toBe("livekit_agents");
  });

  it("recommends ElevenLabs when best voice quality is requested", () => {
    const result = recommendVoicePipeline({
      ...baseInput,
      requiresBestVoiceQuality: true,
      availableCredentials: { ELEVENLABS_API_KEY: true, ELEVENLABS_AGENT_ID: true },
    });
    expect(result.recommendedProvider).toBe("elevenlabs_agents");
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
