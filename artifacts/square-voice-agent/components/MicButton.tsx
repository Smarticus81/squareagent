import React, { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface MicButtonProps {
  isRecording: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  onPress: () => void;
  size?: number;
}

export function MicButton({
  isRecording,
  isProcessing,
  isSpeaking,
  onPress,
  size = 80,
}: MicButtonProps) {
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    if (isRecording) {
      pulseScale.value = withRepeat(
        withTiming(2.2, { duration: 1000, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 100 }),
          withTiming(0, { duration: 900 })
        ),
        -1,
        false
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 300 });
      pulseOpacity.value = withTiming(0, { duration: 300 });
    }
  }, [isRecording]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
    position: "absolute",
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: Colors.dark.accent,
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  function handlePressIn() {
    buttonScale.value = withTiming(0.92, { duration: 80 });
  }

  function handlePressOut() {
    buttonScale.value = withTiming(1, { duration: 150 });
  }

  const isActive = isRecording || isSpeaking;
  const bgColor = isRecording
    ? Colors.dark.danger
    : isSpeaking
    ? Colors.dark.accent
    : Colors.dark.surfaceElevated;

  const iconColor = isActive ? "#FFFFFF" : Colors.dark.text;
  const iconName = isRecording ? "mic" : isSpeaking ? "volume-2" : "mic";

  return (
    <View style={styles.wrapper}>
      <Animated.View style={pulseStyle} />
      <Animated.View style={buttonStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isProcessing}
          style={[
            styles.button,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: bgColor,
              opacity: isProcessing ? 0.6 : 1,
              borderWidth: isActive ? 0 : 1.5,
              borderColor: Colors.dark.surfaceBorder,
            },
          ]}
          testID="mic-button"
        >
          <Feather name={iconName} size={size * 0.38} color={iconColor} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.dark.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
});
