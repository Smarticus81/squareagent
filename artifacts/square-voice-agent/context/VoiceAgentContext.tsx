/**
 * Voice Agent Context
 * Pipeline: expo-av recording + VAD → POST /api/voice/chat (gpt-audio-mini) → expo-av playback
 * Works on iOS, Android, and Web.
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
  disconnect: () => void;
  clearConversation: () => void;
  setToolHandler: (h: CommandHandler) => void;
  interrupt: () => void;
  /** Keep catalog in sync so server has the right items to match against */
  setCatalog: (items: unknown[]) => void;
  /** Keep current order in sync so server tools have accurate order state */
  setCurrentOrder: (order: unknown[]) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VAD_THRESHOLD_DB = -35;
const SILENCE_FRAMES_TO_SEND = 14;
const MAX_RECORD_MS = 30_000;

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: ".mp4",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: ".wav",
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
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

function getBaseUrl() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/` : "http://localhost:3000/";
}

function getAudioMime(): string {
  if (Platform.OS === "ios") return "audio/wav";
  if (Platform.OS === "android") return "audio/mp4";
  return "audio/webm";
}

function getAudioExt(): string {
  if (Platform.OS === "ios") return "wav";
  if (Platform.OS === "android") return "mp4";
  return "webm";
}

// ── Context ───────────────────────────────────────────────────────────────────

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isRunning = useRef(false);
  const sessionId = useRef(`sess-${Date.now()}`);
  const currentRecording = useRef<Audio.Recording | null>(null);
  const currentSound = useRef<Audio.Sound | null>(null);
  const commandHandlerRef = useRef<CommandHandler | null>(null);
  const catalogRef = useRef<unknown[]>([]);
  const currentOrderRef = useRef<unknown[]>([]);

  // processUtterance and startRecordLoop are mutually recursive; use ref to avoid stale closures
  const processUtteranceRef = useRef<((rec: Audio.Recording) => Promise<void>) | null>(null);
  const startRecordLoopRef = useRef<(() => Promise<void>) | null>(null);

  const setCatalog = useCallback((items: unknown[]) => {
    catalogRef.current = items;
  }, []);

  const setCurrentOrder = useCallback((order: unknown[]) => {
    currentOrderRef.current = order;
  }, []);

  const setToolHandler = useCallback((h: CommandHandler) => {
    commandHandlerRef.current = h;
  }, []);

  const addMessage = useCallback((role: "user" | "agent", content: string) => {
    const msg: ConversationMessage = {
      id: genId(),
      role,
      content,
      timestamp: new Date(),
    };
    setConversation((prev) => [...prev, msg]);
  }, []);

  // ── Audio playback ────────────────────────────────────────────────────────

  const stopAudio = useCallback(() => {
    const s = currentSound.current;
    if (s) {
      s.stopAsync().catch(() => {});
      s.unloadAsync().catch(() => {});
      currentSound.current = null;
    }
  }, []);

  const playAudioBase64 = useCallback(
    async (base64Wav: string): Promise<void> => {
      try {
        // data URIs work on both web and native in expo-av
        const uri = `data:audio/wav;base64,${base64Wav}`;

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

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
        console.error("[Playback]", e?.message ?? e);
      }
    },
    []
  );

  // ── Send audio to server ──────────────────────────────────────────────────

  const sendToServer = useCallback(
    async (uri: string) => {
      const baseUrl = getBaseUrl();
      const fd = new FormData();

      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        fd.append("audio", blob, `recording.${getAudioExt()}`);
      } else {
        fd.append("audio", {
          uri,
          name: `recording.${getAudioExt()}`,
          type: getAudioMime(),
        } as any);
      }

      fd.append("session_id", sessionId.current);
      fd.append("catalog", JSON.stringify(catalogRef.current));
      fd.append("current_order", JSON.stringify(currentOrderRef.current));

      const res = await fetch(`${baseUrl}api/voice/chat`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Server error ${res.status}: ${text}`);
      }

      return res.json() as Promise<{
        user_transcript: string;
        agent_text: string;
        audio_b64: string | null;
        order_commands: OrderCommand[];
      }>;
    },
    []
  );

  // ── VAD recording loop ────────────────────────────────────────────────────

  const startRecordLoop = useCallback(async () => {
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
      processUtteranceRef.current?.(rec);
    };

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      await rec.prepareToRecordAsync({
        ...RECORDING_OPTIONS,
        isMeteringEnabled: true,
      });

      rec.setOnRecordingStatusUpdate((status) => {
        if (utteranceSent || !isRunning.current) return;
        if (!status.isRecording) return;

        const db: number = (status as any).metering ?? -160;
        if (db > VAD_THRESHOLD_DB) {
          hasSpeech = true;
          silenceFrames = 0;
        } else if (hasSpeech) {
          silenceFrames++;
          if (silenceFrames >= SILENCE_FRAMES_TO_SEND) fireUtterance();
        }
      });

      await rec.startAsync();

      setTimeout(fireUtterance, MAX_RECORD_MS);
    } catch (e: any) {
      console.error("[Record]", e?.message ?? e);
      if (isRunning.current) {
        setError("Mic error: " + (e?.message ?? "unknown"));
        setAgentState("error");
      }
    }
  }, []);

  const processUtterance = useCallback(
    async (rec: Audio.Recording) => {
      try {
        setAgentState("thinking");

        try { await rec.stopAndUnloadAsync(); } catch {}
        const uri = rec.getURI();
        currentRecording.current = null;

        if (!uri || !isRunning.current) return;

        const data = await sendToServer(uri);
        if (!isRunning.current) return;

        if (data.order_commands?.length) {
          commandHandlerRef.current?.(data.order_commands);
        }
        if (data.user_transcript?.trim()) addMessage("user", data.user_transcript.trim());
        if (data.agent_text?.trim()) addMessage("agent", data.agent_text.trim());

        if (data.audio_b64 && isRunning.current) {
          setAgentState("speaking");
          await playAudioBase64(data.audio_b64);
        }

        if (isRunning.current) startRecordLoopRef.current?.();
      } catch (e: any) {
        console.error("[Process]", e?.message ?? e);
        if (isRunning.current) {
          setError(e?.message ?? "Processing failed");
          setAgentState("error");
        }
      }
    },
    [sendToServer, addMessage, playAudioBase64]
  );

  // Wire up mutual refs
  processUtteranceRef.current = processUtterance;
  startRecordLoopRef.current = startRecordLoop;

  // ── Connect / Disconnect ──────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isRunning.current) return;
    setError(null);
    setAgentState("connecting");

    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      setError("Microphone permission denied");
      setAgentState("error");
      return;
    }

    isRunning.current = true;
    sessionId.current = `sess-${Date.now()}`;
    startRecordLoopRef.current?.();
  }, []);

  const disconnect = useCallback(() => {
    isRunning.current = false;
    stopAudio();
    const rec = currentRecording.current;
    if (rec) {
      rec.stopAndUnloadAsync().catch(() => {});
      currentRecording.current = null;
    }
    setAgentState("disconnected");
  }, [stopAudio]);

  const interrupt = useCallback(() => {
    stopAudio();
    if (isRunning.current) startRecordLoopRef.current?.();
  }, [stopAudio]);

  const clearConversation = useCallback(() => {
    setConversation([]);
    setError(null);
    sessionId.current = `sess-${Date.now()}`;
  }, []);

  const isConnected = agentState !== "disconnected" && agentState !== "error";

  return (
    <VoiceAgentContext.Provider
      value={{
        agentState,
        isConnected,
        conversation,
        partialTranscript: "",
        error,
        connect,
        disconnect,
        clearConversation,
        setToolHandler,
        interrupt,
        setCatalog,
        setCurrentOrder,
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
