import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useEffect, useCallback } from "react";

export const VOICES = [
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

export const SPEEDS = [
  { id: 0.8,  label: "Slower" },
  { id: 0.9,  label: "Slow" },
  { id: 1.0,  label: "Normal" },
  { id: 1.15, label: "Fast" },
];

const VOICE_KEY = "bevpro_voice";
const SPEED_KEY = "bevpro_speed";

export const DEFAULT_VOICE = "ash";
export const DEFAULT_SPEED = 0.9;

const SUPPORTED_IDS = new Set(VOICES.map((v) => v.id));

export function useVoicePrefs() {
  const [voice, setVoiceState] = useState(DEFAULT_VOICE);
  const [speed, setSpeedState] = useState(DEFAULT_SPEED);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(VOICE_KEY),
      AsyncStorage.getItem(SPEED_KEY),
    ]).then(([v, s]) => {
      if (v && SUPPORTED_IDS.has(v)) setVoiceState(v);
      else if (v) AsyncStorage.removeItem(VOICE_KEY).catch(() => {});
      if (s) setSpeedState(parseFloat(s));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setVoice = useCallback(async (v: string) => {
    if (!SUPPORTED_IDS.has(v)) return;
    setVoiceState(v);
    await AsyncStorage.setItem(VOICE_KEY, v).catch(() => {});
  }, []);

  const setSpeed = useCallback(async (s: number) => {
    setSpeedState(s);
    await AsyncStorage.setItem(SPEED_KEY, s.toString()).catch(() => {});
  }, []);

  return { voice, speed, setVoice, setSpeed, loaded };
}

export async function getVoicePrefs(): Promise<{ voice: string; speed: number }> {
  try {
    const [v, s] = await Promise.all([
      AsyncStorage.getItem(VOICE_KEY),
      AsyncStorage.getItem(SPEED_KEY),
    ]);
    const safeVoice = v && SUPPORTED_IDS.has(v) ? v : DEFAULT_VOICE;
    return {
      voice: safeVoice,
      speed: s ? parseFloat(s) : DEFAULT_SPEED,
    };
  } catch {
    return { voice: DEFAULT_VOICE, speed: DEFAULT_SPEED };
  }
}
