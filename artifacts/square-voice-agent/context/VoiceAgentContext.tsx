/**
 * Voice Agent Context — OpenAI Realtime API
 *
 * Web:    WebSocket + Web Audio API (PCM16 streaming, server-side VAD)
 * Native: WebSocket + expo-av recording (client-side VAD, utterance-mode)
 *
 * Server relay: /api/realtime (wss)
 */
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import { getVoicePrefs } from "@/hooks/useVoicePrefs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentState =
  | "disconnected"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

export interface OrderCommand {
  action: "add" | "remove" | "clear" | "submit";
  item_id?: string;
  item_name?: string;
  quantity?: number;
  price?: number;
}

export type CommandHandler = (commands: OrderCommand[]) => void;
export type ToolHandler = CommandHandler;

interface VoiceAgentContextType {
  agentState: AgentState;
  isConnected: boolean;
  conversation: ConversationMessage[];
  partialTranscript: string;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearConversation: () => void;
  setToolHandler: (h: CommandHandler) => void;
  interrupt: () => void;
  setCatalog: (items: unknown[]) => void;
  setCurrentOrder: (order: unknown[]) => void;
  setSquareCredentials: (token: string, locationId: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Native VAD: fire after N silent frames at -35 dB
const VAD_THRESHOLD_DB = -35;
const SILENCE_FRAMES_TO_SEND = 14;
const MAX_RECORD_MS = 25_000;

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: ".wav",
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 384000,
  },
  ios: {
    extension: ".wav",
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 384000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let _msgId = 0;
const genId = () => `msg-${Date.now()}-${++_msgId}`;

function getWsUrl(voice: string, speed: number): string {
  const base = process.env.EXPO_PUBLIC_DOMAIN
    ? `wss://${process.env.EXPO_PUBLIC_DOMAIN}/api/realtime`
    : "ws://localhost:8080/api/realtime";
  return `${base}?voice=${encodeURIComponent(voice)}&speed=${speed}`;
}

// Float32 PCM → Int16 PCM → base64
function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  return arrayBufferToBase64(pcm.buffer);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Build a WAV blob/data-uri from accumulated PCM16 base64 chunks (24kHz mono)
function pcm16ChunksToWavDataUri(chunks: string[]): string {
  // Combine all PCM16 data
  const parts = chunks.map((c) => base64ToUint8Array(c));
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const pcmData = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) { pcmData.set(p, offset); offset += p.length; }

  const sampleRate = 24000;
  const wav = new Uint8Array(44 + pcmData.length);
  const view = new DataView(wav.buffer);

  const setStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  setStr(0, "RIFF");
  view.setUint32(4, 36 + pcmData.length, true);
  setStr(8, "WAVE");
  setStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  setStr(36, "data");
  view.setUint32(40, pcmData.length, true);
  wav.set(pcmData, 44);

  return `data:audio/wav;base64,${arrayBufferToBase64(wav.buffer)}`;
}

// ── Context ───────────────────────────────────────────────────────────────────

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<unknown[]>([]);
  const squareTokenRef = useRef<string>("");
  const squareLocationIdRef = useRef<string>("");
  const isRunning = useRef(false);

  // Web Audio refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Web playback queue
  const pendingPcmChunks = useRef<string[]>([]);
  const isPlaying = useRef(false);
  const nextPlayTime = useRef(0);

