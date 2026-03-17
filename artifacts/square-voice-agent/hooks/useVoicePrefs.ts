import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useEffect, useCallback } from "react";

export const VOICES = [
  { id: "alloy",   label: "Alloy",   desc: "Neutral" },
  { id: "ash",     label: "Ash",     desc: "Warm" },
  { id: "coral",   label: "Coral",   desc: "Bright" },
  { id: "echo",    label: "Echo",    desc: "Crisp" },
  { id: "fable",   label: "Fable",   desc: "Expressive" },
  { id: "nova",    label: "Nova",    desc: "Energetic" },
  { id: "onyx",    label: "Onyx",    desc: "Deep" },
  { id: "sage",    label: "Sage",    desc: "Calm" },
  { id: "shimmer", label: "Shimmer", desc: "Clear" },
];

export const SPEEDS = [
  { id: 0.9,  label: "Slow" },
  { id: 1.0,  label: "Normal" },
  { id: 1.15, label: "Fast" },
  { id: 1.3,  label: "Fastest" },
];

const VOICE_KEY = "bevpro_voice";
const SPEED_KEY = "bevpro_speed";

export const DEFAULT_VOICE = "nova";
export const DEFAULT_SPEED = 1.15;

export function useVoicePrefs() {
  const [voice, setVoiceState] = useState(DEFAULT_VOICE);
  const [speed, setSpeedState] = useState(DEFAULT_SPEED);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(VOICE_KEY),
      AsyncStorage.getItem(SPEED_KEY),
    ]).then(([v, s]) => {
      if (v) setVoiceState(v);
      if (s) setSpeedState(parseFloat(s));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setVoice = useCallback(async (v: string) => {
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
    return {
      voice: v ?? DEFAULT_VOICE,
      speed: s ? parseFloat(s) : DEFAULT_SPEED,
    };
  } catch {
    return { voice: DEFAULT_VOICE, speed: DEFAULT_SPEED };
  }
}
