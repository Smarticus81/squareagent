import { useState, useEffect, useCallback, useRef } from "react";
import { VoiceOrb } from "@/components/voice-orb";
import type { DemoAgentState } from "@/hooks/use-voycelab-demo-realtime";

interface MockOrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface DemoSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  sessionId: string;
  remoteStream: MediaStream;
}

function getBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const loc = window.location;
  if (loc.port === "5173") return "http://localhost:8080/";
  return `${loc.protocol}//${loc.host}/`;
}

export function MockBarDemo() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [agentState, setAgentState] = useState<DemoAgentState>("idle");
  const [order, setOrder] = useState<MockOrderItem[]>([]);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef("");
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const executeToolCall = useCallback(async (toolName: string, args: Record<string, unknown>, callId: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    try {
      const res = await fetch(`${getBaseUrl()}api/realtime/demo-bar-tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionIdRef.current, tool_name: toolName, arguments: args }),
      });
      const data = await res.json();
      if (data.order) setOrder(data.order);
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: data.result ?? "done" },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    } catch (e: any) {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: `Error: ${e.message}` },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  }, []);

  const startDemo = useCallback(async (micStream: MediaStream) => {
    if (isConnecting || session) return;
    setIsConnecting(true);
    setError(null);
    try {
      const resp = await fetch(`${getBaseUrl()}api/realtime/demo-bar-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: "coral" }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: "Failed" }));
        throw new Error(e.detail ?? e.error ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const token = data.client_secret?.value;
      if (!token) throw new Error("No session token received");
      sessionIdRef.current = data.id;

      const pc = new RTCPeerConnection();
      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
        if (!audioElRef.current) {
          const el = document.createElement("audio");
          el.autoplay = true;
          el.style.display = "none";
          document.body.appendChild(el);
          audioElRef.current = el;
        }
        audioElRef.current.srcObject = remote;
      };

      micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        setAgentState("listening");
      });

      dc.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          switch (msg.type) {
            case "response.audio.delta":
              setAgentState("speaking");
              break;
            case "response.audio.done":
            case "response.done":
              setAgentState("listening");
              break;
            case "response.function_call_arguments.done": {
              const args = JSON.parse(msg.arguments ?? "{}");
              executeToolCall(msg.name, args, msg.call_id);
              break;
            }
            case "input_audio_buffer.speech_started":
              setAgentState("listening");
              break;
          }
        } catch { /* ignore parse errors */ }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpResp.ok) throw new Error("SDP exchange failed");
      const answer = new RTCSessionDescription({ type: "answer", sdp: await sdpResp.text() });
      await pc.setRemoteDescription(answer);

      setSession({ pc, dc, sessionId: data.id, remoteStream: remote });
      setAgentState("connecting");
    } catch (e: any) {
      setError(e.message);
      setAgentState("idle");
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, session, executeToolCall]);

  const stopDemo = useCallback(() => {
    if (session) {
      session.dc.close();
      session.pc.close();
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    dcRef.current = null;
    setSession(null);
    setRemoteStream(null);
    setAgentState("idle");
    setOrder([]);
  }, [session]);

  useEffect(() => () => { stopDemo(); }, []);

  const total = order.reduce((s, i) => s + i.price * i.quantity, 0);

  return (
    <section id="demo" className="mx-auto max-w-5xl px-5 py-16">
      <p className="vl-eyebrow mb-2 text-center">Live product demo</p>
      <h2 className="vl-display text-center text-3xl md:text-4xl mb-10">
        Talk to Bev. Watch the ticket update.
      </h2>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Left: VoiceOrb */}
        <div className="flex flex-col items-center gap-4">
          <VoiceOrb
            size={280}
            outputStream={remoteStream}
            agentState={agentState}
            onListenStart={startDemo}
            onListenStop={stopDemo}
            externalError={error}
          />
          <p className="text-sm" style={{ color: "var(--color-vl-ink-muted)" }}>
            {agentState === "idle" ? "Click the orb to talk to Bev" :
             agentState === "connecting" ? "Connecting..." :
             agentState === "listening" ? "Listening... try \"two margaritas and a Modelo\"" :
             agentState === "speaking" ? "Bev is responding..." : ""}
          </p>
        </div>

        {/* Right: Live order ticket */}
        <div className="vl-card p-6 min-h-[320px]">
          <div className="text-center mb-4 pb-3" style={{ borderBottom: "2px dashed var(--color-vl-ink-faint, #ccc)" }}>
            <h3 className="font-bold text-lg" style={{ color: "var(--color-vl-ink)" }}>The Den</h3>
            <p className="text-xs" style={{ color: "var(--color-vl-ink-muted)" }}>Demo Bar -- Powered by VoyceLab</p>
          </div>

          {order.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-vl-ink-muted)" }}>
              Order items will appear here as you speak
            </p>
          ) : (
            <div className="space-y-2 mb-4">
              {order.map((item, i) => (
                <div
                  key={`${item.name}-${i}`}
                  className="flex justify-between items-center py-1"
                  style={{ animation: "slideInTicket 180ms ease-out" }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--color-vl-ink)" }}>
                    {item.quantity}x {item.name}
                  </span>
                  <span className="text-sm tabular-nums" style={{ color: "var(--color-vl-ink-muted)" }}>
                    ${(item.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {order.length > 0 && (
            <div className="pt-3 flex justify-between items-center font-bold" style={{ borderTop: "2px dashed var(--color-vl-ink-faint, #ccc)" }}>
              <span style={{ color: "var(--color-vl-ink)" }}>Total</span>
              <span style={{ color: "var(--color-vl-accent)" }}>${total.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs mt-6" style={{ color: "var(--color-vl-ink-muted)" }}>
        This is the actual product. The orb is OpenAI Realtime over WebRTC. The ticket uses the same code path that talks to Square in production.
      </p>

      <style>{`
        @keyframes slideInTicket {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}
