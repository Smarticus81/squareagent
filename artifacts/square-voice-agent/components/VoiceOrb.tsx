import React, { useEffect, useRef } from "react";
import { Pressable, View, StyleSheet } from "react-native";
import Svg, {
  Defs,
  RadialGradient,
  LinearGradient,
  Stop,
  Ellipse,
  Rect,
  Circle,
  Mask,
  G,
} from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";

const ARect = Animated.createAnimatedComponent(Rect);
const AEllipse = Animated.createAnimatedComponent(Ellipse);
const ACircle = Animated.createAnimatedComponent(Circle);

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
  /** Retained for backward-compat; the new design uses a fixed pastel rainbow. */
  accent?: string;
  accentDeep?: string;
}

/**
 * VoiceOrb (native) — pastel rainbow waveform on a soft glowing halo.
 *
 * Matches the visual identity used in the PWA and the landing demo. Uses a
 * single Reanimated `progress` shared value (0..1, looping) plus a per-state
 * intensity to drive bar heights without a per-frame JS callback.
 */

const BAR_COUNT = 7;
const BAR_COLORS: Array<{ id: string; light: string; dark: string }> = [
  { id: "b0", light: "#FFB37A", dark: "#FF9A5C" },
  { id: "b1", light: "#FF9AA2", dark: "#FF6B7A" },
  { id: "b2", light: "#FF7AB6", dark: "#FF4D8A" },
  { id: "b3", light: "#E97FD8", dark: "#D158C0" },
  { id: "b4", light: "#B58CE6", dark: "#8E64D8" },
  { id: "b5", light: "#8C9CF0", dark: "#5F73E0" },
  { id: "b6", light: "#7FCBF2", dark: "#4FB1E8" },
];

// viewBox 240×240, baseline at y=120
const VB = 240;
const CY = 120;
const BAR_W = 10;
const GAP = 10;
const MAX_H = 96;
const TOTAL_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
const X_START = (VB - TOTAL_W) / 2;

function stateIntensity(state: OrbState): { base: number; amp: number; speed: number } {
  switch (state) {
    case "speaking":  return { base: 0.45, amp: 0.45, speed: 4.2 };
    case "listening": return { base: 0.3,  amp: 0.22, speed: 2.4 };
    case "thinking":  return { base: 0.42, amp: 0.32, speed: 3.4 };
    case "wake":      return { base: 0.5,  amp: 0.3,  speed: 3.0 };
    case "connecting":return { base: 0.32, amp: 0.22, speed: 2.6 };
    case "error":     return { base: 0.5,  amp: 0.28, speed: 5.5 };
    default:          return { base: 0.18, amp: 0.12, speed: 1.2 };
  }
}

