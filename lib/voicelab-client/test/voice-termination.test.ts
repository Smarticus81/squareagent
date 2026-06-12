import { describe, expect, it } from "vitest";
import {
  matchTermination,
  matchWakeWord,
  normalizeVoiceUtterance,
  phraseInText,
} from "../src/voice-termination";

describe("normalizeVoiceUtterance", () => {
  it("lowercases and normalizes smart quotes", () => {
    expect(normalizeVoiceUtterance("  That’s ALL  ")).toBe("that's all");
  });
});

describe("matchWakeWord", () => {
  const words = ["hey voyce", "hey bev", "voycelab"];

  it("matches the configured phrase at a word boundary", () => {
    expect(matchWakeWord("hey voyce what sold today", words)).toBe("hey voyce");
    expect(matchWakeWord("okay so... hey bev", words)).toBe("hey bev");
    expect(matchWakeWord("VOYCELAB", words)).toBe("voycelab");
  });

  it("does not fire on words that merely contain the phrase", () => {
    // "bev" inside "beverage" must not wake when the phrase is "hey bev".
    expect(matchWakeWord("pour me a beverage", words)).toBeNull();
    expect(matchWakeWord("heyvoyce no boundary", words)).toBeNull();
    expect(matchWakeWord("the voycelabs report", words)).toBeNull();
  });

  it("tolerates punctuation around the phrase", () => {
    expect(matchWakeWord("hey voyce, two ranch waters", words)).toBe("hey voyce");
    expect(matchWakeWord("“hey bev!”", words)).toBe("hey bev");
  });

  it("returns null for empty input or empty word list", () => {
    expect(matchWakeWord("", words)).toBeNull();
    expect(matchWakeWord("hey voyce", [])).toBeNull();
    expect(matchWakeWord("hey voyce", ["", "  "])).toBeNull();
  });
});

describe("matchTermination", () => {
  it("detects hard shutdown phrases anywhere in the utterance", () => {
    expect(matchTermination("please shut down now")).toBe("hard");
    expect(matchTermination("STOP LISTENING")).toBe("hard");
    expect(matchTermination("can you stop the mic")).toBe("hard");
  });

  it("detects soft phrases in final transcripts anywhere", () => {
    expect(matchTermination("ok that's all for now thanks")).toBe("soft");
    expect(matchTermination("goodbye")).toBe("soft");
  });

  it("requires soft phrases at the end for partial transcripts", () => {
    // Mid-sentence speech must not end the session while still interim.
    expect(matchTermination("we're done with the apps, now add two beers", { partial: true })).toBeNull();
    expect(matchTermination("alright we're done", { partial: true })).toBe("soft");
  });

  it("hard phrases still match anywhere in partial transcripts", () => {
    expect(matchTermination("shut down and then maybe later", { partial: true })).toBe("hard");
  });

  it("does not fire on prefix words without a boundary", () => {
    expect(matchTermination("the shutdowns were rough")).toBeNull();
    expect(matchTermination("goodbyes are hard")).toBeNull();
  });

  it("treats a standalone 'stop' as soft termination", () => {
    expect(matchTermination("stop")).toBe("soft");
    expect(matchTermination("Stop.")).toBe("soft");
    expect(matchTermination("ok stop")).toBe("soft");
    expect(matchTermination("okay stop please")).toBe("soft");
    expect(matchTermination("stop now")).toBe("soft");
    expect(matchTermination("alright stop, thanks")).toBe("soft");
  });

  it("does not treat 'stop' inside a command as termination", () => {
    expect(matchTermination("stop adding that beer")).toBeNull();
    expect(matchTermination("don't stop the order")).toBeNull();
    expect(matchTermination("add two non-stop IPAs")).toBeNull();
  });

  it("matches standalone 'stop' on partial transcripts too", () => {
    expect(matchTermination("stop", { partial: true })).toBe("soft");
    expect(matchTermination("stop adding that", { partial: true })).toBeNull();
  });

  it("still treats 'stop listening' as hard shutdown, not soft", () => {
    expect(matchTermination("stop listening")).toBe("hard");
  });
});

describe("phraseInText", () => {
  it("anchors at end when requested", () => {
    expect(phraseInText("we are finished", "we are finished", { atEnd: true })).toBe(true);
    expect(phraseInText("we are finished but wait", "we are finished", { atEnd: true })).toBe(false);
    expect(phraseInText("we are finished!", "we are finished", { atEnd: true })).toBe(true);
  });
});
