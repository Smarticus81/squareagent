import { describe, expect, it } from "vitest";
import { detectProductFindings, highestPriorityFinding } from "./product-diagnostics";
import type { BusinessSnapshot } from "./metrics";

function snapshot(overrides: Partial<BusinessSnapshot["product"]> = {}): BusinessSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    funnel: {
      visitors: 100,
      signups: 20,
      squareConnected: 10,
      activated: 8,
      paid: 3,
      visitorToSignup: 0.2,
      signupToConnect: 0.5,
      connectToActivation: 0.8,
      activationToPaid: 0.375,
    },
    product: {
      toolCalls: 100,
      toolFailures: 2,
      toolFailureRate: 0.02,
      averageToolLatencyMs: 500,
      voiceSessions: 50,
      sessionsWithNoSuccessfulTool: 2,
      noSuccessfulToolRate: 0.04,
      topFailingTools: [],
      ...overrides,
    },
    revenue: { mrrCents: 14900, paidOrganizations: 1, activeByPlan: { pro: 1 } },
    churnEvents: 0,
    supportOpened: 0,
    supportResolved: 0,
  };
}

describe("autonomous product diagnostics", () => {
  it("does not invent findings when product telemetry is healthy", () => {
    expect(detectProductFindings(snapshot())).toEqual([]);
  });

  it("flags repeatedly failing tools", () => {
    const findings = detectProductFindings(snapshot({
      topFailingTools: [{ tool: "submit_order", calls: 40, failures: 9, rate: 0.225 }],
    }));
    expect(findings[0]?.fingerprint).toBe("tool-failure:submit_order");
    expect(findings[0]?.severity).toBe("high");
  });

  it("flags slow tool execution and dead voice sessions", () => {
    const findings = detectProductFindings(snapshot({
      averageToolLatencyMs: 2400,
      noSuccessfulToolRate: 0.24,
      sessionsWithNoSuccessfulTool: 12,
    }));
    expect(findings.map((finding) => finding.fingerprint)).toContain("tool-latency:global");
    expect(findings.map((finding) => finding.fingerprint)).toContain("voice-session:no-successful-tool");
  });

  it("prioritizes critical findings above medium findings", () => {
    const findings = detectProductFindings(snapshot({
      averageToolLatencyMs: 2000,
      noSuccessfulToolRate: 0.4,
      sessionsWithNoSuccessfulTool: 20,
    }));
    expect(highestPriorityFinding(findings)?.severity).toBe("critical");
  });
});
