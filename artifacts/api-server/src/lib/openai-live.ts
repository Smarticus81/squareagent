import { sanitizeLiveVoice, sanitizeLivePace } from "./openai-realtime";

export const OPENAI_LIVE_MODEL = "gpt-live-1";
export const OPENAI_LIVE_BACKEND_MODEL = process.env.OPENAI_LIVE_BACKEND_MODEL?.trim() || "gpt-5.6-terra";
export const OPENAI_LIVE_URL = "https://api.openai.com/v1/live/sessions";
export const OPENAI_LIVE_WS_URL = "wss://api.openai.com/v1/live/sessions";

export interface LiveSessionOptions {
  instructions: string;
  tools?: unknown[];
  voice?: unknown;
  speed?: unknown;
  displayName?: string;
  personality?: string;
  transport?: "webrtc" | "websocket";
  // Accepted for source compatibility; Live has continuous audio, no Realtime VAD.
  turnDetection?: Record<string, unknown> | null;
  noiseMode?: string;
}

/** Split speech persona from task rules. No Realtime-only parameters reach Live. */
export function buildLiveSessionPayload(opts: LiveSessionOptions) {
  const voice = sanitizeLiveVoice(opts.voice);
  const pace = sanitizeLivePace(opts.speed ?? 1);
  return {
    model: OPENAI_LIVE_MODEL,
    instructions: `You are ${opts.displayName || "a VoyceLab assistant"}. ${opts.personality || "Be warm, natural, clear, and concise."}
Speak ${pace > 1.1 ? "briskly" : pace < 0.9 ? "slowly" : "at a comfortable pace"}. Use expressive, conversational intonation. Say assistant, commands, and connected systems.
Backchannel policy: Use moderate listening acknowledgments without competing with the user.
Interruption policy: Stop speaking when interrupted and listen. A speech interruption does not cancel backend work.
Delegation policy:
Backend tools: The backend knows this assistant's business rules, connected systems, menu, current order, and available commands.
Delegate to the backend when: the user requests information about the business, prices, stock, orders, reports, or any action; changes or cancels a request; asks about available capabilities; or needs careful reasoning.
Do not delegate to the backend when: greeting, repeating a still-current verified result, or asking a brief clarification.
Only announce actions after the backend confirms success. Ask for required confirmation before proceeding. Never invent prices, records, or completed actions.`,
    audio: {
      ...(opts.transport === "websocket" ? { format: { type: "audio/pcm", rate: 24000 } } : {}),
      output: { voice: voice.startsWith("voice_") ? { id: voice } : voice },
    },
    delegation: {
      type: "responses",
      responses: {
        model: OPENAI_LIVE_BACKEND_MODEL,
        instructions: `${opts.instructions}\n\nYou are the task backend for a live voice assistant. Return concise verified results or clarifications for it to communicate. Apply the latest user corrections. Do not treat silence, transcript fragments, or interrupted speech as approval or cancellation. Never claim success before a command succeeds. Do not invoke wait_for_user merely to control speaking; the voice model manages conversation timing.`,
        tools: (opts.tools ?? []).filter((tool: any) => tool.name !== "wait_for_user").map((tool: any) => ({
          type: "function", name: tool.name, description: tool.description,
          parameters: tool.parameters, strict: false,
        })),
        tool_choice: "auto",
        parallel_tool_calls: false,
      },
    },
  };
}

export function validLiveSdp(sdp: unknown): sdp is string {
  return typeof sdp === "string" && sdp.length <= 65536 && sdp.startsWith("v=0") && sdp.includes("m=audio");
}

export async function createLiveWebRtcSession(apiKey: string, session: ReturnType<typeof buildLiveSessionPayload>, sdp: string) {
  if (!validLiveSdp(sdp)) throw new Error("A valid audio SDP offer is required");
  const response = await fetch(OPENAI_LIVE_URL, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ session, transport: { type: "webrtc", sdp } }),
  });
  if (!response.ok) throw new Error(`OpenAI Live session creation failed (HTTP ${response.status})`);
  const data = await response.json() as { session?: { id?: string }; transport?: { sdp?: string } };
  if (!data.session?.id || !data.transport?.sdp) throw new Error("OpenAI Live returned an incomplete session handshake");
  return { id: data.session.id, transport: { type: "webrtc", sdp: data.transport.sdp }, model: OPENAI_LIVE_MODEL };
}
