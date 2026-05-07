import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useEffect, useCallback, useMemo } from "react";

export interface VoiceOption {
  id: string;
  label: string;
  desc: string;
}

export const OPENAI_VOICES: VoiceOption[] = [
  { id: "alloy",   label: "Alloy",   desc: "Neutral" },
  { id: "ash",     label: "Ash",     desc: "Warm" },
  { id: "ballad",  label: "Ballad",  desc: "Melodic" },
  { id: "cedar",   label: "Cedar",   desc: "Grounded" },
  { id: "coral",   label: "Coral",   desc: "Bright" },
  { id: "echo",    label: "Echo",    desc: "Crisp" },
  { id: "marin",   label: "Marin",   desc: "Smooth" },
  { id: "sage",    label: "Sage",    desc: "Calm" },
  { id: "shimmer", label: "Shimmer", desc: "Clear" },
  { id: "verse",   label: "Verse",   desc: "Expressive" },
];

export const VOICES = OPENAI_VOICES;

const VOICE_OPTIONS_BY_PROVIDER: Record<string, VoiceOption[]> = {
  openai_realtime_webrtc: OPENAI_VOICES,
  openai_realtime_server_ws: OPENAI_VOICES,
  google_gemini_3_1_flash_live: [
    { id: "Kore", label: "Kore", desc: "Firm" },
    { id: "Aoede", label: "Aoede", desc: "Bright" },
    { id: "Puck", label: "Puck", desc: "Playful" },
    { id: "Charon", label: "Charon", desc: "Deep" },
    { id: "Leda", label: "Leda", desc: "Smooth" },
    { id: "Fenrir", label: "Fenrir", desc: "Bold" },
  ],
  google_gemini_2_5_flash_native_audio: [
    { id: "Aoede", label: "Aoede", desc: "Bright" },
    { id: "Kore", label: "Kore", desc: "Firm" },
    { id: "Puck", label: "Puck", desc: "Playful" },
    { id: "Zephyr", label: "Zephyr", desc: "Airy" },
    { id: "Charon", label: "Charon", desc: "Deep" },
    { id: "Leda", label: "Leda", desc: "Smooth" },
  ],
  google_gemini_live_native_audio: [
    { id: "Aoede", label: "Aoede", desc: "Bright" },
    { id: "Kore", label: "Kore", desc: "Firm" },
    { id: "Puck", label: "Puck", desc: "Playful" },
    { id: "Zephyr", label: "Zephyr", desc: "Airy" },
  ],
  deepgram_voice_agent_api: [
    { id: "asteria", label: "Asteria", desc: "Clear" },
    { id: "luna", label: "Luna", desc: "Warm" },
    { id: "stella", label: "Stella", desc: "Bright" },
    { id: "athena", label: "Athena", desc: "Steady" },
  ],
  elevenlabs_agents: [
    { id: "Rachel", label: "Rachel", desc: "Natural" },
    { id: "Bella", label: "Bella", desc: "Expressive" },
    { id: "Antoni", label: "Antoni", desc: "Calm" },
    { id: "Domi", label: "Domi", desc: "Energetic" },
  ],
  hume_evi_3: [
    { id: "ITO", label: "ITO", desc: "Expressive" },
    { id: "KORA", label: "KORA", desc: "Warm" },
    { id: "AURA", label: "AURA", desc: "Calm" },
  ],
  livekit_agents: OPENAI_VOICES,
  pipecat: OPENAI_VOICES,
  deepgram_flux_cartesia: OPENAI_VOICES,
  deepgram_flux_aura: OPENAI_VOICES,
  cartesia_ink_sonic: OPENAI_VOICES,
  assemblyai_openai_cartesia: OPENAI_VOICES,
  custom_modular_pipeline: OPENAI_VOICES,
};

const DEFAULT_VOICE_BY_PROVIDER: Record<string, string> = {
  openai_realtime_webrtc: "ash",
  openai_realtime_server_ws: "ash",
  google_gemini_3_1_flash_live: "Kore",
  google_gemini_2_5_flash_native_audio: "Aoede",
  google_gemini_live_native_audio: "Aoede",
  deepgram_voice_agent_api: "asteria",
  elevenlabs_agents: "Rachel",
  hume_evi_3: "ITO",
  livekit_agents: "alloy",
  pipecat: "alloy",
};

