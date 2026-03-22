import React, { useEffect, useRef, useState } from "react";
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
import { useVoicePrefs, VOICES, SPEEDS } from "@/hooks/useVoicePrefs";

const WEB_TOP_INSET = 67;
const WEB_BOTTOM_INSET = 34;

function getBaseUrl() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "http://localhost:8080/";
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}/`;
}

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
  const { voice, speed, setVoice, setSpeed } = useVoicePrefs();

  const [isConnecting, setIsConnecting] = useState(false);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [orderCheck, setOrderCheck] = useState<{
    loading: boolean;
    orders?: { id: string; state: string; source?: string; total?: number; created_at?: string }[];
    error?: string;
  } | null>(null);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;
  const hasFetched = fetchedLocations.length > 0;

  // ── OAuth popup flow (web only) ─────────────────────────────────────────────

  async function handleOAuthConnect() {
    setIsOAuthLoading(true);
    setResult(null);
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}api/square/oauth/authorize`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to start OAuth" }));
        throw new Error(err.error || "Failed to start OAuth");
      }
      const { url } = await res.json();

      const popup = window.open(url, "squareOAuth", "width=600,height=700,left=200,top=100");
      if (!popup) {
        throw new Error("Popup was blocked. Please allow popups for this site and try again.");
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener("message", handler);
          reject(new Error("Authorization timed out. Please try again."));
        }, 5 * 60 * 1000);

        async function handler(event: MessageEvent) {
          const data = event.data;
          if (data?.type === "square-oauth-success") {
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            try {
              const tokenRes = await fetch(`${baseUrl}api/square/oauth/token?ts=${data.tokenState}`);
              if (!tokenRes.ok) throw new Error("Failed to retrieve access token");
              const { token: oauthToken } = await tokenRes.json();
              const locs = await fetchLocations(oauthToken);
              setToken(oauthToken);
              setFetchedLocations(locs);
              if (locs.length === 1) {
                setSelectedLocation(locs[0]);
              }
              resolve();
            } catch (e: any) {
              reject(e);
            }
          } else if (data?.type === "square-oauth-error") {
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            reject(new Error(data.error || "Authorization was denied"));
          }
        }
        window.addEventListener("message", handler);
      });
    } catch (e: any) {
      setResult({ success: false, message: e.message || "OAuth failed" });
    } finally {
      setIsOAuthLoading(false);
    }
  }

  // ── Manual token flow ───────────────────────────────────────────────────────

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
      if (locs.length === 1) setSelectedLocation(locs[0]);
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
      const count = await loadCatalog(token.trim(), selectedLocation.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({
        success: true,
        message: `Connected to "${selectedLocation.name}"! Loaded ${count} catalog item${count !== 1 ? "s" : ""}.`,
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
    setShowManual(false);
    setOrderCheck(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function checkRecentOrders() {
    if (!accessToken || !locationId) return;
    setOrderCheck({ loading: true });
    try {
      const base = getBaseUrl();
      const res = await fetch(`${base}api/square/orders/recent`, {
        headers: {
          "x-square-token": accessToken,
          "x-square-location": locationId,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setOrderCheck({ loading: false, error: data.error || "Failed to check orders" });
      } else {
        setOrderCheck({ loading: false, orders: data.orders ?? [] });
      }
    } catch (e: any) {
      setOrderCheck({ loading: false, error: e.message });
    }
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
            {isConfigured
              ? `Connected — ${savedLocations.find(l => l.id === locationId)?.name ?? locationId}`
              : "Not connected"}
          </Text>
        </Animated.View>

        {!isConfigured ? (
          <>
            {/* Primary: OAuth Button (web) or manual (native) */}
            {Platform.OS === "web" && !showManual ? (
              <Animated.View entering={FadeInDown.delay(60).duration(300)} style={styles.oauthSection}>
                <Text style={styles.oauthTitle}>Connect your Square account</Text>
                <Text style={styles.oauthSub}>
                  Sign in with Square to automatically load your catalog and start taking voice orders.
                </Text>
                <Pressable
                  onPress={handleOAuthConnect}
                  disabled={isOAuthLoading}
                  style={[styles.oauthBtn, { opacity: isOAuthLoading ? 0.7 : 1 }]}
                >
                  {isOAuthLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="link" size={18} color="#fff" />
                      <Text style={styles.oauthBtnText}>Connect with Square</Text>
                    </>
                  )}
                </Pressable>

                <Pressable onPress={() => setShowManual(true)} style={styles.manualToggle}>
                  <Text style={styles.manualToggleText}>Use access token instead</Text>
                </Pressable>
              </Animated.View>
            ) : (
              /* Manual token flow */
              <Animated.View entering={FadeInDown.delay(60).duration(300)}>
                {Platform.OS === "web" && (
                  <Pressable onPress={() => setShowManual(false)} style={styles.backToOAuth}>
                    <Feather name="arrow-left" size={14} color={Colors.dark.accent} />
                    <Text style={styles.backToOAuthText}>Back to Sign in with Square</Text>
                  </Pressable>
                )}
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}><Text style={styles.stepNum}>1</Text></View>
                  <Text style={styles.stepTitle}>Access Token</Text>
                </View>
                <Text style={styles.stepHint}>
                  Find at <Text style={styles.link}>developer.squareup.com</Text> → your app → Credentials
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
                    {isLoadingLocations ? "Fetching…" : "Fetch My Locations"}
                  </Text>
                </Pressable>
              </Animated.View>
            )}

            {/* Step 2: Pick Location (shown after OAuth or manual fetch) */}
            {hasFetched && (
              <Animated.View entering={FadeInDown.duration(250)}>
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}><Text style={styles.stepNum}>{Platform.OS === "web" && !showManual ? "1" : "2"}</Text></View>
                  <Text style={styles.stepTitle}>Choose a Location</Text>
                </View>
                <Text style={styles.stepHint}>Tap the location you want to ring up orders at</Text>
                <View style={styles.locationList}>
                  {fetchedLocations.map((loc) => {
                    const active = selectedLocation?.id === loc.id;
                    return (
                      <Pressable
                        key={loc.id}
                        onPress={() => { setSelectedLocation(loc); setResult(null); Haptics.selectionAsync(); }}
                        style={[styles.locationRow, active && styles.locationRowActive]}
                      >
                        <View style={styles.locationLeft}>
                          <Text style={[styles.locationName, active && styles.locationNameActive]}>{loc.name}</Text>
                          {loc.address ? <Text style={styles.locationAddr}>{loc.address}</Text> : null}
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

            {/* Errors */}
            {locationsError && !hasFetched && (
              <View style={[styles.resultCard, styles.resultError]}>
                <Feather name="alert-circle" size={16} color={Colors.dark.danger} />
                <Text style={[styles.resultText, { color: Colors.dark.danger }]}>{locationsError}</Text>
              </View>
            )}

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

            {/* Connect Button (after location picked) */}
            {hasFetched && (
              <Pressable
                onPress={handleConnect}
                disabled={isConnecting || !selectedLocation}
                style={[styles.connectBtn, { opacity: (isConnecting || !selectedLocation) ? 0.6 : 1 }]}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color={Colors.dark.background} />
                ) : (
                  <>
                    <Feather name="check" size={18} color={Colors.dark.background} />
                    <Text style={styles.connectBtnText}>Save & Connect</Text>
                  </>
                )}
              </Pressable>
            )}
          </>
        ) : (
          /* Already connected — show stats */
          <>
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
              <Pressable onPress={() => loadCatalog()} style={styles.refreshBtn}>
                <Feather name="refresh-cw" size={14} color={Colors.dark.textSecondary} />
                <Text style={styles.refreshText}>Refresh catalog</Text>
              </Pressable>
            </Animated.View>

            {/* Recent orders diagnostic */}
            <Pressable
              onPress={checkRecentOrders}
              style={[styles.fetchBtn, { alignSelf: "stretch", justifyContent: "center" }]}
              disabled={orderCheck?.loading}
            >
              {orderCheck?.loading ? (
                <ActivityIndicator size="small" color={Colors.dark.accent} />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="search" size={14} color={Colors.dark.accent} />
                  <Text style={styles.fetchBtnText}>Check recent orders in Square</Text>
                </View>
              )}
            </Pressable>

            {orderCheck && !orderCheck.loading && (
              <View style={styles.ordersResult}>
                {orderCheck.error ? (
                  <Text style={[styles.ordersEmpty, { color: Colors.dark.danger }]}>{orderCheck.error}</Text>
                ) : orderCheck.orders?.length === 0 ? (
                  <Text style={styles.ordersEmpty}>No orders found at this location.</Text>
                ) : (
                  orderCheck.orders?.map((o) => (
                    <View key={o.id} style={styles.orderRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.orderSource}>{o.source ?? "Unknown source"} · {o.state}</Text>
                        <Text style={styles.orderId} numberOfLines={1}>{o.id}</Text>
                      </View>
                      <Text style={styles.orderTotal}>
                        {o.total != null ? `$${(o.total / 100).toFixed(2)}` : "—"}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}

            <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
              <Feather name="link-2" size={16} color={Colors.dark.danger} />
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          </>
        )}

        {/* Info card */}
        <Animated.View entering={FadeInDown.delay(240).duration(300)} style={styles.sandboxCard}>
          <Feather name="shield" size={16} color={Colors.dark.warning} />
          <Text style={styles.sandboxText}>
            Orders submitted here go directly to your live Square account. Use your Sandbox credentials from developer.squareup.com to test without real transactions.
          </Text>
        </Animated.View>

        {/* ── Voice Settings ───────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(280).duration(300)} style={styles.voiceSection}>
          <View style={styles.voiceSectionHeader}>
            <Feather name="mic" size={16} color={Colors.dark.accent} />
            <Text style={styles.voiceSectionTitle}>Voice Settings</Text>
          </View>

          {/* Voice picker */}
          <Text style={styles.voiceLabel}>Voice</Text>
          <View style={styles.voiceGrid}>
            {VOICES.map((v) => {
              const active = voice === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => { setVoice(v.id); Haptics.selectionAsync(); }}
                  style={[styles.voiceChip, active && styles.voiceChipActive]}
                >
                  <Text style={[styles.voiceChipName, active && styles.voiceChipNameActive]}>{v.label}</Text>
                  <Text style={[styles.voiceChipDesc, active && styles.voiceChipDescActive]}>{v.desc}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Speed picker */}
          <Text style={[styles.voiceLabel, { marginTop: 14 }]}>Speed</Text>
          <View style={styles.speedRow}>
            {SPEEDS.map((s) => {
              const active = speed === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => { setSpeed(s.id); Haptics.selectionAsync(); }}
                  style={[styles.speedChip, active && styles.speedChipActive]}
                >
                  <Text style={[styles.speedChipText, active && styles.speedChipTextActive]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.voiceHint}>
            Voice and speed apply when you next start a session.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Inter_600SemiBold", fontSize: 17, color: Colors.dark.text },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, gap: 16, paddingTop: 4 },
  statusCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.dark.text, flex: 1 },

  // OAuth section
  oauthSection: { gap: 12 },
  oauthTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.dark.text },
  oauthSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.textSecondary, lineHeight: 19 },
  oauthBtn: {
    height: 52, borderRadius: 14, backgroundColor: "#00A04A",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  oauthBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: "#fff" },
  manualToggle: { alignItems: "center", paddingVertical: 8 },
  manualToggleText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.textSecondary },
  backToOAuth: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backToOAuthText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.dark.accent },

  // Manual steps
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  stepBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.dark.accent, alignItems: "center", justifyContent: "center",
  },
  stepNum: { fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.dark.background },
  stepTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark.text },
  stepHint: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.dark.textSecondary, marginBottom: 10, lineHeight: 17 },
  link: { color: Colors.dark.accent },
  input: {
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    paddingHorizontal: 16, height: 50,
    fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.dark.text,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder, marginBottom: 10,
  },
  fetchBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.dark.accentDim,
    backgroundColor: Colors.dark.accentSubtle, alignSelf: "flex-start",
  },
  fetchBtnText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.dark.accent },

  // Location picker
  locationList: { gap: 8 },
  locationRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  locationRowActive: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accentSubtle },
  locationLeft: { flex: 1, gap: 2 },
  locationName: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark.text },
  locationNameActive: { color: Colors.dark.accent },
  locationAddr: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.dark.textSecondary },
  locationCheck: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: Colors.dark.surfaceBorder,
    alignItems: "center", justifyContent: "center",
  },
  locationCheckActive: { backgroundColor: Colors.dark.accent, borderColor: Colors.dark.accent },

  // Results
  resultCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
  },
  resultSuccess: { backgroundColor: Colors.dark.accentSubtle, borderWidth: 1, borderColor: Colors.dark.accentDim },
  resultError: { backgroundColor: Colors.dark.dangerDim, borderWidth: 1, borderColor: Colors.dark.danger + "33" },
  resultText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13 },

  // Connect / Disconnect
  connectBtn: {
    height: 52, borderRadius: 14, backgroundColor: Colors.dark.accent,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  connectBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.dark.background },
  disconnectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12,
  },
  disconnectText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.dark.danger },

  // Stats (connected state)
  statsCard: {
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statsLabel: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.dark.text },
  statsValue: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.dark.accent },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  refreshText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.textSecondary },

  sandboxCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  sandboxText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.dark.textSecondary, lineHeight: 17 },

  // Voice Settings
  voiceSection: {
    backgroundColor: Colors.dark.surface, borderRadius: 16,
    padding: 18, borderWidth: 1, borderColor: Colors.dark.surfaceBorder, gap: 8,
  },
  voiceSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  voiceSectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.dark.text },
  voiceLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.dark.textSecondary },
  voiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  voiceChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.dark.surfaceElevated,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
    alignItems: "center",
  },
  voiceChipActive: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accentSubtle },
  voiceChipName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.dark.text },
  voiceChipNameActive: { color: Colors.dark.accent },
  voiceChipDesc: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.dark.textMuted, marginTop: 2 },
  voiceChipDescActive: { color: Colors.dark.accentBright },
  speedRow: { flexDirection: "row", gap: 8 },
  speedChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
    backgroundColor: Colors.dark.surfaceElevated,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  speedChipActive: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accentSubtle },
  speedChipText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.dark.textSecondary },
  speedChipTextActive: { color: Colors.dark.accent, fontFamily: "Inter_600SemiBold" },
  voiceHint: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.dark.textMuted, marginTop: 4 },

  // Recent orders diagnostic
  ordersResult: {
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
    overflow: "hidden",
  },
  ordersEmpty: {
    fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.textSecondary,
    textAlign: "center", padding: 16,
  },
  orderRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.surfaceBorder,
  },
  orderSource: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.dark.accent },
  orderId: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.dark.textSecondary, marginTop: 1 },
  orderTotal: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.dark.text },
});
