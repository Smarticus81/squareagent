import React, { useEffect } from "react";
import { Pressable, View, StyleSheet } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Rect,
  G,
} from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

const ARect = Animated.createAnimatedComponent(Rect);

export type OrbState =
  | "idle"
  | "wake"
  | "listening"
  | "thinking"
  | "speaking"
  | "connecting"
  | "error";

interface Props {
  state: OrbState;
  onPress?: () => void;
  size?: number;
  /** Retained for backward-compat (no-op). */
  accent?: string;
  accentDeep?: string;
}

/**
 * VoiceOrb (native) — pure waveform that mirrors the assistant's voice.
 *
 *   • When the assistant is speaking, bars rise and fall on a synced phase.
 *     (Until we plumb actual audio levels through the native bridge, this is
 *      a phase-driven proxy gated strictly to `state === "speaking"`.)
 *   • In every other state the bars sit perfectly flat.
 *   • A faint travelling shimmer plays only on `thinking` / `connecting`.
 *   • No halo, reflection, or accent dots — the bars are the entire object.
 */

const BAR_COUNT = 9;
const BAR_COLORS: Array<{ id: string; light: string; dark: string }> = [
  { id: "b0", light: "#7FCBF2", dark: "#4FB1E8" },
  { id: "b1", light: "#8C9CF0", dark: "#5F73E0" },
  { id: "b2", light: "#B58CE6", dark: "#8E64D8" },
  { id: "b3", light: "#FF7AB6", dark: "#FF4D8A" },
  { id: "b4", light: "#FF6B47", dark: "#E04323" },
  { id: "b5", light: "#FF7AB6", dark: "#FF4D8A" },
  { id: "b6", light: "#B58CE6", dark: "#8E64D8" },
  { id: "b7", light: "#8C9CF0", dark: "#5F73E0" },
  { id: "b8", light: "#7FCBF2", dark: "#4FB1E8" },
];

const VB_W = 240;
const VB_H = 120;
const CY = VB_H / 2;
const BAR_W = 8;
const GAP = 10;
const TOTAL_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
const X_START = (VB_W - TOTAL_W) / 2;
const FLAT_H = 5;
const MAX_H = 84;

export function VoiceOrb({ state, onPress, size = 240 }: Props) {
  // Drives all motion. 0..1, looping. Used by both speaking and shimmer.
  const phase = useSharedValue(0);
  // 1 when speaking with energy, 0 when flat. Smoothed.
  const speakAmp = useSharedValue(0);
  // 1 when thinking/connecting shimmer should travel.
  const shimmerAmp = useSharedValue(0);
  const press = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(phase);
    };
  }, [phase]);

  useEffect(() => {
    const targetSpeak = state === "speaking" ? 1 : 0;
    const targetShimmer = state === "thinking" || state === "connecting" ? 1 : 0;
    speakAmp.value = withTiming(targetSpeak, { duration: targetSpeak ? 180 : 320 });
    shimmerAmp.value = withTiming(targetShimmer, { duration: 320 });
  }, [state, speakAmp, shimmerAmp]);

  const dimW = size;
  const dimH = Math.round(size * (VB_H / VB_W));

  const bars = BAR_COLORS.map((_, i) => {
    const phaseOffset = (i / BAR_COUNT) * Math.PI * 2;
    return useAnimatedProps(() => {
      const t = phase.value * Math.PI * 2;
      // Speaking: layered sine waves give a natural-looking voice envelope.
      const wave = Math.sin(t * 4.2 + phaseOffset) * 0.5 + 0.5;
      const detail = Math.sin(t * 2.6 + phaseOffset * 1.6) * 0.18;
      const speakV = Math.max(0, 0.32 + (wave + detail) * 0.38) * speakAmp.value;
      // Shimmer: one travelling head moves across the row in non-speaking
      // thinking/connecting states.
      const head = (phase.value * BAR_COUNT) % BAR_COUNT;
      const distRaw = Math.abs(i - head);
      const dist = Math.min(distRaw, BAR_COUNT - distRaw);
      const shimmerV = Math.max(0, 1 - dist / 2.2) * 0.18 * shimmerAmp.value;
      const v = speakV + shimmerV;
      const h = Math.max(FLAT_H, FLAT_H + v * (MAX_H - FLAT_H));
      return {
        y: CY - h / 2,
        height: h,
      };
    });
  });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.04 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { press.value = withTiming(0, { duration: 220 }); }}
      hitSlop={20}
      style={styles.pressable}
    >
      <Animated.View style={[{ width: dimW, height: dimH }, containerStyle]}>
        <Svg width={dimW} height={dimH} viewBox={`0 0 ${VB_W} ${VB_H}`} style={StyleSheet.absoluteFillObject}>
          <Defs>
            {BAR_COLORS.map((b) => (
              <LinearGradient key={b.id} id={`orb-${b.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={b.light} />
                <Stop offset="100%" stopColor={b.dark} />
              </LinearGradient>
            ))}
          </Defs>
          <G>
            {BAR_COLORS.map((b, i) => (
              <ARect
                key={b.id}
                animatedProps={bars[i]}
                x={X_START + i * (BAR_W + GAP)}
                y={CY - FLAT_H / 2}
                width={BAR_W}
                height={FLAT_H}
                rx={BAR_W / 2}
                ry={BAR_W / 2}
                fill={`url(#orb-${b.id})`}
                opacity={state === "idle" ? 0.78 : 1}
              />
            ))}
          </G>
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
});

void View;
