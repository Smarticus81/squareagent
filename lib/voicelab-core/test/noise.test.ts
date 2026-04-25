import { describe, it, expect } from "vitest";
import { getNoiseModeBehavior, listNoiseModeBehaviors } from "../src/noise/behaviors";

describe("noise mode behaviors", () => {
  it("provides a behavior for every noise mode", () => {
    const behaviors = listNoiseModeBehaviors();
    expect(behaviors.length).toBe(6);
  });

  it("disables wake word in nightclub mode", () => {
    const b = getNoiseModeBehavior("nightclub");
    expect(b.allowWakeWord).toBe(false);
    expect(b.pushToTalkRequired).toBe(true);
    expect(b.confirmationStrictness).toBe("very_high");
  });

  it("requires push-to-talk in manual mode", () => {
    const b = getNoiseModeBehavior("manual_push_to_talk");
    expect(b.pushToTalkRequired).toBe(true);
    expect(b.allowWakeWord).toBe(false);
  });

  it("allows wake word in quiet rooms with low confirmation friction", () => {
    const b = getNoiseModeBehavior("quiet_room");
    expect(b.allowWakeWord).toBe(true);
    expect(b.confirmationStrictness).toBe("low");
  });

  it("recommends short commands in noisy bar mode", () => {
    const b = getNoiseModeBehavior("bar");
    expect(b.grammarHint).toBe("short_command");
  });
});
