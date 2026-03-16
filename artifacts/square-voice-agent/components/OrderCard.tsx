import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { OrderLineItem } from "@/context/OrderContext";

interface OrderCardProps {
  lineItem: OrderLineItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

export function OrderCard({ lineItem, onIncrement, onDecrement, onRemove }: OrderCardProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handleIncrement() {
    scale.value = withTiming(1.02, { duration: 60 }, () => {
      scale.value = withTiming(1, { duration: 120 });
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onIncrement();
  }

  function handleDecrement() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDecrement();
  }

  function handleRemove() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRemove();
  }

  const total = lineItem.catalogItem.price * lineItem.quantity;

  return (
    <Animated.View style={[styles.container, animStyle]}>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{lineItem.catalogItem.name}</Text>
        <Text style={styles.unitPrice}>${lineItem.catalogItem.price.toFixed(2)} each</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.total}>${total.toFixed(2)}</Text>
        <View style={styles.controls}>
          <Pressable onPress={handleDecrement} style={styles.controlBtn} testID="decrement-btn">
            <Feather name="minus" size={14} color={Colors.dark.textSecondary} />
          </Pressable>
          <Text style={styles.qty}>{lineItem.quantity}</Text>
          <Pressable onPress={handleIncrement} style={styles.controlBtn} testID="increment-btn">
            <Feather name="plus" size={14} color={Colors.dark.text} />
          </Pressable>
          <Pressable onPress={handleRemove} style={styles.removeBtn} testID="remove-btn">
            <Feather name="x" size={14} color={Colors.dark.danger} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.dark.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  info: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.text,
    marginBottom: 3,
  },
  unitPrice: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  right: {
    alignItems: "flex-end",
    gap: 8,
  },
  total: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.dark.accent,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  controlBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  qty: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.dark.text,
    minWidth: 22,
    textAlign: "center",
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.dark.dangerDim,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
});
