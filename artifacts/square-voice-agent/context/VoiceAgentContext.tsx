import React, { createContext, useContext, useState, useRef, ReactNode } from "react";
import { fetch } from "expo/fetch";
import { Platform } from "react-native";
import { useAudioRecorder, RecordingPresets, AudioModule, useAudioPlayer } from "expo-audio";

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
  msgCounter++;
  return `msg-${Date.now()}-${msgCounter}-${Math.random().toString(36).substr(2, 9)}`;
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

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer(null);
  const cancelRef = useRef(false);
  const conversationRef = useRef<ConversationMessage[]>([]);

  // Keep ref in sync with state
  const updateConversation = (updater: (prev: ConversationMessage[]) => ConversationMessage[]) => {
    setConversation(prev => {
      const next = updater(prev);
      conversationRef.current = next;
      return next;
    });
  };

  async function startListening() {
    try {
      setError(null);
      cancelRef.current = false;

      if (Platform.OS !== "web") {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (!status.granted) {
          setError("Microphone permission denied");
          return;
        }
      }

      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setAgentState("listening");
      setTranscript("");
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

      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) {
        throw new Error("No recording found");
      }

      await transcribeAndProcess(uri);
    } catch (e: any) {
      setError(e.message || "Failed to process recording");
      setAgentState("error");
    }
  }

  async function transcribeAndProcess(audioUri: string) {
    try {
      const baseUrl = getBaseUrl();
      const formData = new FormData();

      if (Platform.OS === "web") {
        const blobResponse = await globalThis.fetch(audioUri);
        const blob = await blobResponse.blob();
        formData.append("audio", blob, "recording.webm");
        formData.append("model_id", "scribe_v1");
      } else {
        formData.append("audio", {
          uri: audioUri,
          type: "audio/m4a",
          name: "recording.m4a",
        } as any);
        formData.append("model_id", "scribe_v1");
      }

      const sttResponse = await fetch(`${baseUrl}api/voice/transcribe`, {
        method: "POST",
        body: formData,
      });

      let userText = "";
      if (sttResponse.ok) {
        const sttData = await sttResponse.json();
        userText = sttData.text?.trim() || "";
      }

      if (!userText) {
        // Fallback if STT fails
        setAgentState("idle");
        setError("Could not transcribe audio. Try speaking again or type your order.");
        return;
      }

      setTranscript(userText);
      await processMessage(userText, baseUrl);
    } catch (e: any) {
      setError(e.message || "Voice processing failed");
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

    // Capture current conversation for API call
    const currentConvo = conversationRef.current;
    updateConversation((prev) => [...prev, userMsg]);
    setAgentState("processing");

    try {
      const history = [
        ...currentConvo.map((m) => ({
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
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
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
                updateConversation((prev) => [
                  ...prev,
                  { id: agentMsgId, role: "agent", content: fullText, timestamp: new Date() },
                ]);
                agentMsgAdded = true;
              } else {
                updateConversation((prev) => {
                  const updated = [...prev];
                  const idx = updated.findIndex((m) => m.id === agentMsgId);
                  if (idx !== -1) {
                    updated[idx] = { ...updated[idx], content: fullText };
                  }
                  return updated;
                });
              }
            }

            if (parsed.action) {
              handleAgentAction(parsed.action);
            }
          } catch {}
        }
      }

      if (!cancelRef.current && fullText) {
        setAgentState("speaking");
        await synthesizeAndPlay(fullText, base);
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
      if (cancelRef.current) {
        setAgentState("idle");
        return;
      }

      const ttsResponse = await fetch(`${baseUrl}api/voice/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!ttsResponse.ok) {
        setAgentState("idle");
        setAgentResponse("");
        return;
      }

      if (Platform.OS === "web") {
        const audioBlob = await ttsResponse.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new globalThis.Audio(audioUrl);
        audio.onended = () => {
          if (!cancelRef.current) {
            setAgentState("idle");
            setAgentResponse("");
          }
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          setAgentState("idle");
          setAgentResponse("");
        };
        await audio.play();
      } else {
        // Native: write audio to file and play
        const { FileSystem } = await import("expo-file-system");

        const arrayBuffer = await ttsResponse.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        const tempPath = `${FileSystem.cacheDirectory}tts_out.mp3`;
        await FileSystem.writeAsStringAsync(tempPath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        audioPlayer.replace({ uri: tempPath });
        audioPlayer.play();

        // Poll for playback completion
        const checkInterval = setInterval(() => {
          if (audioPlayer.status === "idle" || !audioPlayer.playing) {
            clearInterval(checkInterval);
            if (!cancelRef.current) {
              setAgentState("idle");
              setAgentResponse("");
            }
          }
        }, 500);

        setTimeout(() => {
          clearInterval(checkInterval);
          if (!cancelRef.current) {
            setAgentState("idle");
            setAgentResponse("");
          }
        }, 30000);
      }
    } catch (e) {
      setAgentState("idle");
      setAgentResponse("");
    }
  }

  async function sendTextMessage(text: string) {
    if (!text.trim()) return;
    setError(null);
    setTranscript(text);
    await processMessage(text);
  }

  function cancelSpeaking() {
    cancelRef.current = true;
    if (Platform.OS !== "web") {
      audioPlayer.pause();
    }
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
        agentState,
        conversation,
        isRecording,
        transcript,
        agentResponse,
        error,
        startListening,
        stopListening,
        sendTextMessage,
        clearConversation,
        cancelSpeaking,
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
