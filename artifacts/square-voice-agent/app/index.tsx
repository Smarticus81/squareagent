import React, {
  useEffect, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ActivityIndicator, Linking, useColorScheme,
} from "react-native";
import Svg, { Circle, Rect, Defs, LinearGradient as SvgGrad, Stop, ClipPath } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle, useSharedValue,
  withRepeat, withSequence, withTiming, FadeIn, FadeOut, Easing,
} from "react-native-reanimated";

import { useWakeWord, TERMINATE_PHRASES, isWakeWordSupported } from "@/hooks/useWakeWord";
import { useVoiceAgent, ConversationMessage, AgentState, AgentMode, OrderCommand } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { useVoicePrefs, VOICES, SPEEDS } from "@/hooks/useVoicePrefs";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP = 67;
const WEB_BOT = 34;
type OrbKey = AgentState | "wake";

// ── Sizes ─────────────────────────────────────────────────────────────────────
const ORB      = 180;   // sphere diameter (light mode)
const RING_D   = 266;   // ring SVG container diameter (dark mode)
const RING_C   = 133;   // SVG center
const RING_R   = 103;   // circle radius of ring stroke

// ── Orb colors ─────────────────────────────────────────────────────────────────
const SPHERE_COLORS: Record<OrbKey, readonly [string, string, string]> = {
  disconnected: ["#A78BFA", "#7C3AED", "#5B21B6"],
  connecting:   ["#A78BFA", "#7C3AED", "#5B21B6"],
  listening:    ["#C084FC", "#9333EA", "#7C3AED"],
  thinking:     ["#818CF8", "#6366F1", "#4F46E5"],
  speaking:     ["#E879F9", "#A855F7", "#7C3AED"],
  error:        ["#F87171", "#EF4444", "#DC2626"],
  wake:         ["#C084FC", "#9333EA", "#7C3AED"],
};

const RING_SPEED: Record<OrbKey, number> = {
  disconnected: 24000,
  connecting:   12000,
  listening:    7000,
  thinking:     18000,
  speaking:     4200,
  error:        14000,
  wake:         8000,
};

const RING_GLOW: Record<OrbKey, number> = {
  disconnected: 0.38,
  connecting:   0.60,
  listening:    0.88,
  thinking:     0.50,
  speaking:     1.00,
  error:        0.68,
  wake:         0.84,
};

