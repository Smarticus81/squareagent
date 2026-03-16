import React, { createContext, useContext, useState, useRef, ReactNode } from "react";
import { Platform } from "react-native";

export type AgentState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

interface VoiceAgentContextType {
  agentState: AgentState;
  conversation: ConversationMessage[];
  isRecording: boolean;
  transcript: string;
  agentResponse: string;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  sendTextMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
  cancelSpeaking: () => void;
}

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

let msgCounter = 0;
function genId() {
  return `msg-${Date.now()}-${++msgCounter}`;
}

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/`
    : "http://localhost:3000/";
}

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [agentResponse, setAgentResponse] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cancelRef = useRef(false);
  const conversationRef = useRef<ConversationMessage[]>([]);

  // Web recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Native recording state (loaded lazily)
  const nativeRecorderRef = useRef<any>(null);
  const nativePlayerRef = useRef<any>(null);

  const updateConversation = (updater: (prev: ConversationMessage[]) => ConversationMessage[]) => {
    setConversation(prev => {
      const next = updater(prev);
      conversationRef.current = next;
      return next;
    });
  };

  // ── Web recording via MediaRecorder ──────────────────────────────────────
  async function startWebRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";

    const mr = new MediaRecorder(stream, { mimeType });
    audioChunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mr.start(100);
    mediaRecorderRef.current = mr;
  }

  async function stopWebRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const mr = mediaRecorderRef.current;
      if (!mr) return reject(new Error("No MediaRecorder"));
      mr.onstop = () => {
        const mimeType = mr.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        // Stop all tracks
        mr.stream.getTracks().forEach(t => t.stop());
        resolve(blob);
      };
      mr.stop();
    });
  }

  // ── Native recording via expo-audio ──────────────────────────────────────
  async function getNativeRecorder() {
    if (!nativeRecorderRef.current) {
      const { AudioModule, RecordingPresets } = await import("expo-audio");
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) throw new Error("Microphone permission denied");
      // AudioRecorder is created via the module
      nativeRecorderRef.current = { AudioModule, RecordingPresets };
    }
    return nativeRecorderRef.current;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async function startListening() {
    try {
      setError(null);
      cancelRef.current = false;
      setTranscript("");

      if (Platform.OS === "web") {
        await startWebRecording();
      } else {
        const { AudioModule, RecordingPresets } = await getNativeRecorder();
        const { useAudioRecorder } = await import("expo-audio");
        // For native we use a simple approach with AudioModule directly
        if (!nativeRecorderRef.current.recorder) {
          nativeRecorderRef.current.recorder = new AudioModule.AudioRecorder(
            RecordingPresets.HIGH_QUALITY
          );
        }
        const rec = nativeRecorderRef.current.recorder;
        await rec.prepareToRecordAsync();
        rec.record();
      }

      setIsRecording(true);
      setAgentState("listening");
    } catch (e: any) {
      setError(e.message || "Failed to start recording");
      setAgentState("error");
    }
  }

  async function stopListening() {
    try {
      if (!isRecording) return;
      setIsRecording(false);
      setAgentState("processing");

      if (Platform.OS === "web") {
        const blob = await stopWebRecording();
        await transcribeWebBlob(blob);
      } else {
        const rec = nativeRecorderRef.current?.recorder;
        if (!rec) throw new Error("Recorder not initialized");
        await rec.stop();
        const uri = rec.uri;
        if (!uri) throw new Error("No recording URI");
        await transcribeNativeUri(uri);
      }
    } catch (e: any) {
      setError(e.message || "Failed to stop recording");
      setAgentState("idle");
    }
  }

  async function transcribeWebBlob(blob: Blob) {
    try {
      const baseUrl = getBaseUrl();
      const formData = new FormData();
      // Use the blob's type to determine the file extension
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      formData.append("file", blob, `recording.${ext}`);
      formData.append("model_id", "scribe_v1");

      const response = await fetch(`${baseUrl}api/voice/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Transcription failed (${response.status})`);
      }

      const data = await response.json();
      const text = data.text?.trim() || "";

      if (!text) {
        setError("Couldn't catch that — try speaking again.");
        setAgentState("idle");
        return;
      }

      setTranscript(text);
      await processMessage(text);
    } catch (e: any) {
      setError(e.message || "Transcription failed");
      setAgentState("idle");
    }
  }

  async function transcribeNativeUri(uri: string) {
    try {
      const baseUrl = getBaseUrl();
      const formData = new FormData();
      formData.append("file", { uri, type: "audio/m4a", name: "recording.m4a" } as any);
      formData.append("model_id", "scribe_v1");

      const response = await fetch(`${baseUrl}api/voice/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Transcription failed (${response.status})`);
      }

      const data = await response.json();
      const text = data.text?.trim() || "";

      if (!text) {
        setError("Couldn't catch that — try speaking again.");
        setAgentState("idle");
        return;
      }

      setTranscript(text);
      await processMessage(text);
    } catch (e: any) {
      setError(e.message || "Transcription failed");
      setAgentState("idle");
    }
  }

  async function processMessage(text: string, baseUrl?: string) {
    const base = baseUrl || getBaseUrl();

    const userMsg: ConversationMessage = {
      id: genId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    const currentConvo = conversationRef.current;
    updateConversation(prev => [...prev, userMsg]);
    setAgentState("processing");

    try {
      const history = [
        ...currentConvo.map(m => ({
          role: m.role === "agent" ? "assistant" : "user",
          content: m.content,
        })),
        { role: "user", content: text },
      ];

      let fullText = "";
      let agentMsgAdded = false;
      const agentMsgId = genId();

      const chatResponse = await fetch(`${base}api/voice/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ messages: history }),
      });

      if (!chatResponse.ok) throw new Error("Chat processing failed");

      const reader = chatResponse.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || cancelRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
              setAgentResponse(fullText);
              if (!agentMsgAdded) {
                updateConversation(prev => [
                  ...prev,
                  { id: agentMsgId, role: "agent", content: fullText, timestamp: new Date() },
                ]);
                agentMsgAdded = true;
              } else {
                updateConversation(prev => {
                  const updated = [...prev];
                  const idx = updated.findIndex(m => m.id === agentMsgId);
                  if (idx !== -1) updated[idx] = { ...updated[idx], content: fullText };
                  return updated;
                });
              }
            }
            if (parsed.action) handleAgentAction(parsed.action);
          } catch {}
        }
      }

      if (!cancelRef.current && fullText) {
        setAgentState("speaking");
        await synthesizeAndPlay(fullText, base);
      } else if (!fullText) {
        setAgentState("idle");
      }
    } catch (e: any) {
      setError(e.message || "Agent processing failed");
      setAgentState("idle");
    }
  }

  function handleAgentAction(action: any) {
    if (typeof globalThis !== "undefined" && (globalThis as any).__voiceAgentActionHandler) {
      (globalThis as any).__voiceAgentActionHandler(action);
    }
  }

  async function synthesizeAndPlay(text: string, baseUrl: string) {
    try {
      if (cancelRef.current) { setAgentState("idle"); setAgentResponse(""); return; }

      const ttsResponse = await fetch(`${baseUrl}api/voice/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!ttsResponse.ok) { setAgentState("idle"); setAgentResponse(""); return; }

      if (Platform.OS === "web") {
        const audioBlob = await ttsResponse.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new (globalThis as any).Audio(audioUrl);
        await new Promise<void>(resolve => {
          audio.onended = () => { URL.revokeObjectURL(audioUrl); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(audioUrl); resolve(); };
          audio.play().catch(() => resolve());
        });
      } else {
        const { FileSystem } = await import("expo-file-system");
        const arrayBuffer = await ttsResponse.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        const tmpPath = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(tmpPath, b64, { encoding: FileSystem.EncodingType.Base64 });

        if (!nativePlayerRef.current) {
          const { useAudioPlayer } = await import("expo-audio");
        }
        const { AudioModule } = await import("expo-audio");
        const player = new (AudioModule as any).AudioPlayer(null, 500, false, 0);
        nativePlayerRef.current = player;
        player.replace({ uri: tmpPath });
        player.play();
        await new Promise<void>(resolve => setTimeout(resolve, 30000));
      }
    } catch {}
    if (!cancelRef.current) { setAgentState("idle"); setAgentResponse(""); }
  }

  async function sendTextMessage(text: string) {
    if (!text.trim()) return;
    setError(null);
    setTranscript(text);
    await processMessage(text);
  }

  function cancelSpeaking() {
    cancelRef.current = true;
    setAgentState("idle");
    setAgentResponse("");
  }

  function clearConversation() {
    setConversation([]);
    conversationRef.current = [];
    setTranscript("");
    setAgentResponse("");
    setError(null);
    setAgentState("idle");
  }

  return (
    <VoiceAgentContext.Provider
      value={{
        agentState, conversation, isRecording, transcript,
        agentResponse, error, startListening, stopListening,
        sendTextMessage, clearConversation, cancelSpeaking,
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
