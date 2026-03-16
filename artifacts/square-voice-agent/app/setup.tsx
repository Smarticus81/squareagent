import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import Colors from "@/constants/colors";
import { useSquare } from "@/context/SquareContext";

const WEB_TOP_INSET = 67;
const WEB_BOTTOM_INSET = 34;

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const { setCredentials, clearCredentials, isConfigured, accessToken, locationId, locations, loadCatalog, catalogItems, isLoadingCatalog, catalogError } = useSquare();

  const [token, setToken] = useState(accessToken || "");
  const [locId, setLocId] = useState(locationId || "");
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;

  async function handleConnect() {
    if (!token.trim()) {
      setTestResult({ success: false, message: "Please enter your Square access token" });
      return;
    }
    if (!locId.trim()) {
      setTestResult({ success: false, message: "Please enter your Square location ID" });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      await setCredentials(token.trim(), locId.trim());
      await loadCatalog();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTestResult({
        success: true,
        message: `Connected! Found ${catalogItems.length} catalog items.`,
      });
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || "Connection failed" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDisconnect() {
    await clearCredentials();
    setToken("");
    setLocId("");
    setTestResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  return (
    <View style={[styles.root, { backgroundColor: Colors.dark.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={Colors.dark.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Square Setup</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Status Badge */}
        <Animated.View entering={FadeInDown.duration(300)} style={styles.statusCard}>
          <View style={[styles.statusDot, { backgroundColor: isConfigured ? Colors.dark.accent : Colors.dark.textMuted }]} />
          <Text style={styles.statusLabel}>
            {isConfigured ? "Connected to Square" : "Not connected"}
          </Text>
        </Animated.View>

        {/* Info Card */}
        <Animated.View entering={FadeInDown.delay(60).duration(300)} style={styles.infoCard}>
          <Feather name="info" size={16} color={Colors.dark.accent} />
          <Text style={styles.infoText}>
            Get your access token and location ID from the Square Developer Dashboard at{" "}
            <Text style={styles.infoLink}>developer.squareup.com</Text>
          </Text>
        </Animated.View>

        {/* Token Input */}
        <Animated.View entering={FadeInDown.delay(120).duration(300)}>
          <Text style={styles.label}>Access Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="EAAAxxxxxxxxxxxxxxx..."
            placeholderTextColor={Colors.dark.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="next"
          />
        </Animated.View>

        {/* Location ID Input */}
        <Animated.View entering={FadeInDown.delay(180).duration(300)}>
          <Text style={styles.label}>Location ID</Text>
          <TextInput
            style={styles.input}
            value={locId}
            onChangeText={setLocId}
            placeholder="LBxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor={Colors.dark.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleConnect}
          />
        </Animated.View>

        {/* Test Result */}
        {testResult && (
          <Animated.View
            entering={FadeInDown.duration(200)}
            style={[
              styles.resultCard,
              testResult.success ? styles.resultSuccess : styles.resultError,
            ]}
          >
            <Feather
              name={testResult.success ? "check-circle" : "alert-circle"}
              size={16}
              color={testResult.success ? Colors.dark.accent : Colors.dark.danger}
            />
            <Text style={[styles.resultText, { color: testResult.success ? Colors.dark.accent : Colors.dark.danger }]}>
              {testResult.message}
            </Text>
          </Animated.View>
        )}

        {catalogError && (
          <View style={[styles.resultCard, styles.resultError]}>
            <Feather name="alert-triangle" size={16} color={Colors.dark.danger} />
            <Text style={[styles.resultText, { color: Colors.dark.danger }]}>{catalogError}</Text>
          </View>
        )}

        {/* Connect Button */}
        <Pressable
          onPress={handleConnect}
          disabled={isLoading}
          style={[styles.connectBtn, { opacity: isLoading ? 0.7 : 1 }]}
          testID="connect-btn"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.dark.background} />
          ) : (
            <>
              <Feather name="link" size={18} color={Colors.dark.background} />
              <Text style={styles.connectBtnText}>
                {isConfigured ? "Update Connection" : "Connect Square"}
              </Text>
            </>
          )}
        </Pressable>

        {isConfigured && (
          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
            <Feather name="link-2" size={16} color={Colors.dark.danger} />
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        )}

        {/* Catalog Stats */}
        {isConfigured && (
          <Animated.View entering={FadeInDown.delay(100).duration(300)} style={styles.statsCard}>
            <View style={styles.statsRow}>
              <Feather name="package" size={16} color={Colors.dark.accent} />
              <Text style={styles.statsLabel}>Catalog Items</Text>
              {isLoadingCatalog ? (
                <ActivityIndicator size="small" color={Colors.dark.accent} />
              ) : (
                <Text style={styles.statsValue}>{catalogItems.length}</Text>
              )}
            </View>
            <Pressable onPress={loadCatalog} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={14} color={Colors.dark.textSecondary} />
              <Text style={styles.refreshText}>Refresh catalog</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Sandbox Mode Notice */}
        <Animated.View entering={FadeInDown.delay(240).duration(300)} style={styles.sandboxCard}>
          <Feather name="shield" size={16} color={Colors.dark.warning} />
          <Text style={styles.sandboxText}>
            Use your Square Sandbox credentials for testing. Switch to Production tokens when ready to go live.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    color: Colors.dark.text,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 16,
    paddingTop: 4,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.text,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.dark.accentSubtle,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.accentDim,
  },
  infoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  infoLink: {
    color: Colors.dark.accent,
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
    marginLeft: 2,
  },
  input: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  resultSuccess: {
    backgroundColor: Colors.dark.accentSubtle,
    borderWidth: 1,
    borderColor: Colors.dark.accentDim,
  },
  resultError: {
    backgroundColor: Colors.dark.dangerDim,
    borderWidth: 1,
    borderColor: Colors.dark.danger + "33",
  },
  resultText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  connectBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.dark.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  connectBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: Colors.dark.background,
  },
  disconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  disconnectText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.danger,
  },
  statsCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statsLabel: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.text,
  },
  statsValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: Colors.dark.accent,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  refreshText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  sandboxCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  sandboxText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 17,
  },
});
