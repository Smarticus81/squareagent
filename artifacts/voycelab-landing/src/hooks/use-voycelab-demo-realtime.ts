import { useCallback, useRef, useState, type MutableRefObject } from "react";

/**
 * VoyceLab landing live demo: browser WebRTC direct to OpenAI using a
 * short-lived ephemeral token, running against The Den — a sandbox bar with a
 * mock catalog. Spoken orders trigger real tool calls, executed server-side
 * (/api/realtime/demo-bar-tools), and the live ticket state is exposed so the
 * landing page can render the order building in real time.
 */

export type DemoAgentState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface DemoMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

export interface DemoCatalogItem {
  name: string;
  price: number;
  category: string;
}

export interface DemoOrderItem {
  name: string;
  price: number;
  quantity: number;
  category: string;
}

let _mid = 0;
const genId = () => `demo-${Date.now()}-${++_mid}`;

function preparePlaybackAudioEl(el: HTMLAudioElement) {
  el.autoplay = true;
  el.setAttribute("playsinline", "");
  el.volume = 1;
  el.muted = false;
  el.preload = "auto";
  Object.assign(el.style, {
    position: "fixed",
    left: "0",
    bottom: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  if (!el.parentNode) document.body.appendChild(el);
}

async function routeRemotePlayback(
  audioEl: HTMLAudioElement,
  stream: MediaStream,
  fallbackCtxRef: MutableRefObject<AudioContext | null>,
) {
  audioEl.muted = false;
  audioEl.srcObject = stream;
  try {
    await audioEl.play();
    if (fallbackCtxRef.current) {
      try {
        await fallbackCtxRef.current.close();
      } catch {
        /* ignore */
      }
      fallbackCtxRef.current = null;
    }
    return;
  } catch {
    /* Element playback often fails for remote WebRTC streams — route via AudioContext. */
  }

  try {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.srcObject = null;
  } catch {
    /* ignore */
  }

  try {
    if (fallbackCtxRef.current && fallbackCtxRef.current.state !== "closed") {
      await fallbackCtxRef.current.close();
    }
  } catch {
    /* ignore */
  }
  fallbackCtxRef.current = null;

  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) {
    console.warn("[DemoRealtime] No AudioContext — cannot play assistant audio");
    return;
  }
  const ctx = new AC();
  fallbackCtxRef.current = ctx;
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  src.connect(ctx.destination);
}

export function useVoycelabDemoRealtime() {
  const [agentState, setAgentState] = useState<DemoAgentState>("idle");
  const [conversation, setConversation] = useState<DemoMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assistantStream, setAssistantStream] = useState<MediaStream | null>(null);
  const [order, setOrder] = useState<DemoOrderItem[]>([]);
  const [catalog, setCatalog] = useState<DemoCatalogItem[]>([]);

  const sessionIdRef = useRef<string>("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fallbackAudioCtxRef = useRef<AudioContext | null>(null);
  const isRunning = useRef(false);
  const agentStateRef = useRef<DemoAgentState>("idle");
  // Half-duplex mic gating: on speaker / Bluetooth the agent's own voice leaks
  // into the mic and trips the server VAD, cutting the reply off after a word
  // or two. We disable the mic track during playback so it can't reach the VAD.
  // Acoustic (full-duplex) barge-in is opt-in via the server's voicelab.bargeIn.
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const fullDuplexRef = useRef(false);
  const micReopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setConversation((prev) => [...prev, { id: genId(), role, content: trimmed, timestamp: new Date() }]);
  }, []);

  // ── Half-duplex mic gating helpers ──────────────────────────────────────────
  const setMicEnabled = useCallback((enabled: boolean) => {
    const track = micTrackRef.current;
    if (track && track.enabled !== enabled) track.enabled = enabled;
  }, []);

  const cancelMicReopen = useCallback(() => {
    if (micReopenTimerRef.current !== null) {
      clearTimeout(micReopenTimerRef.current);
      micReopenTimerRef.current = null;
    }
  }, []);

  /** Mute the mic for the duration of agent playback (half-duplex only). */
  const gateMicForPlayback = useCallback(() => {
    if (fullDuplexRef.current) return;
    cancelMicReopen();
    setMicEnabled(false);
  }, [cancelMicReopen, setMicEnabled]);

  /** Re-open the mic after playback, with a short acoustic-decay tail. */
  const reopenMic = useCallback(() => {
    if (fullDuplexRef.current) return;
    cancelMicReopen();
    micReopenTimerRef.current = setTimeout(() => {
      setMicEnabled(true);
      micReopenTimerRef.current = null;
    }, 250);
  }, [cancelMicReopen, setMicEnabled]);

  /** Re-open the mic immediately (deliberate interrupt / error recovery). */
  const reopenMicNow = useCallback(() => {
    if (fullDuplexRef.current) return;
    cancelMicReopen();
    setMicEnabled(true);
  }, [cancelMicReopen, setMicEnabled]);

  const disconnect = useCallback(async () => {
    isRunning.current = false;
    agentStateRef.current = "idle";
    cancelMicReopen();
    micTrackRef.current = null;

    pcRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });

    dcRef.current?.close();
    dcRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    if (fallbackAudioCtxRef.current && fallbackAudioCtxRef.current.state !== "closed") {
      void fallbackAudioCtxRef.current.close().catch(() => {});
    }
    fallbackAudioCtxRef.current = null;

    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
      } catch {
        /* ignore */
      }
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }

    setAssistantStream(null);
    setAgentState("idle");
    setPartialTranscript("");
    setError(null);
  }, [cancelMicReopen]);

  /**
   * Execute a mock-bar tool call server-side, update the live ticket, and hand
   * the result back to the model so it can speak the confirmation.
   */
  const executeToolCall = useCallback(async (callId: string, toolName: string, argsJson: string) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    } catch {
      /* malformed args — execute with empty args */
    }

    let output = "Something went wrong — ask the guest to repeat that.";
    try {
      const res = await fetch("/api/realtime/demo-bar-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          tool_name: toolName,
          arguments: args,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { result?: string; order?: DemoOrderItem[] };
        if (Array.isArray(data.order)) setOrder(data.order);
        if (typeof data.result === "string" && data.result) output = data.result;
      }
    } catch {
      /* network hiccup — fall through with the fallback output */
    }

    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output },
        }),
      );
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  }, []);

  const handleDcEvent = useCallback(
    (raw: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }

      const setAs = (s: DemoAgentState) => {
        agentStateRef.current = s;
        setAgentState(s);
      };

      switch (event.type) {
        case "session.created":
          setAs("listening");
          break;

        case "input_audio_buffer.speech_started":
          // Only acoustic barge-in (full-duplex) cancels the agent here. In
          // half-duplex the mic is gated during playback, so a speech_started
          // while "speaking" can only be residual echo — ignore it.
          if (fullDuplexRef.current && agentStateRef.current === "speaking") {
            dcRef.current?.send(JSON.stringify({ type: "response.cancel" }));
            reopenMicNow();
          }
          setAs("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          setAs("thinking");
          break;

        case "response.audio_transcript.delta":
          setPartialTranscript((p) => p + String(event.delta ?? ""));
          break;

        case "conversation.item.input_audio_transcription.completed": {
          const t = String(event.transcript ?? "").trim();
          if (t) addMessage("user", t);
          setPartialTranscript("");
          break;
        }

        case "response.audio_transcript.done": {
          const t = String(event.transcript ?? "").trim();
          if (t) addMessage("agent", t);
          setPartialTranscript("");
          break;
        }

        case "response.audio.delta":
          // Gate the mic on the first agent audio frame so its voice can't echo
          // back into the VAD (no-op in full-duplex).
          gateMicForPlayback();
          setAs("speaking");
          break;

        case "response.function_call_arguments.done": {
          const callId = String(event.call_id ?? "");
          const name = String(event.name ?? "");
          if (callId && name) {
            setAs("thinking");
            void executeToolCall(callId, name, String(event.arguments ?? "{}"));
          }
          break;
        }

        case "response.done":
          if (isRunning.current) {
            reopenMic();
            setAs("listening");
          }
          break;

        case "error": {
          const err = (event.error as Record<string, unknown>)?.message ?? event.message ?? "Realtime error";
          console.error("[DemoRealtime]", err);
          reopenMicNow();
          setError(String(err));
          setAs("error");
          break;
        }

        default:
          break;
      }
    },
    [addMessage, executeToolCall, gateMicForPlayback, reopenMic, reopenMicNow],
  );

  const connect = useCallback(async (existingStream?: MediaStream) => {
    if (isRunning.current) return;
    setError(null);
    setPartialTranscript("");
    setAgentState("connecting");

    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const unlock = new AC();
        void unlock.resume().then(() => unlock.close().catch(() => {}));
      }
    } catch {
      /* ignore */
    }

    const remoteAudioTracks: MediaStreamTrack[] = [];
    const unmuteHooked = new WeakSet<MediaStreamTrack>();

    try {
      const tokenRes = await fetch("/api/realtime/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ voice: "coral", speed: 1.05, mode: "bar" }),
      });

      if (!tokenRes.ok) {
        const err = (await tokenRes.json().catch(() => null)) as { detail?: string; error?: string } | null;
        throw new Error(err?.detail ?? err?.error ?? `Voice session failed (${tokenRes.status})`);
      }

      const sessionData = (await tokenRes.json()) as {
        id?: string;
        client_secret?: { value?: string };
        voicelab?: { bargeIn?: boolean };
        catalog?: DemoCatalogItem[];
      };
      sessionIdRef.current = sessionData.id || genId();
      if (Array.isArray(sessionData.catalog)) setCatalog(sessionData.catalog);
      setOrder([]);
      const ephemeralKey = sessionData.client_secret?.value;
      if (!ephemeralKey) throw new Error("Voice session did not return an ephemeral key");
      // Server decides duplex behavior. Default = half-duplex (gate the mic).
      fullDuplexRef.current = Boolean(sessionData.voicelab?.bargeIn);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      preparePlaybackAudioEl(audioEl);
      audioElRef.current = audioEl;

      pc.ontrack = (e) => {
        if (e.track.kind !== "audio") return;
        if (!remoteAudioTracks.includes(e.track)) remoteAudioTracks.push(e.track);
        const ms = new MediaStream([...remoteAudioTracks]);
        setAssistantStream(ms);
        void routeRemotePlayback(audioEl, ms, fallbackAudioCtxRef);
        if (!unmuteHooked.has(e.track)) {
          unmuteHooked.add(e.track);
          e.track.addEventListener("unmute", () => {
            const unmutedStream = new MediaStream([...remoteAudioTracks]);
            setAssistantStream(unmutedStream);
            void routeRemotePlayback(audioEl, unmutedStream, fallbackAudioCtxRef);
          });
        }
      };

      const stream =
        existingStream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }));
      micTrackRef.current = stream.getAudioTracks()[0] ?? null;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        isRunning.current = true;
      };

      dc.onmessage = (e) => handleDcEvent(e.data);

      dc.onclose = () => {
        if (isRunning.current) {
          isRunning.current = false;
          setAgentState((prev) => (prev === "error" ? "error" : "idle"));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      const ct = sdpRes.headers.get("content-type") ?? "";

      if (!sdpRes.ok) {
        let detail = `Voice connection failed (${sdpRes.status})`;
        try {
          if (ct.includes("application/json")) {
            const j = (await sdpRes.json()) as { detail?: string; error?: string };
            if (typeof j.detail === "string") detail = j.detail;
            else if (typeof j.error === "string") detail = j.error;
          } else {
            const t = await sdpRes.text();
            if (t) detail = `${detail}: ${t.slice(0, 180)}`;
          }
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not start voice demo";
      console.error("[DemoRealtime]", msg);
      setError(msg);
      setAgentState("error");
      setAssistantStream(null);
      cancelMicReopen();
      micTrackRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      dcRef.current = null;
      isRunning.current = false;
      remoteAudioTracks.length = 0;
      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {
          /* ignore */
        }
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
        audioElRef.current = null;
      }
      if (fallbackAudioCtxRef.current && fallbackAudioCtxRef.current.state !== "closed") {
        void fallbackAudioCtxRef.current.close().catch(() => {});
      }
      fallbackAudioCtxRef.current = null;
    }
  }, [handleDcEvent, cancelMicReopen]);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
    // Deliberate barge-in: re-open the mic immediately.
    reopenMicNow();
  }, [reopenMicNow]);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setPartialTranscript("");
    setError(null);
  }, []);

  const isLive =
    agentState === "connecting" ||
    agentState === "listening" ||
    agentState === "thinking" ||
    agentState === "speaking";

  const orderTotal = order.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return {
    agentState,
    conversation,
    partialTranscript,
    error,
    assistantStream,
    order,
    orderTotal,
    catalog,
    connect,
    disconnect,
    interrupt,
    clearConversation,
    isLive,
  };
}
