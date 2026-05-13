import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Feather } from "@expo/vector-icons";

/**
 * BiometricGate
 *
 * Wraps app contents and refuses to render them until the device user has
 * authenticated locally with Face ID / Touch ID / device passcode. This is a
 * privacy gate, not an account login — assistants are still bound to the user
 * via the bearer token already exchanged via the launch URL.
 *
 * Behaviour:
 *   • If the device has no biometric hardware OR no enrolled biometric, the
 *     gate falls back to device passcode (DEVICE_PASSCODE) or — if neither is
 *     available — passes through automatically (e.g. simulator, web).
 *   • Re-locks whenever the app returns from background.
 */
export function BiometricGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastBackgroundedAt = useRef<number>(0);

  const checkAvailability = useCallback(async () => {
    if (Platform.OS === "web") {
      setAvailable(false);
      setUnlocked(true);
      return false;
    }
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const usable = hasHw && enrolled;
      setAvailable(usable);
      if (!usable) setUnlocked(true); // graceful fallback
      return usable;
    } catch {
      setAvailable(false);
      setUnlocked(true);
      return false;
    }
  }, []);

  const authenticate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock VoyceLab",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });
      if (res.success) {
        setUnlocked(true);
      } else if (res.error !== "user_cancel" && res.error !== "system_cancel") {
        setError("Authentication failed. Try again.");
      }
    } catch {
      setError("Could not start authentication.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    void (async () => {
      const usable = await checkAvailability();
      if (usable) await authenticate();
    })();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-lock on background → foreground transitions.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        lastBackgroundedAt.current = Date.now();
      } else if (next === "active") {
        const since = Date.now() - lastBackgroundedAt.current;
        // Only re-lock if we were backgrounded for more than 30s.
        if (lastBackgroundedAt.current > 0 && since > 30_000 && available) {
          setUnlocked(false);
          void authenticate();
        }
      }
    });
    return () => sub.remove();
  }, [authenticate, available]);

  if (unlocked) return <>{children}</>;

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Feather name="lock" size={28} color="#0A0A0B" />
        </View>
        <Text style={styles.title}>VoyceLab is locked</Text>
        <Text style={styles.subtitle}>
          Unlock with Face ID, Touch ID, or your device passcode to continue.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          onPress={authenticate}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            pressed && { opacity: 0.85 },
            busy && { opacity: 0.6 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Unlock</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  inner: {
    alignItems: "center",
    maxWidth: 340,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(99,102,241,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 22,
    color: "#0A0A0B",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(10,10,11,0.60)",
    textAlign: "center",
    marginBottom: 28,
  },
  error: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "rgba(220,38,38,0.92)",
    marginBottom: 16,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#6366F1",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 180,
    alignItems: "center",
    shadowColor: "#6366F1",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
});
