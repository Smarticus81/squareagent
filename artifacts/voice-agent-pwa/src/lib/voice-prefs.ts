/** Voice preference helpers — localStorage-backed */

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
];

export const SPEEDS = [
  { id: 0.9, label: "Slow" },
  { id: 1.0, label: "Normal" },
  { id: 1.15, label: "Fast" },
  { id: 1.3, label: "Fastest" },
];

const VOICE_KEY = "bevpro_voice";
const SPEED_KEY = "bevpro_speed";
const DEFAULT_VOICE = "echo";
const DEFAULT_SPEED = 1.15;
const SUPPORTED = new Set(VOICES.map((v) => v.id));

export function getVoicePrefs(): { voice: string; speed: number } {
  const v = localStorage.getItem(VOICE_KEY);
  const s = localStorage.getItem(SPEED_KEY);
  return {
    voice: v && SUPPORTED.has(v) ? v : DEFAULT_VOICE,
    speed: s ? parseFloat(s) : DEFAULT_SPEED,
  };
}

export function setVoicePref(voice: string) {
  if (SUPPORTED.has(voice)) localStorage.setItem(VOICE_KEY, voice);
}

export function setSpeedPref(speed: number) {
  localStorage.setItem(SPEED_KEY, speed.toString());
}