export function getVoiceProviderLabel(provider?: string | null): string {
  switch (provider) {
    case "openai_realtime_webrtc": return "OpenAI Realtime";
    case "openai_realtime_server_ws": return "OpenAI Realtime (WS)";
    case "google_gemini_3_1_flash_live": return "Gemini 3.1 Flash Live";
    case "google_gemini_2_5_flash_native_audio": return "Gemini 2.5 Flash Audio";
    case "google_gemini_live_native_audio": return "Gemini Live";
    case "hume_evi_3": return "Hume EVI 3";
    case "elevenlabs_agents": return "ElevenLabs";
    case "deepgram_voice_agent_api": return "Deepgram Voice Agent";
    case "livekit_agents": return "LiveKit Agents";
    case "pipecat": return "Pipecat";
    case "deepgram_flux_cartesia": return "Deepgram + Cartesia";
    case "deepgram_flux_aura": return "Deepgram Flux + Aura";
    case "cartesia_ink_sonic": return "Cartesia Ink + Sonic";
    case "assemblyai_openai_cartesia": return "AssemblyAI + OpenAI + Cartesia";
    case "custom_modular_pipeline": return "Custom Pipeline";
    case "browser_speech_api_fallback": return "Browser Speech";
    case "push_to_talk_text_fallback": return "Push-to-talk";
    case "text_only_fallback": return "Text only";
    default: return provider ?? "OpenAI Realtime";
  }
}

export const SPEEDS = [
  { id: 0.8,  label: "Slower" },
  { id: 0.9,  label: "Slow" },
  { id: 1.0,  label: "Normal" },
  { id: 1.15, label: "Fast" },
];

const VOICE_KEY = "voycelab_voice";
const SPEED_KEY = "voycelab_speed";

export const DEFAULT_VOICE = "ash";
export const DEFAULT_SPEED = 0.9;

function configuredVoice(config?: Record<string, unknown> | null): string | null {
  return typeof config?.voice === "string" && config.voice.trim() ? config.voice.trim() : null;
}

export function getVoiceOptionsForProvider(
  provider?: string | null,
  config?: Record<string, unknown> | null,
): VoiceOption[] {
  const configured = configuredVoice(config);
  const base = VOICE_OPTIONS_BY_PROVIDER[provider ?? ""] ?? OPENAI_VOICES;
  if (!configured || base.some((v) => v.id === configured)) return base;
  return [{ id: configured, label: configured, desc: "Configured" }, ...base];
}

export function getDefaultVoiceForProvider(
  provider?: string | null,
  config?: Record<string, unknown> | null,
): string {
  const configured = configuredVoice(config);
  if (configured) return configured;
  return DEFAULT_VOICE_BY_PROVIDER[provider ?? ""] ?? DEFAULT_VOICE;
}

export function useVoicePrefs(provider?: string | null, config?: Record<string, unknown> | null) {
  const defaultVoice = useMemo(() => getDefaultVoiceForProvider(provider, config), [provider, config]);
  const voices = useMemo(() => getVoiceOptionsForProvider(provider, config), [provider, config]);
  const supportedIds = useMemo(() => new Set(voices.map((v) => v.id)), [voices]);
  const [voice, setVoiceState] = useState(defaultVoice);
  const [speed, setSpeedState] = useState(DEFAULT_SPEED);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(VOICE_KEY),
      AsyncStorage.getItem(SPEED_KEY),
    ]).then(([v, s]) => {
      if (v && supportedIds.has(v)) setVoiceState(v);
      else setVoiceState(defaultVoice);
      if (s) setSpeedState(parseFloat(s));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [defaultVoice, supportedIds]);

  const setVoice = useCallback(async (v: string) => {
    if (!supportedIds.has(v)) return;
    setVoiceState(v);
    await AsyncStorage.setItem(VOICE_KEY, v).catch(() => {});
  }, [supportedIds]);

  const setSpeed = useCallback(async (s: number) => {
    setSpeedState(s);
    await AsyncStorage.setItem(SPEED_KEY, s.toString()).catch(() => {});
  }, []);

  return { voice, speed, setVoice, setSpeed, loaded, voices };
}

export async function getVoicePrefs(
  provider?: string | null,
  config?: Record<string, unknown> | null,
): Promise<{ voice: string; speed: number }> {
  try {
    const [v, s] = await Promise.all([
      AsyncStorage.getItem(VOICE_KEY),
      AsyncStorage.getItem(SPEED_KEY),
    ]);
    const options = getVoiceOptionsForProvider(provider, config);
    const supportedIds = new Set(options.map((option) => option.id));
    const safeVoice = v && supportedIds.has(v) ? v : getDefaultVoiceForProvider(provider, config);
    return {
      voice: safeVoice,
      speed: s ? parseFloat(s) : DEFAULT_SPEED,
    };
  } catch {
    return { voice: getDefaultVoiceForProvider(provider, config), speed: DEFAULT_SPEED };
  }
}
