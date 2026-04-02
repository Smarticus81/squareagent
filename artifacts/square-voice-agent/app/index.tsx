import React, {
  useEffect, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ActivityIndicator, Linking, useColorScheme,
} from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
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
import { useVoiceAgent, ConversationMessage, AgentState, OrderCommand } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { useVoicePrefs, VOICES, SPEEDS } from "@/hooks/useVoicePrefs";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP = 67;
const WEB_BOT = 34;

// ── Rail colors per state ──────────────────────────────────────────────────────
type RailKey = AgentState | "wake";

const RAIL_COLORS = {
  light: {
    line:       "rgba(15,15,15,0.08)",
    glow:       "rgba(15,15,15,0.04)",
    active:     "rgba(15,15,15,0.35)",
    listening:  "rgba(80,140,255,0.50)",
    speaking:   "rgba(100,200,160,0.50)",
    thinking:   "rgba(180,160,220,0.40)",
    error:      "rgba(220,60,60,0.50)",
    bar:        "rgba(15,15,15,0.12)",
  },
  dark: {
    line:       "rgba(240,240,240,0.06)",
    glow:       "rgba(240,240,240,0.03)",
    active:     "rgba(240,240,240,0.30)",
    listening:  "rgba(100,160,255,0.55)",
    speaking:   "rgba(120,220,180,0.50)",
    thinking:   "rgba(200,180,240,0.40)",
    error:      "rgba(252,100,100,0.55)",
    bar:        "rgba(240,240,240,0.10)",
  },
} as const;

function railColors(key: RailKey, isDark: boolean) {
  const c = isDark ? RAIL_COLORS.dark : RAIL_COLORS.light;
  switch (key) {
    case "listening":    return { line: c.listening, glow: c.listening, glowOp: 0.15, bar: c.listening };
    case "speaking":     return { line: c.speaking,  glow: c.speaking,  glowOp: 0.20, bar: c.speaking  };
    case "thinking":     return { line: c.thinking,  glow: c.thinking,  glowOp: 0.10, bar: c.bar       };
    case "connecting":   return { line: c.active,    glow: c.glow,      glowOp: 0.05, bar: c.bar       };
    case "error":        return { line: c.error,     glow: c.error,     glowOp: 0.12, bar: c.bar       };
    case "wake":         return { line: c.active,    glow: c.active,    glowOp: 0.06, bar: c.bar       };
    default:             return { line: c.line,      glow: c.glow,      glowOp: 0,    bar: c.bar       };
  }
}

const NUM_BARS = 24;

