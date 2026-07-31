import { describe, it, expect } from "vitest";
import { getNoiseModeBehavior, listNoiseModeBehaviors } from "../src/noise/behaviors";

describe("noise mode behaviors", () => {
  it("provides a behavior for every noise mode", () => {
    const behaviors = listNoiseModeBehaviors();
    expect(behaviors.length).toBe(3);
  });

  it("disables wake word in push_to_talk mode", () => {
    const b = getNoiseModeBehavior("push_to_talk");
    expect(b.allowWakeWord).toBe(false);
    expect(b.pushToTalkRequired).toBe(true);
    expect(b.confirmationStrictness).toBe("low");
  });

  it("allows wake word in standard mode with medium confirmation friction", () => {
    const b = getNoiseModeBehavior("standard");
    expect(b.allowWakeWord).toBe(true);
    expect(b.confirmationStrictness).toBe("medium");
  });

  it("recommends short commands in loud mode", () => {
    const b = getNoiseModeBehavior("loud");
    expect(b.grammarHint).toBe("short_command");
  });
});