  // Native recording
  const currentRecording = useRef<Audio.Recording | null>(null);
  const currentSound = useRef<Audio.Sound | null>(null);
  // Native accumulates response PCM16 chunks until response.audio.done
  const nativeAudioChunks = useRef<string[]>([]);
  const nativeRecordLoopRef = useRef<(() => Promise<void>) | null>(null);
  const nativeProcessUtteranceRef = useRef<((rec: Audio.Recording) => Promise<void>) | null>(null);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    setConversation((prev) => [
      ...prev,
      { id: genId(), role, content, timestamp: new Date() },
    ]);
  }, []);

  const sendContextUpdate = useCallback((overrides: Record<string, unknown> = {}) => {
    ws.current?.send(JSON.stringify({
      type: "x.context_update",
      catalog: catalogRef.current,
      order: currentOrderRef.current,
      squareToken: squareTokenRef.current,
      squareLocationId: squareLocationIdRef.current,
      ...overrides,
    }));
  }, []);

  const setCatalog = useCallback((items: unknown[]) => {
    catalogRef.current = items;
    sendContextUpdate({ catalog: items });
  }, [sendContextUpdate]);

  const setCurrentOrder = useCallback((order: unknown[]) => {
    currentOrderRef.current = order;
    sendContextUpdate({ order });
  }, [sendContextUpdate]);

  const setSquareCredentials = useCallback((token: string, locationId: string) => {
    squareTokenRef.current = token;
    squareLocationIdRef.current = locationId;
    sendContextUpdate({ squareToken: token, squareLocationId: locationId });
  }, [sendContextUpdate]);

  const setToolHandler = useCallback((h: CommandHandler) => {
    commandHandlerRef.current = h;
  }, []);

  // ── WebSocket event handler ─────────────────────────────────────────────────

  const handleWsEvent = useCallback(
    (raw: string) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw); } catch { return; }

      switch (event.type) {
        case "session.created":
          setAgentState("listening");
          // Bootstrap the relay with current catalog, order, and Square credentials
          sendContextUpdate();
          break;

        case "input_audio_buffer.speech_started":
          setAgentState("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          setAgentState("thinking");
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

        case "response.audio.delta": {
          const chunk = String(event.delta ?? "");
          if (!chunk) break;

          if (Platform.OS === "web") {
            // Web: schedule for immediate AudioContext playback
            scheduleWebAudioChunk(chunk);
          } else {
            // Native: accumulate until done
            nativeAudioChunks.current.push(chunk);
          }
          setAgentState("speaking");
          break;
        }

        case "response.audio.done":
          if (Platform.OS !== "web" && nativeAudioChunks.current.length > 0) {
            const chunks = [...nativeAudioChunks.current];
            nativeAudioChunks.current = [];
            playNativeAudio(chunks).then(() => {
              if (isRunning.current) nativeRecordLoopRef.current?.();
            });
          }
          break;

        case "response.done":
          if (Platform.OS === "web") {
            // Web: after speaking, back to listening automatically (server VAD)
            if (isRunning.current) setAgentState("listening");
          }
          break;

        case "x.order_command": {
          const cmd = event.command as OrderCommand;
          if (cmd) commandHandlerRef.current?.([cmd]);
          break;
        }

        case "error": {
          const err = (event.error as Record<string, unknown>)?.message ?? event.message ?? "Realtime error";
          console.error("[Realtime]", err);
          setError(String(err));
          setAgentState("error");
          break;
        }
      }
    },
    [addMessage, sendContextUpdate]
  );

  // ── Web Audio playback (streaming PCM16, low-latency) ──────────────────────

  const scheduleWebAudioChunk = useCallback((base64Pcm: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const pcm16 = base64ToUint8Array(base64Pcm);
    const int16 = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.length / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const start = Math.max(now, nextPlayTime.current);
    source.start(start);
    nextPlayTime.current = start + audioBuffer.duration;
  }, []);

  // ── Native audio playback (accumulate → WAV → expo-av) ────────────────────

  const playNativeAudio = useCallback(async (chunks: string[]): Promise<void> => {
    try {
      const uri = pcm16ChunksToWavDataUri(chunks);

      const s = currentSound.current;
      if (s) { await s.stopAsync().catch(() => {}); await s.unloadAsync().catch(() => {}); currentSound.current = null; }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri });
      currentSound.current = sound;
      await sound.playAsync();

      await new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if ((status as any).didJustFinish) {
            sound.unloadAsync().catch(() => {});
            currentSound.current = null;
            resolve();
          }
        });
      });
    } catch (e: any) {
      console.error("[NativePlay]", e?.message);
    }
  }, []);

  // ── Native VAD recording loop ──────────────────────────────────────────────

  const nativeRecordLoop = useCallback(async () => {
    if (!isRunning.current) return;
    setAgentState("listening");

    let hasSpeech = false;
    let silenceFrames = 0;
    let utteranceSent = false;

    const rec = new Audio.Recording();
    currentRecording.current = rec;

    const fireUtterance = () => {
      if (utteranceSent) return;
      utteranceSent = true;
      nativeProcessUtteranceRef.current?.(rec);
    };

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      await rec.prepareToRecordAsync({ ...RECORDING_OPTIONS, isMeteringEnabled: true });

      rec.setOnRecordingStatusUpdate((status) => {
        if (utteranceSent || !isRunning.current) return;
        if (!status.isRecording) return;
        const db: number = (status as any).metering ?? -160;
        if (db > VAD_THRESHOLD_DB) { hasSpeech = true; silenceFrames = 0; }
        else if (hasSpeech) {
          silenceFrames++;
          if (silenceFrames >= SILENCE_FRAMES_TO_SEND) fireUtterance();
        }
      });

      await rec.startAsync();
      setTimeout(fireUtterance, MAX_RECORD_MS);
    } catch (e: any) {
      console.error("[NativeRecord]", e?.message);
      if (isRunning.current) { setError("Mic error: " + (e?.message ?? "unknown")); setAgentState("error"); }
    }
  }, []);

  const nativeProcessUtterance = useCallback(async (rec: Audio.Recording) => {
    if (!isRunning.current) return;
    setAgentState("thinking");

    try {
      await rec.stopAndUnloadAsync().catch(() => {});
      const uri = rec.getURI();
      currentRecording.current = null;
      if (!uri || !isRunning.current) return;

      // Read WAV file, strip 44-byte header to get raw PCM16, send to server
      const response = await fetch(uri);
      const arrayBuf = await response.arrayBuffer();
      const headerSize = 44;
      const pcmBuf = arrayBuf.byteLength > headerSize ? arrayBuf.slice(headerSize) : arrayBuf;
      const base64Pcm = arrayBufferToBase64(pcmBuf);

      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Pcm }));
        ws.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        ws.current.send(JSON.stringify({ type: "response.create" }));
      }
    } catch (e: any) {
      console.error("[NativeProcess]", e?.message);
      if (isRunning.current) nativeRecordLoopRef.current?.();
    }
  }, []);

  nativeRecordLoopRef.current = nativeRecordLoop;
  nativeProcessUtteranceRef.current = nativeProcessUtterance;

  // ── Connect ────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isRunning.current) return;
    setError(null);
    setAgentState("connecting");

    if (Platform.OS !== "web") {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        setError("Microphone permission denied");
        setAgentState("error");
        return;
      }
    } else {
      // Create AudioContext NOW while in the user gesture context (avoids autoplay suspension)
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        await ctx.resume();
        audioCtxRef.current = ctx;
        nextPlayTime.current = 0;
      } catch (e: any) {
        setError("AudioContext failed: " + e?.message);
        setAgentState("error");
        return;
      }
    }

    const { voice, speed } = await getVoicePrefs();
    const wsUrl = getWsUrl(voice, speed);
    console.log("[Realtime] Connecting to", wsUrl);
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = async () => {
      console.log("[Realtime] WebSocket open");
      isRunning.current = true;
      // Full context (catalog + order + credentials) is sent on session.created

      if (Platform.OS === "web") {
        // AudioContext was already created in connect() during user gesture
        // Just set up the microphone stream here
        await startWebAudioStream();
      } else {
        nativeRecordLoopRef.current?.();
      }
    };

    socket.onmessage = (e) => handleWsEvent(e.data);

    socket.onerror = (e) => {
      console.error("[Realtime] WS error", e);
      setError("Connection failed");
      setAgentState("error");
      isRunning.current = false;
    };

    socket.onclose = () => {
      console.log("[Realtime] WS closed");
      isRunning.current = false;
      stopWebAudio();
      setAgentState((prev) => (prev === "error" ? "error" : "disconnected"));
    };
  }, [handleWsEvent]);

  // ── Web Audio capture ──────────────────────────────────────────────────────

  // Called from socket.onopen — AudioContext already created in connect()
  const startWebAudioStream = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.current?.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const b64 = float32ToPcm16Base64(float32);
        ws.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      console.log("[WebAudio] PCM16 streaming started at 24kHz");
    } catch (e: any) {
      console.error("[WebAudio]", e?.message);
      setError("Mic access failed: " + (e?.message ?? "unknown"));
      setAgentState("error");
    }
  }, []);

  const stopWebAudio = useCallback(async () => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    // Stop mic tracks FIRST so the hardware is released immediately
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    // Await the AudioContext close so Chrome fully releases audio hardware
    // before any subsequent mic acquisition (e.g. SpeechRecognition)
    if (audioCtxRef.current) {
      await audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    nextPlayTime.current = 0;
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    isRunning.current = false;
    // Await so audio hardware is fully released before mic can be re-acquired
    await stopWebAudio();

    const rec = currentRecording.current;
    if (rec) { rec.stopAndUnloadAsync().catch(() => {}); currentRecording.current = null; }

    const s = currentSound.current;
    if (s) { s.stopAsync().catch(() => {}); s.unloadAsync().catch(() => {}); currentSound.current = null; }

    ws.current?.close();
    ws.current = null;
    nativeAudioChunks.current = [];
    setAgentState("disconnected");
  }, [stopWebAudio]);

  const interrupt = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "response.cancel" }));
    }
    const s = currentSound.current;
    if (s) { s.stopAsync().catch(() => {}); s.unloadAsync().catch(() => {}); currentSound.current = null; }
    if (isRunning.current && Platform.OS !== "web") nativeRecordLoopRef.current?.();
  }, []);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setError(null);
    setPartialTranscript("");
  }, []);

  const isConnected = agentState !== "disconnected" && agentState !== "error";

  return (
    <VoiceAgentContext.Provider
      value={{
        agentState,
        isConnected,
        conversation,
        partialTranscript,
        error,
        connect,
        disconnect,
        clearConversation,
        setToolHandler,
        interrupt,
        setCatalog,
        setCurrentOrder,
        setSquareCredentials,
      }}
    >
      {children}
    </VoiceAgentContext.Provider>
  );
}

export function useVoiceAgent() {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) throw new Error("useVoiceAgent must be used within VoiceAgentProvider");
  return ctx;
}
