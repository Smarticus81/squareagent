import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import Colors from "@/constants/colors";
import { useSquare, SquareLocation } from "@/context/SquareContext";

const WEB_TOP_INSET = 67;
const WEB_BOTTOM_INSET = 34;

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const {
    setCredentials,
    clearCredentials,
    isConfigured,
    accessToken,
    locationId,
    locations: savedLocations,
    loadCatalog,
    catalogItems,
    isLoadingCatalog,
    catalogError,
    fetchLocations,
    isLoadingLocations,
    locationsError,
  } = useSquare();

  const [token, setToken] = useState(accessToken || "");
  const [fetchedLocations, setFetchedLocations] = useState<SquareLocation[]>(savedLocations || []);
  const [selectedLocation, setSelectedLocation] = useState<SquareLocation | null>(
    locationId && savedLocations.length
      ? savedLocations.find((l) => l.id === locationId) ?? null
      : null
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;

  const hasFetched = fetchedLocations.length > 0;

  async function handleFetchLocations() {
    if (!token.trim()) {
      setResult({ success: false, message: "Paste your Access Token first" });
      return;
    }
    setResult(null);
    setSelectedLocation(null);
    try {
      const locs = await fetchLocations(token.trim());
      setFetchedLocations(locs);
      if (locs.length === 1) {
        setSelectedLocation(locs[0]);
      }
    } catch (e: any) {
      setResult({ success: false, message: e.message || "Could not fetch locations" });
    }
  }

  async function handleConnect() {
    if (!token.trim()) {
      setResult({ success: false, message: "Enter your access token" });
      return;
    }
    if (!selectedLocation) {
      setResult({ success: false, message: "Choose a location" });
      return;
    }
    setIsConnecting(true);
    setResult(null);
    try {
      await setCredentials(token.trim(), selectedLocation.id);
      await loadCatalog();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({
        success: true,
        message: `Connected to "${selectedLocation.name}"! Loaded ${catalogItems.length} catalog items.`,
      });
    } catch (e: any) {
      setResult({ success: false, message: e.message || "Connection failed" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    await clearCredentials();
    setToken("");
    setFetchedLocations([]);
    setSelectedLocation(null);
    setResult(null);
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
            {isConfigured ? `Connected — ${savedLocations.find(l => l.id === locationId)?.name ?? locationId}` : "Not connected"}
          </Text>
        </Animated.View>

        {/* Step 1: Access Token */}
        <Animated.View entering={FadeInDown.delay(60).duration(300)}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={styles.stepTitle}>Access Token</Text>
          </View>
          <Text style={styles.stepHint}>
            Find this at{" "}
            <Text style={styles.link}>developer.squareup.com</Text>
            {" "}→ your app → Credentials
          </Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={(t) => { setToken(t); setFetchedLocations([]); setSelectedLocation(null); }}
            placeholder="EAAAxxxxxxxxxxxxxxx..."
            placeholderTextColor={Colors.dark.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="done"
          />
          <Pressable
            onPress={handleFetchLocations}
            disabled={isLoadingLocations}
            style={[styles.fetchBtn, { opacity: isLoadingLocations ? 0.6 : 1 }]}
          >
            {isLoadingLocations ? (
              <ActivityIndicator size="small" color={Colors.dark.accent} />
            ) : (
              <Feather name="map-pin" size={15} color={Colors.dark.accent} />
            )}
            <Text style={styles.fetchBtnText}>
              {isLoadingLocations ? "Fetching locations…" : "Fetch My Locations"}
            </Text>
          </Pressable>
        </Animated.View>

        {/* Step 2: Pick Location */}
        {hasFetched && (
          <Animated.View entering={FadeInDown.duration(250)}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNum}>2</Text>
              </View>
              <Text style={styles.stepTitle}>Choose a Location</Text>
            </View>
            <Text style={styles.stepHint}>Tap the location you want to ring up orders at</Text>
            <View style={styles.locationList}>
              {fetchedLocations.map((loc) => {
                const active = selectedLocation?.id === loc.id;
                return (
                  <Pressable
                    key={loc.id}
                    onPress={() => {
                      setSelectedLocation(loc);
                      setResult(null);
                      Haptics.selectionAsync();
                    }}
                    style={[styles.locationRow, active && styles.locationRowActive]}
                  >
                    <View style={styles.locationLeft}>
                      <Text style={[styles.locationName, active && styles.locationNameActive]}>
                        {loc.name}
                      </Text>
                      {loc.address ? (
                        <Text style={styles.locationAddr}>{loc.address}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.locationCheck, active && styles.locationCheckActive]}>
                      {active && <Feather name="check" size={13} color={Colors.dark.background} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        )}

        {/* Errors from fetching */}
        {locationsError && !hasFetched && (
          <View style={[styles.resultCard, styles.resultError]}>
            <Feather name="alert-circle" size={16} color={Colors.dark.danger} />
            <Text style={[styles.resultText, { color: Colors.dark.danger }]}>{locationsError}</Text>
          </View>
        )}

        {/* Result message */}
        {result && (
          <Animated.View
            entering={FadeInDown.duration(200)}
            style={[styles.resultCard, result.success ? styles.resultSuccess : styles.resultError]}
          >
            <Feather
              name={result.success ? "check-circle" : "alert-circle"}
              size={16}
              color={result.success ? Colors.dark.accent : Colors.dark.danger}
            />
            <Text style={[styles.resultText, { color: result.success ? Colors.dark.accent : Colors.dark.danger }]}>
              {result.message}
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
        {(hasFetched || isConfigured) && (
          <Pressable
            onPress={handleConnect}
            disabled={isConnecting || !selectedLocation}
            style={[styles.connectBtn, { opacity: (isConnecting || !selectedLocation) ? 0.6 : 1 }]}
          >
            {isConnecting ? (
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
        )}

        {isConfigured && (
          <>
            {/* Catalog Stats */}
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

            <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
              <Feather name="link-2" size={16} color={Colors.dark.danger} />
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          </>
        )}

        {/* Sandbox Note */}
        <Animated.View entering={FadeInDown.delay(240).duration(300)} style={styles.sandboxCard}>
          <Feather name="shield" size={16} color={Colors.dark.warning} />
          <Text style={styles.sandboxText}>
            Use Sandbox credentials for testing. Switch to Production tokens when ready to go live.
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
    flex: 1,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.dark.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: Colors.dark.background,
  },
  stepTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.text,
  },
  stepHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 10,
    lineHeight: 17,
  },
  link: {
    color: Colors.dark.accent,
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
    marginBottom: 10,
  },
  fetchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dark.accentDim,
    backgroundColor: Colors.dark.accentSubtle,
    alignSelf: "flex-start",
  },
  fetchBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.accent,
  },
  locationList: {
    gap: 8,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  locationRowActive: {
    borderColor: Colors.dark.accent,
    backgroundColor: Colors.dark.accentSubtle,
  },
  locationLeft: {
    flex: 1,
    gap: 2,
  },
  locationName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.text,
  },
  locationNameActive: {
    color: Colors.dark.accent,
  },
  locationAddr: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  locationCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.dark.surfaceBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  locationCheckActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
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
