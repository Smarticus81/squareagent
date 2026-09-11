/** GPT-Live wire protocol shared by the browser clients and server relay.
 * The UI's legacy event names are internal only; they never reach OpenAI.
 * https://developers.openai.com/api/docs/guides/live-delegation
 */
export type VoiceEvent = Record<string, any>;

export class LiveProtocol {
  private batches = new Map<string, { delegationId: string; calls: Map<string, VoiceEvent>; completed: boolean; continued: boolean }>();
  private seenCalls = new Set<string>();
  private pendingCalls = new Map<string, string>();
  private responseIds = new Map<string, string>();
  private closed = false;

  constructor(private write: (event: VoiceEvent) => void) {}

  receive(envelope: VoiceEvent): VoiceEvent[] {
    if (this.closed) return [];
    if (envelope.type === "session.closed") {
      this.closed = true;
      this.batches.clear();
      this.pendingCalls.clear();
      this.responseIds.clear();
    }
    if (envelope.type === "session.started") return [{ ...envelope, type: "session.created" }];
    if (envelope.type === "session.output_audio.delta") return [{ ...envelope, type: "response.audio.delta" }];
    if (envelope.type !== "response.event") return String(envelope.type).startsWith("response.") ? [] : [envelope];
    const event = envelope.event;
    if (!event || typeof event.type !== "string") return [];
    const delegationId = String(envelope.delegation_id ?? "");
    if (event.type === "response.created") {
      const id = String(event.response?.id ?? "");
      if (id) {
        this.responseIds.set(delegationId, id);
        if (!this.batches.has(id)) this.batches.set(id, { delegationId, calls: new Map(), completed: false, continued: false });
      }
    }
    const id = String(event.response_id ?? event.response?.id ?? this.responseIds.get(delegationId) ?? "");
    const batch = this.batches.get(id);
    if (event.type === "response.output_item.done" && event.item?.type === "function_call" && batch) {
      const item = event.item;
      if (item.call_id && item.name && !this.seenCalls.has(item.call_id)) {
        this.seenCalls.add(item.call_id);
        batch.calls.set(item.call_id, item);
        this.pendingCalls.set(item.call_id, id);
      }
    }
    if (event.type === "response.completed" && batch && !batch.completed) {
      batch.completed = true;
      this.responseIds.delete(delegationId);
      if (batch.calls.size === 0) this.batches.delete(id);
      // Terminal snapshots have output: []; use the items collected above.
      return [...batch.calls.values()].map(item => ({
        ...item, type: "response.function_call_arguments.done", delegation_id: batch.delegationId, response_id: id,
      }));
    }
    if (event.type === "response.failed" || event.type === "response.incomplete") {
      if (batch) for (const callId of batch.calls.keys()) this.pendingCalls.delete(callId);
      this.batches.delete(id);
      this.responseIds.delete(delegationId);
      return [{ type: "error", error: { message: event.response?.error?.message ?? "The assistant could not finish that request. Please try again." } }];
    }
    // Backend text/completion is not speech or proof of playback.
    return [];
  }

  send(event: VoiceEvent): void {
    if (this.closed) return;
    if (event.type === "conversation.item.create") {
      if (event.item?.type === "function_call_output") {
        const id = this.pendingCalls.get(event.item.call_id);
        if (!id) return; // Ignore duplicates and results from replaced sessions.
        this.write({ type: "response.item.create", item: event.item });
        this.pendingCalls.delete(event.item.call_id);
        const batch = this.batches.get(id);
        if (batch?.completed && !batch.continued && [...batch.calls.keys()].every(call => !this.pendingCalls.has(call))) {
          batch.continued = true;
          this.write({ type: "response.create" });
          this.batches.delete(id);
        }
      } else if (event.item?.role === "system") {
        // UI snapshots go to the task backend, not the small voice context.
        this.write({ type: "response.item.create", item: { ...event.item, role: "developer" } });
      } else if (event.item) {
        this.write({ type: "response.item.create", item: event.item });
      }
      return;
    }
    if (event.type === "response.create") {
      if (typeof event.response?.instructions === "string") this.write({
        type: "session.instructions.append", delegation_id: null, content: event.response.instructions.slice(0, 1500),
      });
      // Tool continuations are owned by the complete output batch above.
      return;
    }
    if (event.type === "response.cancel") {
      this.write({ type: "session.instructions.append", delegation_id: null, content: "Stop speaking now and listen to the user. This does not cancel any backend operation." });
      return;
    }
    if (event.type === "input_audio_buffer.append") {
      this.write({ type: "session.input_audio.append", audio: event.audio });
      return;
    }
    if (event.type === "input_audio_buffer.commit" || event.type === "input_audio_buffer.clear") return;
    if (["session.close", "session.update", "session.instructions.append", "session.thinking.append", "session.commentary.append"].includes(event.type)) this.write(event);
  }
}

/** Caption segments are grouped per speaker; silence gaps are display hints only. */
export class LiveCaptions {
  private speakers = new Map<string, { id: string; text: string; end: number }>();
  private sequence = 0;
  append(event: VoiceEvent): { id: string; role: "user" | "agent"; text: string } | null {
    const role = event.type === "session.input_transcript.delta" ? "user"
      : event.type === "session.output_transcript.delta" ? "agent" : null;
    if (!role || typeof event.delta !== "string") return null;
    const previous = this.speakers.get(role);
    const start = Number(event.start_ms ?? 0);
    const end = Number(event.end_ms ?? start);
    const segment = previous && start - previous.end < 1500 && start >= previous.end - 1500
      ? previous : { id: `live-${role}-${++this.sequence}`, text: "", end };
    segment.text += event.delta;
    segment.end = Math.max(segment.end, end);
    this.speakers.set(role, segment);
    return { id: segment.id, role, text: segment.text };
  }
}
