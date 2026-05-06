import { useCallback, useRef, useState, type MutableRefObject } from "react";

/** VoyceLab landing FAQ demo: browser WebRTC direct to OpenAI using a short-lived ephemeral token. */

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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fallbackAudioCtxRef = useRef<AudioContext | null>(null);
  const isRunning = useRef(false);
  const agentStateRef = useRef<DemoAgentState>("idle");

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setConversation((prev) => [...prev, { id: genId(), role, content: trimmed, timestamp: new Date() }]);
  }, []);

  const disconnect = useCallback(async () => {
    isRunning.current = false;
    agentStateRef.current = "idle";

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

    setAgentState("idle");
    setPartialTranscript("");
    setError(null);
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
          if (agentStateRef.current === "speaking") {
            dcRef.current?.send(JSON.stringify({ type: "response.cancel" }));
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
          setAs("speaking");
          break;

        case "response.done":
          if (isRunning.current) setAs("listening");
          break;

        case "error": {
          const err = (event.error as Record<string, unknown>)?.message ?? event.message ?? "Realtime error";
          console.error("[DemoRealtime]", err);
          setError(String(err));
          setAs("error");
          break;
        }

        default:
          break;
      }
    },
    [addMessage],
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
      const tokenRes = await fetch("/api/realtime/demo-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ voice: "coral", speed: 1.05 }),
      });

      if (!tokenRes.ok) {
        const err = (await tokenRes.json().catch(() => null)) as { detail?: string; error?: string } | null;
        throw new Error(err?.detail ?? err?.error ?? `Voice session failed (${tokenRes.status})`);
      }

      const sessionData = (await tokenRes.json()) as {
        id?: string;
        client_secret?: { value?: string };
      };
      const ephemeralKey = sessionData.client_secret?.value;
      if (!ephemeralKey) throw new Error("Voice session did not return an ephemeral key");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      preparePlaybackAudioEl(audioEl);
      audioElRef.current = audioEl;

      pc.ontrack = (e) => {
        if (e.track.kind !== "audio") return;
        if (!remoteAudioTracks.includes(e.track)) remoteAudioTracks.push(e.track);
        const ms = new MediaStream([...remoteAudioTracks]);
        void routeRemotePlayback(audioEl, ms, fallbackAudioCtxRef);
        if (!unmuteHooked.has(e.track)) {
          unmuteHooked.add(e.track);
          e.track.addEventListener("unmute", () => {
            void routeRemotePlayback(audioEl, new MediaStream([...remoteAudioTracks]), fallbackAudioCtxRef);
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
  }, [handleDcEvent]);

  const interrupt = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
  }, []);

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

  return {
    agentState,
    conversation,
    partialTranscript,
    error,
    connect,
    disconnect,
    interrupt,
    clearConversation,
    isLive,
  };
}