// ── Theme ──────────────────────────────────────────────────────────────────────
const THEMES = {
  light: {
    bg:           "#EEF0FF" as const,
    bgGrad:       ["#EEF0FF", "#F3EEFF", "#E8F0FE"] as const,
    logoText:     "rgba(74,40,180,0.72)",
    logoBorder:   "rgba(74,40,180,0.42)",
    logoBead:     "rgba(74,40,180,0.42)",
    stateText:    "rgba(60,30,140,0.44)",
    tapHint:      "rgba(60,30,140,0.30)",
    errorText:    "rgba(160,20,20,0.72)",
    hamburger:    "rgba(60,30,140,0.35)",
    badgeBorder:  "rgba(74,40,180,0.24)",
    badgeText:    "rgba(60,30,140,0.62)",
    msgAgent:     (op: number) => `rgba(30,10,80,${op})`,
    msgUser:      (op: number) => `rgba(30,10,80,${op})`,
    partial:      "rgba(60,30,140,0.30)",
    panelBg:      "#FFFFFF",
    panelBorder:  "rgba(60,30,140,0.10)",
    panelHandle:  "rgba(60,30,140,0.16)",
    navText:      "rgba(30,10,80,0.32)",
    navActive:    "rgba(30,10,80,0.84)",
    divider:      "rgba(30,10,80,0.08)",
    recTotal:     "rgba(30,10,80,0.82)",
    recLabel:     "rgba(30,10,80,0.30)",
    rowName:      "rgba(30,10,80,0.72)",
    rowQty:       "rgba(30,10,80,0.36)",
    rowPrice:     "rgba(30,10,80,0.46)",
    emptyTxt:     "rgba(30,10,80,0.30)",
    emptyHint:    "rgba(30,10,80,0.18)",
    orderTotal:   "rgba(30,10,80,0.76)",
    orderFtrBg:   "#FFFFFF",
    clearBorder:  "rgba(160,30,30,0.26)",
    clearIcon:    "rgba(160,30,30,0.74)",
    submitBg:     "rgba(30,10,80,0.06)",
    submitBorder: "rgba(30,10,80,0.18)",
    submitText:   "rgba(30,10,80,0.70)",
    catName:      "rgba(30,10,80,0.72)",
    catCat:       "rgba(30,10,80,0.36)",
    catPrice:     "rgba(30,10,80,0.44)",
    settingsTxt:  "rgba(30,10,80,0.72)",
    settingsIcon: "rgba(30,10,80,0.46)",
    chevron:      "rgba(30,10,80,0.26)",
    link:         "rgba(60,30,160,0.76)",
  },
  dark: {
    bg:           "#08081C" as const,
    bgGrad:       ["#0A0920", "#0D0C28", "#0A0920"] as const,
    logoText:     "rgba(200,180,255,0.72)",
    logoBorder:   "rgba(200,180,255,0.38)",
    logoBead:     "rgba(200,180,255,0.38)",
    stateText:    "rgba(200,180,255,0.42)",
    tapHint:      "rgba(200,180,255,0.28)",
    errorText:    "rgba(252,120,120,0.84)",
    hamburger:    "rgba(200,180,255,0.36)",
    badgeBorder:  "rgba(200,180,255,0.22)",
    badgeText:    "rgba(200,180,255,0.70)",
    msgAgent:     (op: number) => `rgba(220,210,255,${op})`,
    msgUser:      (op: number) => `rgba(200,190,240,${op})`,
    partial:      "rgba(200,180,255,0.30)",
    panelBg:      "#10102A",
    panelBorder:  "rgba(200,180,255,0.10)",
    panelHandle:  "rgba(200,180,255,0.16)",
    navText:      "rgba(200,180,255,0.32)",
    navActive:    "rgba(220,210,255,0.88)",
    divider:      "rgba(200,180,255,0.08)",
    recTotal:     "rgba(220,210,255,0.84)",
    recLabel:     "rgba(200,180,255,0.32)",
    rowName:      "rgba(220,210,255,0.72)",
    rowQty:       "rgba(200,180,255,0.36)",
    rowPrice:     "rgba(200,180,255,0.46)",
    emptyTxt:     "rgba(200,180,255,0.30)",
    emptyHint:    "rgba(200,180,255,0.18)",
    orderTotal:   "rgba(220,210,255,0.78)",
    orderFtrBg:   "#10102A",
    clearBorder:  "rgba(252,100,100,0.28)",
    clearIcon:    "rgba(252,100,100,0.74)",
    submitBg:     "rgba(200,180,255,0.07)",
    submitBorder: "rgba(200,180,255,0.18)",
    submitText:   "rgba(220,210,255,0.74)",
    catName:      "rgba(220,210,255,0.72)",
    catCat:       "rgba(200,180,255,0.36)",
    catPrice:     "rgba(200,180,255,0.44)",
    settingsTxt:  "rgba(220,210,255,0.74)",
    settingsIcon: "rgba(200,180,255,0.48)",
    chevron:      "rgba(200,180,255,0.26)",
    link:         "rgba(140,160,255,0.82)",
  },
};