// ── Theme ──────────────────────────────────────────────────────────────────────
const THEMES = {
  light: {
    bg:           "#F5F5F5" as const,
    bgGrad:       ["#F5F5F5", "#F0F0F0", "#F5F5F5"] as const,
    logoText:     "rgba(15,15,15,0.62)",
    stateText:    "rgba(15,15,15,0.48)",
    tapHint:      "rgba(15,15,15,0.35)",
    errorText:    "rgba(220,60,60,0.90)",
    hamburger:    "rgba(15,15,15,0.40)",
    badgeBorder:  "rgba(15,15,15,0.22)",
    badgeText:    "rgba(15,15,15,0.65)",
    msgAgent:     (op: number) => `rgba(15,15,15,${op})`,
    msgUser:      (op: number) => `rgba(15,15,15,${op})`,
    partial:      "rgba(15,15,15,0.42)",
    panelBg:      "#FFFFFF",
    panelBorder:  "rgba(15,15,15,0.10)",
    panelHandle:  "rgba(15,15,15,0.16)",
    navText:      "rgba(15,15,15,0.32)",
    navActive:    "rgba(15,15,15,0.84)",
    divider:      "rgba(15,15,15,0.08)",
    recTotal:     "rgba(15,15,15,0.82)",
    recLabel:     "rgba(15,15,15,0.30)",
    rowName:      "rgba(15,15,15,0.72)",
    rowQty:       "rgba(15,15,15,0.36)",
    rowPrice:     "rgba(15,15,15,0.46)",
    emptyTxt:     "rgba(15,15,15,0.30)",
    emptyHint:    "rgba(15,15,15,0.18)",
    orderTotal:   "rgba(15,15,15,0.76)",
    orderFtrBg:   "#FFFFFF",
    clearBorder:  "rgba(220,60,60,0.26)",
    clearIcon:    "rgba(220,60,60,0.74)",
    submitBg:     "rgba(15,15,15,0.06)",
    submitBorder: "rgba(15,15,15,0.18)",
    submitText:   "rgba(15,15,15,0.70)",
    catName:      "rgba(15,15,15,0.72)",
    catCat:       "rgba(15,15,15,0.36)",
    catPrice:     "rgba(15,15,15,0.44)",
    settingsTxt:  "rgba(15,15,15,0.72)",
    settingsIcon: "rgba(15,15,15,0.46)",
    chevron:      "rgba(15,15,15,0.26)",
    link:         "rgba(15,15,15,0.68)",
  },
  dark: {
    bg:           "#0A0A0A" as const,
    bgGrad:       ["#0A0A0A", "#0E0E0E", "#0A0A0A"] as const,
    logoText:     "rgba(240,240,240,0.62)",
    stateText:    "rgba(240,240,240,0.48)",
    tapHint:      "rgba(240,240,240,0.35)",
    errorText:    "rgba(252,120,120,0.90)",
    hamburger:    "rgba(240,240,240,0.40)",
    badgeBorder:  "rgba(240,240,240,0.22)",
    badgeText:    "rgba(240,240,240,0.65)",
    msgAgent:     (op: number) => `rgba(240,240,240,${op})`,
    msgUser:      (op: number) => `rgba(240,240,240,${op})`,
    partial:      "rgba(240,240,240,0.42)",
    panelBg:      "#141414",
    panelBorder:  "rgba(240,240,240,0.10)",
    panelHandle:  "rgba(240,240,240,0.16)",
    navText:      "rgba(240,240,240,0.32)",
    navActive:    "rgba(240,240,240,0.88)",
    divider:      "rgba(240,240,240,0.08)",
    recTotal:     "rgba(240,240,240,0.84)",
    recLabel:     "rgba(240,240,240,0.32)",
    rowName:      "rgba(240,240,240,0.72)",
    rowQty:       "rgba(240,240,240,0.36)",
    rowPrice:     "rgba(240,240,240,0.46)",
    emptyTxt:     "rgba(240,240,240,0.30)",
    emptyHint:    "rgba(240,240,240,0.18)",
    orderTotal:   "rgba(240,240,240,0.78)",
    orderFtrBg:   "#141414",
    clearBorder:  "rgba(252,100,100,0.28)",
    clearIcon:    "rgba(252,100,100,0.74)",
    submitBg:     "rgba(240,240,240,0.06)",
    submitBorder: "rgba(240,240,240,0.18)",
    submitText:   "rgba(240,240,240,0.68)",
    catName:      "rgba(240,240,240,0.72)",
    catCat:       "rgba(240,240,240,0.36)",
    catPrice:     "rgba(240,240,240,0.44)",
    settingsTxt:  "rgba(240,240,240,0.74)",
    settingsIcon: "rgba(240,240,240,0.48)",
    chevron:      "rgba(240,240,240,0.26)",
    link:         "rgba(240,240,240,0.65)",
  },
};

