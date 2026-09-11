import { describe, expect, it } from "vitest";
import { LiveProtocol, LiveCaptions, type VoiceEvent } from "../src/live-protocol";

function harness() {
  const sent: VoiceEvent[] = [];
  const protocol = new LiveProtocol(event => sent.push(event));
  const receive = (event: VoiceEvent) => protocol.receive({ type: "response.event", delegation_id: "delegation-1", event });
  const call = (id: string) => receive({ type: "response.output_item.done", item: { type: "function_call", name: "add_item", call_id: id, arguments: '{"item":"Margarita"}' } });
  const result = (id: string) => protocol.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: id, output: '{"ok":true}' } });
  receive({ type: "response.created", response: { id: "response-1", output: [] } });
  return { sent, protocol, receive, call, result };
}

describe("Live delegated command lifecycle", () => {
  it("collects named calls from output items despite empty terminal snapshots; continues only after all results", () => {
    const h = harness();
    expect(h.call("a")).toEqual([]);
    h.call("b");
    const commands = h.receive({ type: "response.completed", response: { id: "response-1", output: [] } });
    expect(commands.map(command => command.call_id)).toEqual(["a", "b"]);
    expect(commands[0]).toMatchObject({ name: "add_item", response_id: "response-1", delegation_id: "delegation-1" });
    h.result("b");
    h.protocol.send({ type: "response.create" });
    expect(h.sent.map(event => event.type)).toEqual(["response.item.create"]);
    h.result("a");
    h.result("a");
    expect(h.sent.map(event => event.type)).toEqual(["response.item.create", "response.item.create", "response.create"]);
  });
  it("holds the call through confirmation and ignores duplicate completion events", () => {
    const h = harness(); h.call("a"); h.call("a");
    expect(h.receive({ type: "response.completed", response: { id: "response-1", output: [] } })).toHaveLength(1);
    expect(h.receive({ type: "response.completed", response: { id: "response-1", output: [] } })).toHaveLength(0);
    h.protocol.send({ type: "session.commentary.append", delegation_id: null, content: "Please confirm." });
    expect(h.sent.some(event => event.type === "response.create")).toBe(false);
    h.result("a");
    expect(h.sent.at(-1)).toEqual({ type: "response.create" });
  });
  it("does not treat backend text or completion as speech completion", () => {
    const h = harness();
    expect(h.receive({ type: "response.output_text.delta", delta: "Internal task result" })).toEqual([]);
    expect(h.receive({ type: "response.completed", response: { id: "response-1", output: [] } })).toEqual([]);
    expect(h.protocol.receive({ type: "session.output_audio.delta", delta: "pcm" })).toEqual([{ type: "response.audio.delta", delta: "pcm" }]);
  });
  it("never executes arguments-only events or unwrapped Responses events", () => {
    const h = harness();
    expect(h.receive({ type: "response.function_call_arguments.done", arguments: "{}" })).toEqual([]);
    expect(h.protocol.receive({ type: "response.output_item.done", item: { type: "function_call" } })).toEqual([]);
  });
  it("rejects late results after failure or session close", () => {
    const h = harness(); h.call("a");
    h.receive({ type: "response.failed", response: { id: "response-1", error: { message: "Failed" } } });
    h.result("a"); expect(h.sent).toEqual([]);
    h.protocol.receive({ type: "session.closed", usage: { seconds: 2 } });
    h.protocol.send({ type: "response.create", response: { instructions: "Hello" } });
    expect(h.sent).toEqual([]);
  });
  it("maps speech instructions and audio without Realtime-only fields", () => {
    const h = harness();
    h.protocol.send({ type: "response.create", response: { instructions: "Greet briefly" } });
    h.protocol.send({ type: "input_audio_buffer.append", audio: "pcm", sample_rate: 48000 });
    h.protocol.send({ type: "input_audio_buffer.commit" });
    expect(h.sent).toEqual([
      { type: "session.instructions.append", delegation_id: null, content: "Greet briefly" },
      { type: "session.input_audio.append", audio: "pcm" },
    ]);
  });
});

describe("Live captions", () => {
  it("accumulates both speakers independently, preserving exact delta whitespace", () => {
    const captions = new LiveCaptions();
    const first = captions.append({ type: "session.input_transcript.delta", delta: "Two", start_ms: 0, end_ms: 300 });
    const assistant = captions.append({ type: "session.output_transcript.delta", delta: "Mm-hmm.", start_ms: 100, end_ms: 350 });
    const next = captions.append({ type: "session.input_transcript.delta", delta: " margaritas.", start_ms: 300, end_ms: 900 });
    expect(next).toEqual({ id: first!.id, role: "user", text: "Two margaritas." });
    expect(assistant?.text).toBe("Mm-hmm.");
    const later = captions.append({ type: "session.input_transcript.delta", delta: "Actually three.", start_ms: 3000, end_ms: 3400 });
    expect(later?.id).not.toBe(first?.id);
  });
});