// ── Light mode: gradient 3D sphere ────────────────────────────────────────────
function OrbSphere({ orbKey }: { orbKey: OrbKey }) {
  const [displayed, setDisplayed] = useState<OrbKey>(orbKey);
  const fadeOp  = useSharedValue(1);
  const scale   = useSharedValue(1);
  const glowOp  = useSharedValue(0.18);

  // Cross-fade on state change
  useEffect(() => {
    fadeOp.value = withSequence(
      withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }),
    );
    const t = setTimeout(() => setDisplayed(orbKey), 200);
    return () => clearTimeout(t);
  }, [orbKey]);

  // Scale + glow pulse per state
  useEffect(() => {
    if (orbKey === "speaking") {
      scale.value = withRepeat(withSequence(
        withTiming(1.11, { duration: 320, easing: Easing.out(Easing.quad) }),
        withTiming(0.96, { duration: 320, easing: Easing.in(Easing.quad) }),
      ), -1);
      glowOp.value = withRepeat(withSequence(
        withTiming(0.42, { duration: 320 }),
        withTiming(0.14, { duration: 320 }),
      ), -1);
    } else if (orbKey === "listening" || orbKey === "wake") {
      scale.value = withRepeat(withSequence(
        withTiming(1.07, { duration: 950, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.97, { duration: 950, easing: Easing.inOut(Easing.sin) }),
      ), -1);
      glowOp.value = withRepeat(withSequence(
        withTiming(0.32, { duration: 950 }),
        withTiming(0.10, { duration: 950 }),
      ), -1);
    } else if (orbKey === "thinking") {
      scale.value = withRepeat(withSequence(
        withTiming(1.02, { duration: 1800 }), withTiming(0.98, { duration: 1800 }),
      ), -1);
      glowOp.value = withTiming(0.12, { duration: 600 });
    } else {
      scale.value = withRepeat(withSequence(
        withTiming(1.025, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.980, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
      ), -1);
      glowOp.value = withTiming(0.18, { duration: 700 });
    }
  }, [orbKey]);

  const fadeStyle  = useAnimatedStyle(() => ({ opacity: fadeOp.value }));
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle  = useAnimatedStyle(() => ({ opacity: glowOp.value }));

  const colors = SPHERE_COLORS[displayed];

  return (
    <Animated.View style={[{ width: ORB + 100, height: ORB + 100, alignItems: "center", justifyContent: "center" }, fadeStyle]}>
      {/* Outer haze glow */}
      <Animated.View style={[glowStyle, s.outerGlow, { backgroundColor: colors[1] }]} />
      {/* Mid glow */}
      <Animated.View style={[glowStyle, s.midGlow, { backgroundColor: colors[0] }]} />

      {/* Sphere itself */}
      <Animated.View style={[scaleStyle, { width: ORB, height: ORB, borderRadius: ORB / 2, overflow: "hidden" }]}>
        {/* Base gradient */}
        <LinearGradient
          colors={[colors[0], colors[1], colors[2]]}
          start={{ x: 0.25, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Top-left specular highlight — gives 3D depth */}
        <LinearGradient
          colors={["rgba(255,255,255,0.40)", "rgba(255,255,255,0.08)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.65, y: 0.80 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Bottom-right shadow — deepens the sphere */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.22)"]}
          start={{ x: 0.3, y: 0.4 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  );
}

// ── Dark mode: hollow rotating gradient ring ───────────────────────────────────
function OrbRing({ orbKey }: { orbKey: OrbKey }) {
  const rotation = useSharedValue(0);
  const ringOp   = useSharedValue(RING_GLOW[orbKey]);
  const scale    = useSharedValue(1);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(rotation.value + 360, { duration: RING_SPEED[orbKey], easing: Easing.linear }),
      -1,
    );
    ringOp.value = withTiming(RING_GLOW[orbKey], { duration: 600 });

    if (orbKey === "speaking") {
      scale.value = withRepeat(withSequence(
        withTiming(1.09, { duration: 280, easing: Easing.out(Easing.quad) }),
        withTiming(0.94, { duration: 280, easing: Easing.in(Easing.quad) }),
      ), -1);
    } else if (orbKey === "listening" || orbKey === "wake") {
      scale.value = withRepeat(withSequence(
        withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.96, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      ), -1);
    } else if (orbKey === "thinking") {
      scale.value = withRepeat(withSequence(
        withTiming(1.03, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.97, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
      ), -1);
    } else {
      scale.value = withRepeat(withSequence(
        withTiming(1.015, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.990, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      ), -1);
    }
  }, [orbKey]);

  const rotStyle   = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const ringStyle  = useAnimatedStyle(() => ({ opacity: ringOp.value }));
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[{ width: RING_D, height: RING_D, alignItems: "center", justifyContent: "center" }, scaleStyle]}>
      {/* Rotating gradient ring — hollow, nothing inside */}
      <Animated.View style={[StyleSheet.absoluteFill, rotStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
          <Svg width={RING_D} height={RING_D}>
            <Defs>
              <SvgGrad id="rg" x1="0.5" y1="0" x2="0.5" y2="1">
                <Stop offset="0%"   stopColor="#9333EA" stopOpacity="1" />
                <Stop offset="48%"  stopColor="#4F46E5" stopOpacity="1" />
                <Stop offset="100%" stopColor="#06B6D4" stopOpacity="1" />
              </SvgGrad>
            </Defs>
            {/* Wide outer glow */}
            <Circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="url(#rg)" strokeWidth={32} opacity={0.12} />
            {/* Medium glow */}
            <Circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="url(#rg)" strokeWidth={16} opacity={0.28} />
            {/* Core bright ring */}
            <Circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="url(#rg)" strokeWidth={5}  opacity={0.92} />
            {/* Inner edge gleam */}
            <Circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Conversation ghost text ───────────────────────────────────────────────────
type Theme = typeof THEMES.light | typeof THEMES.dark;

function GhostLine({ msg, rank, t }: {
  msg: ConversationMessage;
  rank: number;
  t: Theme;
}) {
  const isUser = msg.role === "user";
  const op = rank === 0 ? (isUser ? 0.48 : 0.86) : rank === 1 ? 0.28 : 0.12;
  const sz = rank === 0 ? (isUser ? 14 : 16) : 13;
  const colorFn = isUser ? t.msgUser : t.msgAgent;
  return (
    <Animated.Text
      entering={FadeIn.duration(500)}
      exiting={FadeOut.duration(400)}
      style={{
        textAlign: "center", fontSize: sz, lineHeight: 24,
        fontFamily: isUser ? "Inter_300Light" : "Inter_400Regular",
        color: colorFn(op), letterSpacing: 0.1,
      }}
    >
      {msg.content}
    </Animated.Text>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MainScreen() {
  const insets    = useSafeAreaInsets();
  const scheme    = useColorScheme();
  const isDark    = scheme === "dark";
  const t         = isDark ? THEMES.dark : THEMES.light;
  const topPad    = Platform.OS === "web" ? WEB_TOP  : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOT  : insets.bottom;

  const {
    agentState, agentMode, setAgentMode, isConnected, conversation, partialTranscript, error,
    connect, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials, setAuthParams,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId, venueId, authToken,
    connectionError, isReconnecting, refreshCredentials } = useSquare();
  const { voice, speed, setVoice, setSpeed, loaded: voicePrefsLoaded } = useVoicePrefs();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab,  setPanelTab]  = useState<"order" | "menu" | "settings">("order");

  // Refs so handleCmds never has a stale closure on catalog or order
  const catalogItemsRef = useRef(catalogItems);
  const currentOrderRef = useRef(currentOrder);
  useEffect(() => { catalogItemsRef.current = catalogItems; }, [catalogItems]);
  useEffect(() => { currentOrderRef.current = currentOrder; }, [currentOrder]);

  // ── Wake word ──────────────────────────────────────────────────────────────
  type WakeMode = "idle" | "wake" | "command";
  const [wakeMode, setWakeMode] = useState<WakeMode>("idle");
  const wakeModeRef = useRef<WakeMode>("idle");
  wakeModeRef.current = wakeMode;

  const onWake = useCallback(async () => { setWakeMode("command"); await connect(); }, [connect]);
  const onStop = useCallback(async () => { await disconnect(); setWakeMode("idle"); }, [disconnect]);
  const { isListening: wakeListening, startWakeWord, stopWakeWord } = useWakeWord({
    onWakeWordDetected: onWake, onStopDetected: onStop,
  });

  const enterWake = useCallback(() => { setWakeMode("wake"); startWakeWord(); }, [startWakeWord]);
  const exitWake  = useCallback(async () => { stopWakeWord(); await disconnect(); setWakeMode("idle"); }, [stopWakeWord, disconnect]);

  useEffect(() => {
    if (Platform.OS !== "web" || wakeModeRef.current !== "command" || isConnected) return;
    const ti = setTimeout(() => { if (wakeModeRef.current !== "command") return; setWakeMode("wake"); startWakeWord(); }, 350);
    return () => clearTimeout(ti);
  }, [isConnected, startWakeWord]);

  useEffect(() => {
    if (Platform.OS !== "web" || wakeMode !== "command") return;
    const last = [...conversation].reverse().find((m) => m.role === "user");
    if (!last) return;
    if (TERMINATE_PHRASES.some((p) => last.content.toLowerCase().includes(p))) {
      const ti = setTimeout(() => disconnect(), 1600);
      return () => clearTimeout(ti);
    }
  }, [conversation, wakeMode, disconnect]);

  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({ id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category })));
  }, [catalogItems, setCatalog]);

  useEffect(() => { if (accessToken && locationId) setSquareCredentials(accessToken, locationId); }, [accessToken, locationId, setSquareCredentials]);

  // Forward auth params so voice agent can authenticate server-side tool calls
  useEffect(() => { if (venueId && authToken) setAuthParams(venueId, authToken); }, [venueId, authToken, setAuthParams]);

  useEffect(() => {
    setCurrentOrder((currentOrder?.items ?? []).map((i) => ({ name: i.catalogItem.name, price: i.catalogItem.price, quantity: i.quantity })));
  }, [currentOrder, setCurrentOrder]);

  // accessToken/locationId refs so submit never goes stale either
  const accessTokenRef  = useRef(accessToken);
  const locationIdRef   = useRef(locationId);
  useEffect(() => { accessTokenRef.current  = accessToken;  }, [accessToken]);
  useEffect(() => { locationIdRef.current   = locationId;   }, [locationId]);

  const handleCmds = useCallback((cmds: OrderCommand[]) => {
    for (const cmd of cmds) {
      switch (cmd.action) {
        case "add": {
          const items = catalogItemsRef.current;
          let found = cmd.item_id ? items.find((c) => c.id === cmd.item_id) : undefined;
          if (!found && cmd.item_name) {
            const n = cmd.item_name.toLowerCase();
            found = items.find((c) => c.name.toLowerCase() === n) ??
                    items.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
          }
          if (!found) break;
          addItem(found, cmd.quantity ?? 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        }
        case "remove": {
          const n = (cmd.item_name ?? "").toLowerCase();
          const ord = currentOrderRef.current;
          const line = ord?.items.find((i) => i.catalogItem.name.toLowerCase() === n) ??
                       ord?.items.find((i) => i.catalogItem.name.toLowerCase().includes(n));
          if (line) { removeItem(line.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
          break;
        }
        case "clear": clearOrder(); break;
        case "submit": {
          const tok = accessTokenRef.current;
          const loc = locationIdRef.current;
          const ord = currentOrderRef.current;
          if (!tok || !loc || !ord?.items.length) break;
          submitOrder(tok, loc).then((r) => {
            Haptics.notificationAsync(r.success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
            if (r.success) { setPanelTab("order"); setPanelOpen(true); }
          });
          break;
        }
      }
    }
  }, [addItem, removeItem, clearOrder, submitOrder]);

  useEffect(() => { setToolHandler(handleCmds); }, [handleCmds, setToolHandler]);

  async function handleOrbPress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web" && wakeMode === "wake") {
      exitWake(); return;
    }
    if (isConnected || agentState === "connecting") disconnect();
    else await connect();
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const orbKey: OrbKey = wakeMode === "wake" ? "wake"
    : wakeMode === "command" ? agentState
    : agentState;

  const msgs       = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;

  const stateLabel: string | null =
    wakeMode === "wake"       ? (wakeListening ? "HEY BAR" : "OPENING MIC\u2026")
    : orbKey === "connecting" ? "CONNECTING"
    : orbKey === "thinking"   ? "\u00B7  \u00B7  \u00B7"
    : orbKey === "error"      ? "ERROR"
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      {/* Background gradient */}
      <LinearGradient
        colors={t.bgGrad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Content */}
      <View style={[s.content, { paddingTop: topPad }]}>

        {/* Conversation — fills upper space, aligns to bottom */}
        <View style={s.convoArea} pointerEvents="none">
          {msgs.map((m, i) => (
            <GhostLine key={m.id} msg={m} rank={msgs.length - 1 - i} t={t} />
          ))}
          {partialTranscript ? (
            <Animated.Text entering={FadeIn.duration(180)} style={[s.partial, { color: t.partial }]}>
              {partialTranscript}
            </Animated.Text>
          ) : null}
        </View>

        {/* Orb — centered hero element */}
        <Pressable onPress={handleOrbPress} hitSlop={32} style={s.orbArea}>
          {isDark
            ? <OrbRing orbKey={orbKey} />
            : <OrbSphere orbKey={orbKey} />}
        </Pressable>

        {/* Brand + state label below orb */}
        <View style={s.belowOrb}>
          <View style={s.brandRow}>
            {/* Waveform logo icon */}
            <Svg width={22} height={22} viewBox="0 0 32 32">
              <ClipPath id="logoClip"><Circle cx={16} cy={16} r={16} /></ClipPath>
              <Circle cx={16} cy={16} r={16} fill="#E8A020" />
              <Rect x={7}  y={12} width={2.6} height={8}  rx={1.3} fill="#140b05" clipPath="url(#logoClip)" />
              <Rect x={11.5} y={9} width={2.6} height={14} rx={1.3} fill="#140b05" clipPath="url(#logoClip)" />
              <Rect x={16} y={7}  width={2.6} height={18} rx={1.3} fill="#140b05" clipPath="url(#logoClip)" />
              <Rect x={20.5} y={9} width={2.6} height={14} rx={1.3} fill="#140b05" clipPath="url(#logoClip)" />
              <Rect x={25} y={12} width={2.6} height={8}  rx={1.3} fill="#140b05" clipPath="url(#logoClip)" />
            </Svg>
            <View style={s.brandWords}>
              <Text style={[s.brandBev, { color: t.logoText }]}>Bev</Text>
              <Text style={[s.brandPro, { color: "#E8A020" }]}>Pro</Text>
            </View>
          </View>
          <View style={{ height: 10 }} />
          {stateLabel ? (
            <Animated.Text key={stateLabel} entering={FadeIn.duration(600)} exiting={FadeOut.duration(400)}
              style={[s.stateLabel, { color: t.stateText }]}>
              {stateLabel}
            </Animated.Text>
          ) : orbKey === "disconnected" ? (
            <Text style={[s.tapHint, { color: t.tapHint }]}>tap to begin</Text>
          ) : null}
        </View>

        {/* Lower breathing room */}
        <View style={s.lower}>
          {agentState === "speaking" ? (
            <Pressable onPress={interrupt} hitSlop={28}>
              <View style={[s.interruptDot, { backgroundColor: isDark ? "rgba(200,180,255,0.30)" : "rgba(60,30,140,0.28)" }]} />
            </Pressable>
          ) : null}
          {error ? <Text style={[s.errorText, { color: t.errorText }]}>{error}</Text> : null}
        </View>
      </View>

      {/* Bottom bar */}
      <View style={[s.bottomBar, { paddingBottom: bottomPad + 18 }]}>
        <Pressable onPress={() => setPanelOpen(true)} hitSlop={22} style={s.hamburger}>
          <Feather name="menu" size={18} color={t.hamburger} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {orderCount > 0 ? (
          <Pressable onPress={() => { setPanelTab("order"); setPanelOpen(true); }} hitSlop={22}>
            <View style={[s.orderBadge, { borderColor: t.badgeBorder }]}>
              <Text style={[s.orderBadgeNum, { color: t.badgeText }]}>{orderCount}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Slide-up panel */}
      <Modal visible={panelOpen} transparent animationType="slide" onRequestClose={() => setPanelOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setPanelOpen(false)} />
        <View style={[s.panel, { backgroundColor: t.panelBg, borderColor: t.panelBorder, paddingBottom: bottomPad + 20 }]}>
          <View style={[s.panelHandle, { backgroundColor: t.panelHandle }]} />
          <View style={s.panelNav}>
            {(["order", "menu", "settings"] as const).map((tab) => (
              <Pressable key={tab} onPress={() => setPanelTab(tab)} style={s.panelNavBtn}>
                <Text style={[s.panelNavTxt, { color: panelTab === tab ? t.navActive : t.navText },
                  panelTab === tab && s.panelNavOn]}>
                  {tab}
                </Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPanelOpen(false)} style={{ marginLeft: "auto" }}>
              <Feather name="x" size={16} color={t.navText} />
            </Pressable>
          </View>

          {/* Order tab */}
          {panelTab === "order" && (() => {
            const items = currentOrder?.items ?? [];
            const total = currentOrder?.total ?? 0;
            if (lastSubmittedOrder) {
              return (
                <FlatList
                  data={lastSubmittedOrder.items}
                  keyExtractor={(it) => it.id}
                  contentContainerStyle={{ padding: 24, gap: 8 }}
                  ListHeaderComponent={
                    <View style={{ gap: 4, marginBottom: 16 }}>
                      <Text style={[s.recTotal, { color: t.recTotal }]}>${lastSubmittedOrder.total.toFixed(2)}</Text>
                      <Text style={[s.recLabel, { color: t.recLabel }]}>SUBMITTED</Text>
                      <View style={[s.divider, { backgroundColor: t.divider }]} />
                    </View>
                  }
                  renderItem={({ item }) => (
                    <View style={s.recRow}>
                      <Text style={[s.recQty, { color: t.rowQty }]}>{item.quantity}×</Text>
                      <Text style={[s.recName, { color: t.rowName }]}>{item.catalogItem.name}</Text>
                      <Text style={[s.recPrice, { color: t.rowPrice }]}>${(item.catalogItem.price * item.quantity).toFixed(2)}</Text>
                    </View>
                  )}
                  ListFooterComponent={
                    <Pressable onPress={() => Linking.openURL("https://squareup.com/dashboard/orders")} style={{ marginTop: 14 }}>
                      <Text style={[s.link, { color: t.link }]}>view in Square ↗</Text>
                    </Pressable>
                  }
                  showsVerticalScrollIndicator={false}
                />
              );
            }
            return items.length === 0 ? (
              <View style={s.emptyPanel}>
                <Text style={[s.emptyTxt, { color: t.emptyTxt }]}>no items yet</Text>
                <Text style={[s.emptyHint, { color: t.emptyHint }]}>speak to add items</Text>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <FlatList
                  data={items}
                  keyExtractor={(it) => it.id}
                  renderItem={({ item }) => (
                    <View style={{ marginBottom: 8 }}>
                      <OrderCard
                        lineItem={item}
                        onIncrement={() => updateQuantity(item.id, item.quantity + 1)}
                        onDecrement={() => updateQuantity(item.id, item.quantity - 1)}
                        onRemove={() => removeItem(item.id)}
                      />
                    </View>
                  )}
                  contentContainerStyle={{ padding: 16, paddingBottom: 130 }}
                  showsVerticalScrollIndicator={false}
                />
                <View style={[s.orderFooter, { backgroundColor: t.orderFtrBg, borderTopColor: t.divider }]}>
                  <Text style={[s.orderTotal, { color: t.orderTotal }]}>${total.toFixed(2)}</Text>
                  <View style={s.orderActions}>
                    <Pressable onPress={clearOrder} style={[s.clearBtn, { borderColor: t.clearBorder }]}>
                      <Feather name="trash-2" size={15} color={t.clearIcon} />
                    </Pressable>
                    <Pressable
                      onPress={async () => { if (!accessToken || !locationId) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); await submitOrder(accessToken, locationId); }}
                      disabled={isSubmitting || !isConfigured}
                      style={[s.submitBtn, { backgroundColor: t.submitBg, borderColor: t.submitBorder, opacity: isSubmitting || !isConfigured ? 0.45 : 1 }]}
                    >
                      {isSubmitting
                        ? <ActivityIndicator size="small" color={t.submitText} />
                        : <Text style={[s.submitTxt, { color: t.submitText }]}>process</Text>}
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })()}

          {/* Menu tab */}
          {panelTab === "menu" && (
            isLoadingCatalog ? (
              <View style={s.emptyPanel}><ActivityIndicator size="small" color={t.emptyTxt} /></View>
            ) : !isConfigured ? (
              <View style={s.emptyPanel}>
                <Text style={[s.emptyTxt, { color: t.emptyTxt }]}>square not connected</Text>
                <Pressable onPress={() => { setPanelOpen(false); router.push("/setup"); }} style={{ marginTop: 8 }}>
                  <Text style={[s.link, { color: t.link }]}>connect →</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={catalogItems}
                keyExtractor={(it) => it.id}
                renderItem={({ item }) => (
                  <Pressable style={[s.catRow, { borderBottomColor: t.divider }]}
                    onPress={() => { addItem(item, 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPanelTab("order"); }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.catName, { color: t.catName }]}>{item.name}</Text>
                      {item.category ? <Text style={[s.catCat, { color: t.catCat }]}>{item.category}</Text> : null}
                    </View>
                    <Text style={[s.catPrice, { color: t.catPrice }]}>${item.price.toFixed(2)}</Text>
                  </Pressable>
                )}
                showsVerticalScrollIndicator={false}
              />
            )
          )}

          {/* Settings tab */}
          {panelTab === "settings" && (
            <View style={s.settingsPanel}>
              {/* Square connection */}
              <Pressable style={[s.settingsRow, { borderBottomColor: t.divider }]}
                onPress={() => { setPanelOpen(false); router.push("/setup"); }}>
                <Feather name="link" size={16} color={t.settingsIcon} />
                <Text style={[s.settingsRowTxt, { color: t.settingsTxt }]}>Square Connection</Text>
                <View style={[s.statusDot, { backgroundColor: isConfigured ? "#22C55E" : "#EF4444" }]} />
                <Feather name="chevron-right" size={15} color={t.chevron} />
              </Pressable>

              {/* Reconnect */}
              {connectionError && (
                <View style={[s.settingsRow, { borderBottomColor: t.divider, flexDirection: "column", alignItems: "flex-start", gap: 6 }]}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: t.errorText }}>{connectionError}</Text>
                  <Pressable onPress={refreshCredentials} disabled={isReconnecting}
                    style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 12, backgroundColor: isDark ? "rgba(200,180,255,0.1)" : "rgba(30,10,80,0.06)" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: t.link }}>
                      {isReconnecting ? "Reconnecting..." : "Reconnect Square"}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Agent mode */}
              <View style={[s.settingsRow, { borderBottomColor: t.divider }]}>
                <Feather name="layers" size={16} color={t.settingsIcon} />
                <Text style={[s.settingsRowTxt, { color: t.settingsTxt }]}>Mode</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["pos", "inventory"] as const).map((mode) => (
                    <Pressable key={mode}
                      onPress={() => setAgentMode(mode)}
                      style={{
                        paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10,
                        backgroundColor: agentMode === mode
                          ? (isDark ? "rgba(200,180,255,0.14)" : "rgba(30,10,80,0.08)")
                          : "transparent",
                        borderWidth: agentMode === mode ? 0.5 : 0,
                        borderColor: isDark ? "rgba(200,180,255,0.24)" : "rgba(30,10,80,0.16)",
                      }}>
                      <Text style={{
                        fontFamily: agentMode === mode ? "Inter_400Regular" : "Inter_300Light",
                        fontSize: 12, color: agentMode === mode ? t.navActive : t.navText,
                      }}>{mode === "pos" ? "POS" : "Inventory"}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Voice */}
              <View style={[s.settingsRow, { borderBottomColor: t.divider, flexDirection: "column", alignItems: "flex-start", gap: 8 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Feather name="mic" size={16} color={t.settingsIcon} />
                  <Text style={[s.settingsRowTxt, { color: t.settingsTxt }]}>Voice</Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 28 }}>
                  {VOICES.map((v) => (
                    <Pressable key={v.id} onPress={() => setVoice(v.id)}
                      style={{
                        paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8,
                        backgroundColor: voice === v.id
                          ? (isDark ? "rgba(200,180,255,0.14)" : "rgba(30,10,80,0.08)")
                          : "transparent",
                        borderWidth: voice === v.id ? 0.5 : 0,
                        borderColor: isDark ? "rgba(200,180,255,0.24)" : "rgba(30,10,80,0.16)",
                      }}>
                      <Text style={{
                        fontFamily: voice === v.id ? "Inter_400Regular" : "Inter_300Light",
                        fontSize: 11, color: voice === v.id ? t.navActive : t.navText,
                      }}>{v.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Speed */}
              <View style={[s.settingsRow, { borderBottomColor: t.divider }]}>
                <Feather name="zap" size={16} color={t.settingsIcon} />
                <Text style={[s.settingsRowTxt, { color: t.settingsTxt }]}>Speed</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {SPEEDS.map((sp) => (
                    <Pressable key={sp.id} onPress={() => setSpeed(sp.id)}
                      style={{
                        paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8,
                        backgroundColor: speed === sp.id
                          ? (isDark ? "rgba(200,180,255,0.14)" : "rgba(30,10,80,0.08)")
                          : "transparent",
                        borderWidth: speed === sp.id ? 0.5 : 0,
                        borderColor: isDark ? "rgba(200,180,255,0.24)" : "rgba(30,10,80,0.16)",
                      }}>
                      <Text style={{
                        fontFamily: speed === sp.id ? "Inter_400Regular" : "Inter_300Light",
                        fontSize: 11, color: speed === sp.id ? t.navActive : t.navText,
                      }}>{sp.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1 },
  content: { flex: 1, flexDirection: "column" },

  convoArea: {
    flex: 1,
    alignItems: "center", justifyContent: "flex-end",
    paddingHorizontal: 36, paddingBottom: 32, gap: 10,
  },
  partial: {
    textAlign: "center", fontSize: 13, fontFamily: "Inter_300Light", fontStyle: "italic",
  },

  // Orb block
  orbArea:  { alignItems: "center", justifyContent: "center" },

  // Light mode sphere glow layers
  outerGlow: {
    position: "absolute",
    width: ORB + 90, height: ORB + 90, borderRadius: (ORB + 90) / 2,
  },
  midGlow: {
    position: "absolute",
    width: ORB + 44, height: ORB + 44, borderRadius: (ORB + 44) / 2,
  },

  // Below orb
  belowOrb: { alignItems: "center", paddingTop: 22 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandWords: { flexDirection: "row", alignItems: "baseline" },
  brandBev: {
    fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 1.5,
  },
  brandPro: {
    fontFamily: "Inter_500Medium", fontSize: 13, letterSpacing: 1.5, fontStyle: "italic",
  },
  stateLabel: {
    fontFamily: "Inter_300Light", fontSize: 9, letterSpacing: 3.5, textAlign: "center",
  },
  tapHint: {
    fontFamily: "Inter_300Light", fontSize: 10, letterSpacing: 2.5, textAlign: "center",
  },

  lower: {
    flex: 1, alignItems: "center", justifyContent: "flex-start",
    paddingTop: 28, gap: 10,
  },
  interruptDot: { width: 8, height: 8, borderRadius: 4 },
  errorText: {
    textAlign: "center", fontFamily: "Inter_300Light",
    fontSize: 11, paddingHorizontal: 40,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 30, paddingTop: 8,
  },
  hamburger:    { padding: 4 },
  orderBadge:   { minWidth: 22, height: 22, borderRadius: 11, borderWidth: 0.5, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  orderBadgeNum:{ fontFamily: "Inter_500Medium", fontSize: 11 },

  // Panel
  backdrop: { flex: 1 },
  panel: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderTopWidth: 0.5, maxHeight: "78%",
    shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 32,
    shadowOffset: { width: 0, height: -6 }, elevation: 14,
  },
  panelHandle: { width: 36, height: 3, borderRadius: 2, alignSelf: "center", marginTop: 14, marginBottom: 4 },
  panelNav:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingVertical: 12, gap: 22 },
  panelNavBtn: { paddingVertical: 4 },
  panelNavTxt: { fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 1, textTransform: "lowercase" },
  panelNavOn:  { fontFamily: "Inter_400Regular" },
  divider:     { height: 0.5, marginTop: 8 },
  link:        { fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 0.5, textDecorationLine: "underline" },

  recTotal: { fontFamily: "Inter_300Light", fontSize: 44, letterSpacing: -1.5 },
  recLabel: { fontFamily: "Inter_300Light", fontSize: 9, letterSpacing: 4, marginBottom: 8 },
  recRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  recQty:   { fontFamily: "Inter_400Regular", fontSize: 13, width: 28 },
  recName:  { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  recPrice: { fontFamily: "Inter_500Medium", fontSize: 13 },

  emptyPanel: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60, gap: 8 },
  emptyTxt:   { fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 0.5 },
  emptyHint:  { fontFamily: "Inter_300Light", fontSize: 11 },

  orderFooter:  { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20, borderTopWidth: 0.5 },
  orderTotal:   { fontFamily: "Inter_300Light", fontSize: 36, letterSpacing: -0.5, marginBottom: 14 },
  orderActions: { flexDirection: "row", gap: 12 },
  clearBtn:     { width: 50, height: 50, borderRadius: 25, borderWidth: 0.5, alignItems: "center", justifyContent: "center" },
  submitBtn:    { flex: 1, height: 50, borderRadius: 25, borderWidth: 0.5, alignItems: "center", justifyContent: "center" },
  submitTxt:    { fontFamily: "Inter_400Regular", fontSize: 14, letterSpacing: 1, textTransform: "lowercase" },

  catRow:   { flexDirection: "row", alignItems: "center", paddingVertical: 15, paddingHorizontal: 22, borderBottomWidth: 0.5 },
  catName:  { fontFamily: "Inter_400Regular", fontSize: 14 },
  catCat:   { fontFamily: "Inter_300Light", fontSize: 11 },
  catPrice: { fontFamily: "Inter_300Light", fontSize: 13 },

  settingsPanel:  { padding: 16 },
  settingsRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, paddingHorizontal: 8, borderBottomWidth: 0.5 },
  settingsRowTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14 },
  statusDot:      { width: 7, height: 7, borderRadius: 3.5 },
});
