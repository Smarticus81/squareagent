import React, { useEffect } from "react";
import { Pressable, View, StyleSheet } from "react-native";
import Svg, {
  Defs,
  RadialGradient,
  Stop,
  Circle,
  Ellipse,
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
  interpolate,
} from "react-native-reanimated";

const ACircle = Animated.createAnimatedComponent(Circle);
const AG = Animated.createAnimatedComponent(G);
const AEllipse = Animated.createAnimatedComponent(Ellipse);

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
  accent?: string;
  accentDeep?: string;
}

/**
 * VoiceOrb (native) — fluid, mercury-style orb built from layered radial
 * gradients animated with Reanimated. No goo filter (RN SVG limitation),
 * but five staggered concentric blobs + drifting highlight + breathing halo
 * deliver a premium, frontier-grade voice surface.
 */
export function VoiceOrb({
  state,
  onPress,
  size = 240,
  accent = "#6366F1",
  accentDeep = "#4F46E5",
}: Props) {
  // Per-state intensity targets
  const intensity = stateIntensity(state);

  const breath = useSharedValue(0);     // 0..1 slow sine
  const swirl = useSharedValue(0);      // continuous rotation
  const pulse = useSharedValue(0);      // 0..1 quick pulse for thinking/error
  const energy = useSharedValue(intensity.energy);
  const accentMix = useSharedValue(0);  // not yet used
  const press = useSharedValue(0);

  // Continuous breathing + rotation
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    swirl.value = withRepeat(
      withTiming(360, { duration: 16000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(breath);
      cancelAnimation(swirl);
    };
  }, [breath, swirl]);

  // State-driven energy pulse
  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(energy);
    energy.value = withTiming(intensity.energy, {
      duration: 380,
      easing: Easing.out(Easing.cubic),
    });
    if (state === "thinking") {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else if (state === "speaking") {
      // Faster, irregular pulsing to mimic speech
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
          withTiming(0.35, { duration: 320, easing: Easing.in(Easing.quad) }),
          withTiming(0.85, { duration: 180, easing: Easing.out(Easing.quad) }),
          withTiming(0.2, { duration: 420, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else if (state === "wake") {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 320 }),
          withTiming(0.4, { duration: 480 }),
        ),
        -1,
        false,
      );
    } else if (state === "connecting") {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 540, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 540, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else if (state === "error") {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 90 }),
          withTiming(0, { duration: 90 }),
        ),
        4,
        false,
      );
    } else {
      pulse.value = withTiming(0, { duration: 400 });
    }
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(energy);
    };
  }, [state, intensity.energy, pulse, energy]);

  // ── Animated props ────────────────────────────────────────────────
  const cx = 120;
  const cy = 120;
  const baseR = 46;

  // Halo (outer glow ring)
  const haloProps = useAnimatedProps(() => {
    const e = energy.value;
    const b = breath.value;
    const p = pulse.value;
    return {
      r: 108 + b * 6 + e * 14 + p * 8,
      opacity: 0.18 + e * 0.32 + p * 0.18,
    };
  });

  // 4 mercury blobs at offset phases
  const blobA = useAnimatedProps(() => {
    const b = breath.value;
    const e = energy.value;
    const p = pulse.value;
    const t = swirl.value * (Math.PI / 180);
    const drift = 6 + e * 14 + p * 6;
    return {
      cx: cx + Math.cos(t * 0.9) * drift,
      cy: cy + Math.sin(t * 1.1) * drift,
      r: baseR * (1 + b * 0.05 + e * 0.18 + p * 0.08),
    };
  });
  const blobB = useAnimatedProps(() => {
    const b = breath.value;
    const e = energy.value;
    const p = pulse.value;
    const t = swirl.value * (Math.PI / 180);
    const drift = (6 + e * 14 + p * 6) * 0.9;
    return {
      cx: cx + Math.cos(t * 0.9 + 1.7) * drift,
      cy: cy + Math.sin(t * 1.1 + 2.21) * drift,
      r: baseR * 0.9 * (1 + b * 0.05 + e * 0.18 + p * 0.08),
    };
  });
  const blobC = useAnimatedProps(() => {
    const b = breath.value;
    const e = energy.value;
    const p = pulse.value;
    const t = swirl.value * (Math.PI / 180);
    const drift = (6 + e * 14 + p * 6) * 1.05;
    return {
      cx: cx + Math.cos(t * 0.9 + 3.1) * drift,
      cy: cy + Math.sin(t * 1.1 + 4.03) * drift,
      r: baseR * 0.86 * (1 + b * 0.05 + e * 0.18 + p * 0.08),
    };
  });
  const blobD = useAnimatedProps(() => {
    const b = breath.value;
    const e = energy.value;
    const p = pulse.value;
    const t = swirl.value * (Math.PI / 180);
    const drift = (6 + e * 14 + p * 6) * 0.85;
    return {
      cx: cx + Math.cos(t * 0.9 + 4.6) * drift,
      cy: cy + Math.sin(t * 1.1 + 5.98) * drift,
      r: baseR * 0.95 * (1 + b * 0.05 + e * 0.18 + p * 0.08),
    };
  });

  // Sheen (specular highlight that drifts across surface)
  const sheenProps = useAnimatedProps(() => {
    const b = breath.value;
    const t = swirl.value * (Math.PI / 180);
    return {
      cx: cx - 14 + Math.cos(t * 0.6) * 5,
      cy: cy - 30 + Math.sin(t * 0.7) * 4,
      opacity: 0.18 + b * 0.18,
    };
  });

  // Inner core opacity
  const coreProps = useAnimatedProps(() => {
    const e = energy.value;
    const p = pulse.value;
    return {
      r: 28 + e * 6 + p * 5,
      opacity: 0.55 + e * 0.3 + p * 0.18,
    };
  });

  // Outer ring (subtle)
  const ringProps = useAnimatedProps(() => {
    const b = breath.value;
    const e = energy.value;
    return {
      r: 78 + b * 3 + e * 6,
      opacity: 0.10 + e * 0.18,
    };
  });

  // Container press scale
  const containerStyle = useAnimatedStyle(() => {
    const e = energy.value;
    const p = pulse.value;
    const scale =
      (1 + e * 0.04 + p * 0.03) * (1 - press.value * 0.05);
    return { transform: [{ scale }] };
  });

  // Color: amber for thinking, red for error, indigo otherwise
  const accentColor =
    state === "thinking"
      ? "#F2A33A"
      : state === "error"
        ? "#E45757"
        : state === "connecting"
          ? accentDeep
          : accent;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: 90 });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: 220 });
      }}
      hitSlop={20}
      style={styles.pressable}
    >
      <Animated.View style={[{ width: size, height: size }, containerStyle]}>
        <Svg
          width={size}
          height={size}
          viewBox="0 0 240 240"
          style={StyleSheet.absoluteFillObject}
        >
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={accentColor} stopOpacity="0.55" />
              <Stop offset="55%" stopColor={accentColor} stopOpacity="0.18" />
              <Stop offset="100%" stopColor={accentColor} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="core" cx="35%" cy="28%" r="80%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <Stop offset="22%" stopColor="#FFFFFF" stopOpacity="0.55" />
              <Stop offset="55%" stopColor={accentColor} stopOpacity="0.95" />
              <Stop offset="100%" stopColor="#0A0A0B" stopOpacity="0.85" />
            </RadialGradient>
            <RadialGradient id="ring" cx="50%" cy="50%" r="50%">
              <Stop offset="80%" stopColor={accentColor} stopOpacity="0" />
              <Stop offset="92%" stopColor={accentColor} stopOpacity="0.6" />
              <Stop offset="100%" stopColor={accentColor} stopOpacity="0" />
            </RadialGradient>
          </Defs>

          {/* Outer halo (drop-glow proxy) */}
          <ACircle
            animatedProps={haloProps}
            cx={cx}
            cy={cy}
            r={108}
            fill="url(#halo)"
          />
          {/* Subtle ring */}
          <ACircle
            animatedProps={ringProps}
            cx={cx}
            cy={cy}
            r={78}
            fill="url(#ring)"
          />

          {/* Mercury blobs — overlapped with multiply-ish opacity to fake goo */}
          <AG opacity={0.95}>
            <ACircle animatedProps={blobA} cx={cx} cy={cy} r={baseR} fill="url(#core)" />
            <ACircle animatedProps={blobB} cx={cx} cy={cy} r={baseR * 0.9} fill="url(#core)" />
            <ACircle animatedProps={blobC} cx={cx} cy={cy} r={baseR * 0.86} fill="url(#core)" />
            <ACircle animatedProps={blobD} cx={cx} cy={cy} r={baseR * 0.95} fill="url(#core)" />
          </AG>

          {/* Specular highlight */}
          <AEllipse
            animatedProps={sheenProps}
            cx={cx - 14}
            cy={cy - 30}
            rx={26}
            ry={16}
            fill="#FFFFFF"
            opacity={0.22}
          />

          {/* Crisp inner core */}
          <ACircle
            animatedProps={coreProps}
            cx={cx}
            cy={cy}
            r={28}
            fill="url(#core)"
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

function stateIntensity(state: OrbState): { energy: number } {
  switch (state) {
    case "speaking":
      return { energy: 0.85 };
    case "listening":
      return { energy: 0.6 };
    case "thinking":
      return { energy: 0.5 };
    case "wake":
      return { energy: 0.55 };
    case "connecting":
      return { energy: 0.3 };
    case "error":
      return { energy: 0.7 };
    default:
      return { energy: 0.12 };
  }
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
});

// Silence unused interpolate warning if tree-shaken later
void interpolate;