// ── Animated waveform bar ──────────────────────────────────────────────────────
function RailBar({ index, active, color }: { index: number; active: boolean; color: string }) {
  const height = useSharedValue(4);
  useEffect(() => {
    const delay = index * 60;
    if (active) {
      height.value = withRepeat(
        withSequence(
          withTiming(4,  { duration: 0 }),
          withTiming(18, { duration: 300 + delay * 0.15, easing: Easing.out(Easing.sin) }),
          withTiming(4,  { duration: 300 + delay * 0.15, easing: Easing.in(Easing.sin) }),
        ), -1,
      );
    } else {
      height.value = withRepeat(
        withSequence(
          withTiming(3, { duration: 1200 + delay * 0.4, easing: Easing.inOut(Easing.sin) }),
          withTiming(6, { duration: 1200 + delay * 0.4, easing: Easing.inOut(Easing.sin) }),
        ), -1,
      );
    }
  }, [active, index]);
  const barStyle = useAnimatedStyle(() => ({ height: height.value }));
  return (
    <Animated.View style={[barStyle, { width: 3, borderRadius: 2, backgroundColor: color }]} />
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
    agentState, isConnected, conversation, partialTranscript, error,
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
    if (wakeModeRef.current !== "command" || isConnected) return;
    const ti = setTimeout(() => { if (wakeModeRef.current !== "command") return; setWakeMode("wake"); startWakeWord(); }, 350);
    return () => clearTimeout(ti);
  }, [isConnected, startWakeWord]);

  useEffect(() => {
    if (wakeMode !== "command") return;
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
    if (wakeMode === "wake") {
      exitWake(); return;
    }
    if (isConnected || agentState === "connecting") disconnect();
    else await connect();
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const railKey: RailKey = wakeMode === "wake" ? "wake"
    : wakeMode === "command" ? agentState
    : agentState;

  const msgs       = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;
  const rc         = railColors(railKey, isDark);
  const showWaveform = agentState === "speaking" || agentState === "listening";

  const stateLabel: string | null =
    wakeMode === "wake"        ? (wakeListening ? "READY" : "STARTING")
    : railKey === "connecting" ? "CONNECTING"
    : railKey === "thinking"   ? "THINKING"
    : railKey === "listening"  ? "LISTENING"
    : railKey === "speaking"   ? "SPEAKING"
    : railKey === "error"      ? "ERROR"
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

      {/* ── Top bar (hamburger | brand | order badge) ────────────── */}
      <View style={[s.topBar, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => setPanelOpen(true)} hitSlop={22} style={s.hamburger}>
          <Feather name="menu" size={18} color={t.hamburger} />
        </Pressable>

        <View style={s.brandRow}>
          <Svg width={24} height={24} viewBox="0 0 36 36">
            <Circle cx={18} cy={18} r={17} fill="#E8A020" />
            <Rect x={5.5} y={13} width={3} height={10} rx={1.5} fill="#140b05" />
            <Rect x={11} y={10} width={3} height={16} rx={1.5} fill="#140b05" />
            <Rect x={16.5} y={7} width={3} height={22} rx={1.5} fill="#140b05" />
            <Rect x={22} y={10} width={3} height={16} rx={1.5} fill="#140b05" />
            <Rect x={27.5} y={13} width={3} height={10} rx={1.5} fill="#140b05" />
          </Svg>
          <View style={s.brandWords}>
            <Text style={[s.brandBev, { color: t.logoText }]}>Bev</Text>
            <Text style={[s.brandPro, { color: "#E8A020" }]}>Pro</Text>
          </View>
        </View>

        {orderCount > 0 ? (
          <Pressable onPress={() => { setPanelTab("order"); setPanelOpen(true); }} hitSlop={22}>
            <View style={[s.orderBadge, { borderColor: t.badgeBorder }]}>
              <Text style={[s.orderBadgeNum, { color: t.badgeText }]}>{orderCount}</Text>
            </View>
          </Pressable>
        ) : <View style={{ width: 22 }} />}
      </View>

      {/* ── Content (conversation area fills space) ──────────────── */}
      <View style={s.content}>
        {/* Watermark */}
        <View style={s.watermark} pointerEvents="none">
          <Svg width={120} height={120} viewBox="0 0 36 36">
            <Circle cx={18} cy={18} r={17} fill="#E8A020" opacity={0.07} />
            <Rect x={5.5} y={13} width={3} height={10} rx={1.5} fill="#E8A020" opacity={0.09} />
            <Rect x={11} y={10} width={3} height={16} rx={1.5} fill="#E8A020" opacity={0.09} />
            <Rect x={16.5} y={7} width={3} height={22} rx={1.5} fill="#E8A020" opacity={0.09} />
            <Rect x={22} y={10} width={3} height={16} rx={1.5} fill="#E8A020" opacity={0.09} />
            <Rect x={27.5} y={13} width={3} height={10} rx={1.5} fill="#E8A020" opacity={0.09} />
          </Svg>
        </View>

        {/* Conversation ghost text */}
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

        {/* Status messages */}
        <View style={s.statusArea}>
          {error ? <Text style={[s.errorText, { color: t.errorText }]}>{error}</Text> : null}
        </View>
      </View>

      {/* ── Bar Rail Zone ────────────────────────────────────────── */}
      <Pressable onPress={handleOrbPress} style={[s.railZone, { paddingBottom: bottomPad + 22 }]}>
        {/* State label / tap hint */}
        <View style={s.railLabelRow}>
          {stateLabel ? (
            <Animated.Text key={stateLabel} entering={FadeIn.duration(400)} exiting={FadeOut.duration(300)}
              style={[s.railLabel, { color: t.stateText }]}>
              {stateLabel}
            </Animated.Text>
          ) : railKey === "disconnected" && wakeMode === "idle" ? (
            <Text style={[s.railHint, { color: t.tapHint }]}>tap to begin</Text>
          ) : null}
        </View>

        {/* The rail itself */}
        <View style={s.barRail}>
          {/* Glow behind rail */}
          <View style={[s.railGlow, { backgroundColor: rc.glow, opacity: rc.glowOp }]} />
          {/* Main rail line */}
          <View style={[s.railLine, {
            backgroundColor: rc.line,
            opacity: railKey === "disconnected" ? 0.5 : 1,
            height: ["listening", "speaking", "error"].includes(railKey) ? 3 : 2,
          }]} />
          {/* Waveform bars */}
          {showWaveform && (
            <View style={s.railWaveform}>
              {Array.from({ length: NUM_BARS }).map((_, i) => (
                <RailBar key={i} index={i} active={agentState === "speaking"} color={agentState === "speaking" ? rc.bar : rc.bar} />
              ))}
            </View>
          )}
        </View>

        {/* Interrupt hint + wake toggle row */}
        <View style={s.railFooter}>
          {/* Wake word toggle on the left */}
          {isWakeWordSupported() && agentState === "disconnected" ? (
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); wakeMode === "idle" ? enterWake() : exitWake(); }}
              hitSlop={22}
              style={s.wakeBtn}
            >
              <Feather
                name={wakeMode === "idle" ? "mic" : "mic-off"}
                size={16}
                color={wakeMode === "idle" ? t.hamburger : "#E8A020"}
              />
            </Pressable>
          ) : <View style={{ width: 24 }} />}

          {/* Interrupt hint centered */}
          {agentState === "speaking" ? (
            <Animated.Text entering={FadeIn.duration(400)} style={[s.interruptHint, { color: t.tapHint }]}>
              tap to interrupt
            </Animated.Text>
          ) : <View style={{ flex: 1 }} />}

          <View style={{ width: 24 }} />
        </View>
      </Pressable>

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

  // Top bar
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingBottom: 8,
  },
  hamburger:    { padding: 4 },
  brandRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  brandWords:   { flexDirection: "row", alignItems: "baseline" },
  brandBev:     { fontFamily: "Inter_300Light", fontSize: 16, letterSpacing: -0.3, fontWeight: "700" },
  brandPro:     { fontFamily: "Inter_500Medium", fontSize: 16, letterSpacing: -0.3, fontWeight: "700", fontStyle: "italic" },
  orderBadge:   { minWidth: 24, height: 24, borderRadius: 8, borderWidth: 0.5, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  orderBadgeNum:{ fontFamily: "Inter_500Medium", fontSize: 12 },

  // Content
  content: { flex: 1, flexDirection: "column" },

  watermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
  },

  convoArea: {
    flex: 1,
    alignItems: "center", justifyContent: "flex-end",
    paddingHorizontal: 36, paddingBottom: 24, gap: 10,
  },
  partial: {
    textAlign: "center", fontSize: 14, fontFamily: "Inter_300Light", fontStyle: "italic",
  },

  statusArea: {
    alignItems: "center", gap: 6, paddingHorizontal: 36, paddingBottom: 12,
  },
  errorText: {
    textAlign: "center", fontFamily: "Inter_300Light",
    fontSize: 13, paddingHorizontal: 20,
  },

  // Bar rail zone
  railZone: {
    paddingHorizontal: 24, paddingTop: 8,
  },
  railLabelRow: {
    alignItems: "center", justifyContent: "center",
    paddingBottom: 10, minHeight: 26,
  },
  railLabel: {
    fontFamily: "Inter_300Light", fontSize: 11, letterSpacing: 3.5,
    textAlign: "center", textTransform: "uppercase",
  },
  railHint: {
    fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 2.5,
    textAlign: "center",
  },
  barRail: {
    height: 28, alignItems: "center", justifyContent: "center",
  },
  railGlow: {
    position: "absolute", left: "10%", right: "10%", height: 20,
    borderRadius: 10,
  },
  railLine: {
    position: "absolute", left: "5%", right: "5%", height: 2,
    borderRadius: 1,
  },
  railWaveform: {
    position: "absolute", left: "15%", right: "15%", height: 28,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3,
  },
  railFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 6, minHeight: 28,
  },
  wakeBtn:      { padding: 4 },
  interruptHint: {
    flex: 1, textAlign: "center",
    fontFamily: "Inter_300Light", fontSize: 9, letterSpacing: 2,
  },

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
