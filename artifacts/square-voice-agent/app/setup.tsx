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
    authToken,
    userInfo,
    venues,
    login,
    signup,
    logout,
    selectVenue,
  } = useSquare();

  const { voice, speed, setVoice, setSpeed } = useVoicePrefs();

  // Auth form state
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Venue selection state
  const [venueLoading, setVenueLoading] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);

  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [orderCheck, setOrderCheck] = useState<{
    loading: boolean;
    orders?: { id: string; state: string; source?: string; total?: number; created_at?: string }[];
    error?: string;
  } | null>(null);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;

  const isLoggedIn = !!authToken && !!userInfo;

  // ── Login / Signup ──────────────────────────────────────────────────────────

  async function handleAuth() {
    setAuthError(null);
    if (authMode === "signup" && !name.trim()) {
      setAuthError("Name is required");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setAuthError("Email and password are required");
      return;
    }
    if (authMode === "signup" && password.length < 8) {
      setAuthError("Password must be at least 8 characters");
      return;
    }

    setAuthLoading(true);
    try {
      const err = authMode === "login"
        ? await login(email.trim(), password)
        : await signup(name.trim(), email.trim(), password);
      if (err) {
        setAuthError(err);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setAuthLoading(false);
    }
  }

  // ── Venue selection ─────────────────────────────────────────────────────────

  async function handleSelectVenue(venueId: number) {
    setVenueError(null);
    setVenueLoading(true);
    try {
      const err = await selectVenue(venueId);
      if (err) {
        setVenueError(err);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        // Auto-load catalog
        await loadCatalog();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setResult({ success: true, message: "Connected! Catalog loaded." });
      }
    } finally {
      setVenueLoading(false);
    }
  }

  async function handleDisconnect() {
    await clearCredentials();
    setResult(null);
    setOrderCheck(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function handleLogout() {
    await logout();
    setEmail("");
    setPassword("");
    setName("");
    setResult(null);
    setOrderCheck(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function checkRecentOrders() {
    if (!accessToken || !locationId) return;
    setOrderCheck({ loading: true });
    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const protocol = domain?.startsWith("localhost") ? "http" : "https";
      const baseUrl = domain ? `${protocol}://${domain}/` : "http://localhost:8080/";
      const res = await fetch(`${baseUrl}api/square/orders/recent`, {
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
        <Text style={styles.headerTitle}>Setup</Text>
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
              ? `Connected${userInfo ? ` — ${userInfo.email}` : ""}`
              : isLoggedIn
                ? `Logged in as ${userInfo?.email ?? "user"}`
                : "Not signed in"}
          </Text>
        </Animated.View>

        {/* ── Not logged in: Login / Signup form ──────────────────── */}
        {!isLoggedIn ? (
          <Animated.View entering={FadeInDown.delay(60).duration(300)} style={styles.authSection}>
            <Text style={styles.authTitle}>
              {authMode === "login" ? "Sign in to BevPro" : "Create your BevPro account"}
            </Text>
            <Text style={styles.authSub}>
              {authMode === "login"
                ? "Log in with the account you created on the BevPro dashboard."
                : "Create an account to get started with voice-powered ordering."}
            </Text>

            {authMode === "signup" && (
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={Colors.dark.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            )}

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              placeholderTextColor={Colors.dark.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
            />

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={Colors.dark.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleAuth}
            />

            {authError && (
              <View style={[styles.resultCard, styles.resultError]}>
                <Feather name="alert-circle" size={16} color={Colors.dark.danger} />
                <Text style={[styles.resultText, { color: Colors.dark.danger }]}>{authError}</Text>
              </View>
            )}

            <Pressable
              onPress={handleAuth}
              disabled={authLoading}
              style={[styles.connectBtn, { opacity: authLoading ? 0.7 : 1 }]}
            >
              {authLoading ? (
                <ActivityIndicator size="small" color={Colors.dark.background} />
              ) : (
                <>
                  <Feather name="log-in" size={18} color={Colors.dark.background} />
                  <Text style={styles.connectBtnText}>
                    {authMode === "login" ? "Sign In" : "Create Account"}
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(null); }}
              style={styles.switchAuth}
            >
              <Text style={styles.switchAuthText}>
                {authMode === "login"
                  ? "Don't have an account? Sign up"
                  : "Already have an account? Sign in"}
              </Text>
            </Pressable>
          </Animated.View>

        /* ── Logged in but no venue selected ─────────────────────── */
        ) : !isConfigured ? (
          <Animated.View entering={FadeInDown.delay(60).duration(300)}>
            {venues.length > 0 ? (
              <>
                <Text style={styles.authTitle}>Select your venue</Text>
                <Text style={styles.authSub}>Choose the venue you want to use with the voice agent.</Text>

                <View style={styles.locationList}>
                  {venues.map((v) => (
                    <Pressable
                      key={v.id}
                      onPress={() => handleSelectVenue(v.id)}
                      disabled={venueLoading}
                      style={[styles.locationRow, { opacity: venueLoading ? 0.6 : 1 }]}
                    >
                      <View style={styles.locationLeft}>
                        <Text style={styles.locationName}>{v.name}</Text>
                        {v.squareLocationName && (
                          <Text style={styles.locationAddr}>{v.squareLocationName}</Text>
                        )}
                      </View>
                      <Feather name="chevron-right" size={18} color={Colors.dark.textMuted} />
                    </Pressable>
                  ))}
                </View>

                {venueError && (
                  <View style={[styles.resultCard, styles.resultError]}>
                    <Feather name="alert-circle" size={16} color={Colors.dark.danger} />
                    <Text style={[styles.resultText, { color: Colors.dark.danger }]}>{venueError}</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noVenuesCard}>
                <Feather name="map-pin" size={24} color={Colors.dark.textMuted} />
                <Text style={styles.noVenuesTitle}>No venues found</Text>
                <Text style={styles.noVenuesText}>
                  Connect your Square account from the BevPro dashboard first, then come back here.
                </Text>
              </View>
            )}

            <Pressable onPress={handleLogout} style={styles.disconnectBtn}>
              <Feather name="log-out" size={16} color={Colors.dark.danger} />
              <Text style={styles.disconnectText}>Sign out</Text>
            </Pressable>
          </Animated.View>

        /* ── Connected — show status + controls ──────────────────── */
        ) : (
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
              <Text style={styles.disconnectText}>Switch venue</Text>
            </Pressable>

            <Pressable onPress={handleLogout} style={styles.disconnectBtn}>
              <Feather name="log-out" size={16} color={Colors.dark.danger} />
              <Text style={styles.disconnectText}>Sign out</Text>
            </Pressable>
          </>
        )}

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

  // Auth section (login/signup)
  authSection: { gap: 12 },
  authTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.dark.text },
  authSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.textSecondary, lineHeight: 19 },
  switchAuth: { alignItems: "center", paddingVertical: 8 },
  switchAuthText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.accent },

  // No venues state
  noVenuesCard: {
    alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 20,
    backgroundColor: Colors.dark.surface, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  noVenuesTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.dark.text },
  noVenuesText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 19 },
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
