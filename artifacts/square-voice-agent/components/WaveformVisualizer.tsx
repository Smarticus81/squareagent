import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";
import Colors from "@/constants/colors";

interface WaveformVisualizerProps {
  isActive: boolean;
  isSpeaking?: boolean;
  barCount?: number;
  height?: number;
}

interface WaveBarProps {
  index: number;
  isActive: boolean;
  isSpeaking: boolean;
  barCount: number;
  maxHeight: number;
}

function WaveBar({ index, isActive, isSpeaking, barCount, maxHeight }: WaveBarProps) {
  const anim = useSharedValue(0);

  useEffect(() => {
    if (isActive || isSpeaking) {
      const delay = (index / barCount) * 400;
      const duration = 300 + Math.random() * 400;

      anim.value = withDelay(
        delay,
        withRepeat(
          withTiming(1, { duration, easing: Easing.inOut(Easing.sine) }),
          -1,
          true
        )
      );
    } else {
      anim.value = withTiming(0, { duration: 400 });
    }
  }, [isActive, isSpeaking]);

  const animStyle = useAnimatedStyle(() => {
    const minH = maxHeight * 0.15;
    const maxH = maxHeight * (isSpeaking ? 0.9 : 0.7);
    const height = interpolate(anim.value, [0, 1], [minH, maxH]);
    const opacity = interpolate(anim.value, [0, 1], [0.3, 1]);

    return {
      height,
      opacity,
    };
  });

  const color = isSpeaking ? Colors.dark.accent : Colors.dark.micActive;

  return (
    <Animated.View
      style={[
        styles.bar,
        animStyle,
        { backgroundColor: color },
      ]}
    />
  );
}

export function WaveformVisualizer({
  isActive,
  isSpeaking = false,
  barCount = 28,
  height = 60,
}: WaveformVisualizerProps) {
  return (
    <View style={[styles.container, { height }]}>
      {Array.from({ length: barCount }).map((_, i) => (
        <WaveBar
          key={i}
          index={i}
          isActive={isActive}
          isSpeaking={isSpeaking}
          barCount={barCount}
          maxHeight={height}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    minHeight: 4,
  },
});