export function VoiceOrb({ state, onPress, size = 240 }: Props) {
  const intensity = stateIntensity(state);

  // Continuous time driver: 0 → 2π over a couple seconds, repeating.
  const phase = useSharedValue(0);
  // Per-state intensity values, smoothly tweened on state change.
  const base = useSharedValue(intensity.base);
  const amp = useSharedValue(intensity.amp);
  const speed = useSharedValue(intensity.speed);
  const press = useSharedValue(0);
  const dotPulse = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 4000, easing: Easing.linear }),
      -1,
      false,
    );
    dotPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(phase);
      cancelAnimation(dotPulse);
    };
  }, [phase, dotPulse]);

  useEffect(() => {
    base.value = withTiming(intensity.base, { duration: 360 });
    amp.value = withTiming(intensity.amp, { duration: 360 });
    speed.value = withTiming(intensity.speed, { duration: 360 });
  }, [state, intensity.base, intensity.amp, intensity.speed, base, amp, speed]);

  // Build animated props for each bar (top + reflection).
  const bars = BAR_COLORS.map((_, i) => {
    const phaseOffset = (i / BAR_COUNT) * Math.PI * 2;
    const top = useAnimatedProps(() => {
      const t = phase.value * speed.value;
      const wave = Math.sin(t + phaseOffset) * 0.5 + 0.5;
      const detail = Math.sin(t * 0.55 + phaseOffset * 1.6) * 0.16;
      const v = Math.max(0.06, base.value + (wave + detail) * amp.value);
      const h = Math.max(4, v * MAX_H);
      return {
        y: CY - h,
        height: h,
      };
    });
    const refl = useAnimatedProps(() => {
      const t = phase.value * speed.value;
      const wave = Math.sin(t + phaseOffset) * 0.5 + 0.5;
      const detail = Math.sin(t * 0.55 + phaseOffset * 1.6) * 0.16;
      const v = Math.max(0.06, base.value + (wave + detail) * amp.value);
      const h = Math.max(4, v * MAX_H);
      return {
        height: h * 0.55,
      };
    });
    return { top, refl };
  });

  const haloProps = useAnimatedProps(() => {
    const e = (base.value + amp.value * 0.5);
    return {
      rx: 100 + e * 18,
      ry: 76 + e * 14,
      opacity: 0.62 + e * 0.32,
    };
  });

  const dotLeftProps = useAnimatedProps(() => ({
    r: 4.4 + dotPulse.value * 1.2,
  }));
  const dotRightProps = useAnimatedProps(() => ({
    r: 4.4 + (1 - dotPulse.value) * 1.2,
  }));

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
      <Animated.View style={[{ width: size, height: size }, containerStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} style={StyleSheet.absoluteFillObject}>
          <Defs>
            <RadialGradient id="orb-halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FFD8C2" stopOpacity="0.95" />
              <Stop offset="35%" stopColor="#FFB7D0" stopOpacity="0.75" />
              <Stop offset="70%" stopColor="#C9B8EE" stopOpacity="0.5" />
              <Stop offset="100%" stopColor="#A6D5F2" stopOpacity="0" />
            </RadialGradient>

            {BAR_COLORS.map((b) => (
              <LinearGradient key={b.id} id={`orb-${b.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={b.light} />
                <Stop offset="100%" stopColor={b.dark} />
              </LinearGradient>
            ))}

            <LinearGradient id="orb-refl" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>

            <Mask id="orb-reflmask">
              <Rect x={0} y={CY} width={VB} height={VB - CY} fill="url(#orb-refl)" />
            </Mask>
          </Defs>

          {/* Halo */}
          <AEllipse
            animatedProps={haloProps}
            cx={VB / 2}
            cy={CY}
            rx={100}
            ry={76}
            fill="url(#orb-halo)"
          />

          {/* Bars (top) */}
          <G>
            {BAR_COLORS.map((b, i) => (
              <ARect
                key={`top-${b.id}`}
                animatedProps={bars[i].top}
                x={X_START + i * (BAR_W + GAP)}
                y={CY - 40}
                width={BAR_W}
                height={40}
                rx={BAR_W / 2}
                ry={BAR_W / 2}
                fill={`url(#orb-${b.id})`}
              />
            ))}
          </G>

          {/* Bars (reflection) */}
          <G mask="url(#orb-reflmask)">
            {BAR_COLORS.map((b, i) => (
              <ARect
                key={`refl-${b.id}`}
                animatedProps={bars[i].refl}
                x={X_START + i * (BAR_W + GAP)}
                y={CY + 4}
                width={BAR_W}
                height={22}
                rx={BAR_W / 2}
                ry={BAR_W / 2}
                fill={`url(#orb-${b.id})`}
              />
            ))}
          </G>

          {/* Accent dots */}
          <ACircle animatedProps={dotLeftProps} cx={26} cy={CY} r={4.6} fill="#FF8A4A" />
          <ACircle animatedProps={dotRightProps} cx={VB - 26} cy={CY} r={4.6} fill="#5FB7E8" />
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

// Suppress unused-import warning when nothing else references View.
void View;
