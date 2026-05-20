export const VOICES = [
  { id: "alloy", label: "Alloy", desc: "Neutral" },
  { id: "ash", label: "Ash", desc: "Warm" },
  { id: "ballad", label: "Ballad", desc: "Melodic" },
  { id: "cedar", label: "Cedar", desc: "Grounded" },
  { id: "coral", label: "Coral", desc: "Bright" },
  { id: "echo", label: "Echo", desc: "Crisp" },
  { id: "marin", label: "Marin", desc: "Smooth" },
  { id: "sage", label: "Sage", desc: "Calm" },
  { id: "shimmer", label: "Shimmer", desc: "Clear" },
  { id: "verse", label: "Verse", desc: "Expressive" },
] as const;

export const SPEEDS = [
  { id: 0.8, label: "Slow" },
  { id: 0.9, label: "Normal" },
  { id: 1.0, label: "Fast" },
  { id: 1.15, label: "Fastest" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

const SUPPORTED = new Set(VOICES.map((v) => v.id));
const DEFAULT_VOICE: VoiceId = "ash";
const DEFAULT_SPEED = 0.9;

export interface VoicePrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const VOICE_KEY = "voycelab_voice";
const SPEED_KEY = "voycelab_speed";

export function getVoicePrefs(storage: VoicePrefsStorage = localStorage): { voice: string; speed: number } {
  const v = storage.getItem(VOICE_KEY);
  const s = storage.getItem(SPEED_KEY);
  return {
    voice: v && SUPPORTED.has(v as VoiceId) ? v : DEFAULT_VOICE,
    speed: s ? parseFloat(s) : DEFAULT_SPEED,
  };
}

export function setVoicePref(voice: string, storage: VoicePrefsStorage = localStorage) {
  if (SUPPORTED.has(voice as VoiceId)) storage.setItem(VOICE_KEY, voice);
}

export function setSpeedPref(speed: number, storage: VoicePrefsStorage = localStorage) {
  storage.setItem(SPEED_KEY, speed.toString());
}
