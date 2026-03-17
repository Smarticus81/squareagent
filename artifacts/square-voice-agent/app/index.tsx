import React, {
  useEffect, useMemo, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ActivityIndicator, Linking, useColorScheme,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle, useSharedValue,
  withRepeat, withSequence, withTiming, FadeIn, FadeOut, Easing, SharedValue,
} from "react-native-reanimated";

import { useWakeWord, TERMINATE_PHRASES, isWakeWordSupported } from "@/hooks/useWakeWord";
import { useVoiceAgent, ConversationMessage, AgentState, OrderCommand } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP = 67;
const WEB_BOT = 34;
type OrbKey = AgentState | "wake";

// ── Waveform bar constants ─────────────────────────────────────────────────────
const N_BARS     = 26;
const BAR_W      = 3;
const MIN_BAR_H  = 3;
const WAVE_H     = 72;   // fixed container height

// Pre-computed per-bar params — stable module-level constant
const BAR_DATA = Array.from({ length: N_BARS }, (_, i) => {
  const center = (N_BARS - 1) / 2;
  const dist   = Math.abs(i - center) / center;
  return {
    maxMult: 1 - dist * 0.42,          // center bars taller
    freq:    6.2 + (i % 6) * 0.55,     // 6.2 – 8.95 cycles/s (time=seconds)
    phase:   i * 0.44,                  // traveling wave left→right
  };
});

// ── Theme ──────────────────────────────────────────────────────────────────────
const THEMES = {
  light: {
    bg:              "#F7F5F1",
    logoBorder:      "rgba(20,16,8,0.24)",
    logoBead:        "rgba(20,16,8,0.24)",
    logoText:        "rgba(20,16,8,0.60)",
    msgAgent:        (op: number) => `rgba(20,16,8,${op})`,
    msgUser:         (op: number) => `rgba(20,16,8,${op})`,
    stateText:       "rgba(20,16,8,0.34)",
    tapHint:         "rgba(20,16,8,0.22)",
    errorText:       "rgba(120,20,20,0.72)",
    hamburger:       "rgba(20,16,8,0.30)",
    panelBg:         "#FFFFFF",
    panelBorder:     "rgba(20,16,8,0.08)",
    panelHandle:     "rgba(20,16,8,0.14)",
    navText:         "rgba(20,16,8,0.30)",
    navActive:       "rgba(20,16,8,0.84)",
    divider:         "rgba(20,16,8,0.07)",
    recTotal:        "rgba(20,16,8,0.80)",
    recLabel:        "rgba(20,16,8,0.30)",
    rowName:         "rgba(20,16,8,0.70)",
    rowQty:          "rgba(20,16,8,0.34)",
    rowPrice:        "rgba(20,16,8,0.44)",
    emptyTxt:        "rgba(20,16,8,0.30)",
    emptyHint:       "rgba(20,16,8,0.18)",
    orderTotal:      "rgba(20,16,8,0.74)",
    orderFooterBg:   "#FFFFFF",
    clearBorder:     "rgba(160,40,40,0.26)",
    clearIcon:       "rgba(160,40,40,0.72)",
    submitBg:        "rgba(20,16,8,0.05)",
    submitBorder:    "rgba(20,16,8,0.18)",
    submitText:      "rgba(20,16,8,0.68)",
    catalogName:     "rgba(20,16,8,0.72)",
    catalogCat:      "rgba(20,16,8,0.32)",
    catalogPrice:    "rgba(20,16,8,0.40)",
    settingsText:    "rgba(20,16,8,0.70)",
    settingsIcon:    "rgba(20,16,8,0.44)",
    chevron:         "rgba(20,16,8,0.24)",
    link:            "rgba(18,58,138,0.72)",
    badgeBorder:     "rgba(20,16,8,0.18)",
    badgeText:       "rgba(20,16,8,0.58)",
    partial:         "rgba(20,16,8,0.28)",
    bars: {
      disconnected:  "rgba(20,16,8,0.13)",
      connecting:    "#C47828",
      listening:     "#1858A8",
      thinking:      "#786858",
      speaking:      "#18784A",
      error:         "#A82020",
      wake:          "#5818A8",
    },
  },
  dark: {
    bg:              "#09091A",
    logoBorder:      "rgba(255,255,255,0.28)",
    logoBead:        "rgba(255,255,255,0.28)",
    logoText:        "rgba(255,255,255,0.68)",
    msgAgent:        (op: number) => `rgba(255,255,255,${op})`,
    msgUser:         (op: number) => `rgba(255,255,255,${op})`,
    stateText:       "rgba(255,255,255,0.38)",
    tapHint:         "rgba(255,255,255,0.22)",
    errorText:       "rgba(252,120,120,0.82)",
    hamburger:       "rgba(255,255,255,0.28)",
    panelBg:         "#12121E",
    panelBorder:     "rgba(255,255,255,0.08)",
    panelHandle:     "rgba(255,255,255,0.14)",
    navText:         "rgba(255,255,255,0.30)",
    navActive:       "rgba(255,255,255,0.86)",
    divider:         "rgba(255,255,255,0.06)",
    recTotal:        "rgba(255,255,255,0.84)",
    recLabel:        "rgba(255,255,255,0.30)",
    rowName:         "rgba(255,255,255,0.72)",
    rowQty:          "rgba(255,255,255,0.34)",
    rowPrice:        "rgba(255,255,255,0.44)",
    emptyTxt:        "rgba(255,255,255,0.28)",
    emptyHint:       "rgba(255,255,255,0.16)",
    orderTotal:      "rgba(255,255,255,0.78)",
    orderFooterBg:   "#12121E",
    clearBorder:     "rgba(252,100,100,0.28)",
    clearIcon:       "rgba(252,100,100,0.72)",
    submitBg:        "rgba(255,255,255,0.06)",
    submitBorder:    "rgba(255,255,255,0.18)",
    submitText:      "rgba(255,255,255,0.72)",
    catalogName:     "rgba(255,255,255,0.72)",
    catalogCat:      "rgba(255,255,255,0.32)",
    catalogPrice:    "rgba(255,255,255,0.40)",
    settingsText:    "rgba(255,255,255,0.72)",
    settingsIcon:    "rgba(255,255,255,0.44)",
    chevron:         "rgba(255,255,255,0.22)",
    link:            "rgba(100,160,248,0.80)",
    badgeBorder:     "rgba(255,255,255,0.18)",
    badgeText:       "rgba(255,255,255,0.60)",
    partial:         "rgba(255,255,255,0.28)",
    bars: {
      disconnected:  "rgba(255,255,255,0.10)",
      connecting:    "#E89A38",
      listening:     "#4898E8",
      thinking:      "#D8C068",
      speaking:      "#38D898",
      error:         "#E84848",
      wake:          "#A870E8",
    },
  },
};

type ThemeKey = typeof THEMES.light;

// ── WaveformBar — single animated bar ─────────────────────────────────────────
function WaveformBar({ data, time, amplitude, color }: {
  data: typeof BAR_DATA[0];
  time: SharedValue<number>;
  amplitude: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({
    height: MIN_BAR_H + amplitude.value * data.maxMult *
            Math.abs(Math.sin(time.value * data.freq + data.phase)),
  }));
  return <Animated.View style={[s.bar, style, { backgroundColor: color }]} />;
}

// ── Waveform — row of animated bars ───────────────────────────────────────────
const AMP_MAP: Record<OrbKey, number> = {
  disconnected: 4,
  connecting:   10,
  listening:    46,
  thinking:     16,
  speaking:     60,
  error:        6,
  wake:         28,
};

function Waveform({ orbKey, color }: { orbKey: OrbKey; color: string }) {
  const time      = useSharedValue(0);
  const amplitude = useSharedValue(4);
  const waveOp    = useSharedValue(1);

  useEffect(() => {
    // Linear time tick — effectively infinite
    time.value = withTiming(9_000_000, { duration: 9_000_000_000, easing: Easing.linear });
  }, []);

  useEffect(() => {
    const target = AMP_MAP[orbKey] ?? 4;
    // Brief crossfade masks the color snap when state changes
    waveOp.value = withSequence(
      withTiming(0.10, { duration: 160 }),
      withTiming(1,    { duration: 380 }),
    );
    amplitude.value = withTiming(target, { duration: 460 });
  }, [orbKey]);

  const opStyle = useAnimatedStyle(() => ({ opacity: waveOp.value }));

  return (
    <Animated.View style={[s.waveformRow, opStyle]}>
      {BAR_DATA.map((data, i) => (
        <WaveformBar key={i} data={data} time={time} amplitude={amplitude} color={color} />
      ))}
    </Animated.View>
  );
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo({ t }: { t: ThemeKey }) {
  return (
    <View style={s.logoWrap}>
      <View style={s.logoMark}>
        <View style={[s.logoRing, { borderColor: t.logoBorder }]} />
        <View style={[s.logoBead, { backgroundColor: t.logoBead }]} />
      </View>
      <Text style={[s.logoWord, { color: t.logoText }]}>BEVPRO</Text>
    </View>
  );
}

// ── Conversation ghost text ───────────────────────────────────────────────────
function GhostLine({ msg, rank, t }: { msg: ConversationMessage; rank: number; t: ThemeKey }) {
  const isUser = msg.role === "user";
  const op = rank === 0 ? (isUser ? 0.42 : 0.84) : rank === 1 ? 0.26 : 0.12;
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

  // ── Contexts ───────────────────────────────────────────────────────────────
  const {
    agentState, isConnected, conversation, partialTranscript, error,
    connect, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId } = useSquare();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab,  setPanelTab]  = useState<"order" | "menu" | "settings">("order");

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
    const ti = setTimeout(() => {
      if (wakeModeRef.current !== "command") return;
      setWakeMode("wake"); startWakeWord();
    }, 350);
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

  // ── Sync ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({
      id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category,
    })));
  }, [catalogItems, setCatalog]);

  useEffect(() => {
    if (accessToken && locationId) setSquareCredentials(accessToken, locationId);
  }, [accessToken, locationId, setSquareCredentials]);

  useEffect(() => {
    setCurrentOrder((currentOrder?.items ?? []).map((i) => ({
      name: i.catalogItem.name, price: i.catalogItem.price, quantity: i.quantity,
    })));
  }, [currentOrder, setCurrentOrder]);

  // ── Order commands ─────────────────────────────────────────────────────────
  const handleCmds = useCallback((cmds: OrderCommand[]) => {
    for (const cmd of cmds) {
      switch (cmd.action) {
        case "add": {
          let found = cmd.item_id ? catalogItems.find((c) => c.id === cmd.item_id) : undefined;
          if (!found && cmd.item_name) {
            const n = cmd.item_name.toLowerCase();
            found = catalogItems.find((c) => c.name.toLowerCase() === n) ??
                    catalogItems.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
          }
          if (!found) break;
          addItem(found, cmd.quantity ?? 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        }
        case "remove": {
          const n = (cmd.item_name ?? "").toLowerCase();
          const line = currentOrder?.items.find((i) => i.catalogItem.name.toLowerCase() === n) ??
                       currentOrder?.items.find((i) => i.catalogItem.name.toLowerCase().includes(n));
          if (line) { removeItem(line.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
          break;
        }
        case "clear": clearOrder(); break;
        case "submit": {
          if (!accessToken || !locationId || !currentOrder?.items.length) break;
          submitOrder(accessToken, locationId).then((r) => {
            Haptics.notificationAsync(r.success
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Error);
            if (r.success) { setPanelTab("order"); setPanelOpen(true); }
          });
          break;
        }
      }
    }
  }, [catalogItems, currentOrder, addItem, removeItem, clearOrder, submitOrder, accessToken, locationId]);

  useEffect(() => { setToolHandler(handleCmds); }, [handleCmds, setToolHandler]);

  // ── Tap ────────────────────────────────────────────────────────────────────
  async function handleLogoPress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") {
      if (wakeMode === "wake")    { exitWake(); return; }
      if (wakeMode === "command") { disconnect(); return; }
      if (isWakeWordSupported())  { enterWake(); return; }
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
  const barColor   = t.bars[orbKey] ?? t.bars.disconnected;

  const stateLabel: string | null =
    wakeMode === "wake"       ? (wakeListening ? "HEY BAR" : "OPENING MIC\u2026")
    : orbKey === "connecting" ? "CONNECTING"
    : orbKey === "thinking"   ? "\u00B7  \u00B7  \u00B7"
    : orbKey === "error"      ? "ERROR"
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>

      {/* Dark mode gradient background */}
      {isDark && (
        <LinearGradient
          colors={["#0C0B22", "#080818", "#0C0B22"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* Content */}
      <View style={[s.content, { paddingTop: topPad }]}>

        {/* Conversation — floats above center */}
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

        {/* Center block — logo + waveform */}
        <Pressable onPress={handleLogoPress} hitSlop={40} style={s.centerBlock}>
          <Logo t={t} />
          <View style={{ height: 32 }} />
          <Waveform orbKey={orbKey} color={barColor} />
          <View style={{ height: 16 }} />
          {stateLabel ? (
            <Animated.Text key={stateLabel} entering={FadeIn.duration(600)} exiting={FadeOut.duration(400)}
              style={[s.stateLabel, { color: t.stateText }]}>
              {stateLabel}
            </Animated.Text>
          ) : orbKey === "disconnected" ? (
            <Text style={[s.tapHint, { color: t.tapHint }]}>tap to begin</Text>
          ) : null}
        </Pressable>

        {/* Lower breathing room */}
        <View style={s.lower}>
          {agentState === "speaking" ? (
            <Pressable onPress={interrupt} hitSlop={28} style={s.interruptBtn}>
              <View style={[s.interruptDot, { backgroundColor: isDark ? "rgba(255,255,255,0.28)" : "rgba(20,16,8,0.28)" }]} />
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

      {/* Panel */}
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

          {/* ── Order ── */}
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
                      <View style={[s.panelDivider, { backgroundColor: t.divider }]} />
                    </View>
                  }
                  renderItem={({ item }) => (
                    <View style={s.recRow}>
                      <Text style={[s.recQty,   { color: t.rowQty   }]}>{item.quantity}×</Text>
                      <Text style={[s.recName,  { color: t.rowName  }]}>{item.catalogItem.name}</Text>
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
                <Text style={[s.emptyTxt,  { color: t.emptyTxt  }]}>no items yet</Text>
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
                <View style={[s.orderFooter, { backgroundColor: t.orderFooterBg, borderTopColor: t.divider }]}>
                  <Text style={[s.orderTotal, { color: t.orderTotal }]}>${total.toFixed(2)}</Text>
                  <View style={s.orderActions}>
                    <Pressable onPress={clearOrder} style={[s.clearBtn, { borderColor: t.clearBorder }]}>
                      <Feather name="trash-2" size={15} color={t.clearIcon} />
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        if (!accessToken || !locationId) return;
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        await submitOrder(accessToken, locationId);
                      }}
                      disabled={isSubmitting || !isConfigured}
                      style={[s.submitBtn, { backgroundColor: t.submitBg, borderColor: t.submitBorder },
                        { opacity: isSubmitting || !isConfigured ? 0.45 : 1 }]}
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

          {/* ── Menu (catalog) ── */}
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
                  <Pressable
                    style={[s.catalogRow, { borderBottomColor: t.divider }]}
                    onPress={() => { addItem(item, 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPanelTab("order"); }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.catalogName, { color: t.catalogName }]}>{item.name}</Text>
                      {item.category ? <Text style={[s.catalogCat, { color: t.catalogCat }]}>{item.category}</Text> : null}
                    </View>
                    <Text style={[s.catalogPrice, { color: t.catalogPrice }]}>${item.price.toFixed(2)}</Text>
                  </Pressable>
                )}
                showsVerticalScrollIndicator={false}
              />
            )
          )}

          {/* ── Settings ── */}
          {panelTab === "settings" && (
            <View style={s.settingsPanel}>
              <Pressable style={[s.settingsRow, { borderBottomColor: t.divider }]}
                onPress={() => { setPanelOpen(false); router.push("/setup"); }}>
                <Feather name="link" size={16} color={t.settingsIcon} />
                <Text style={[s.settingsRowTxt, { color: t.settingsText }]}>Square Connection</Text>
                <View style={[s.statusDot, { backgroundColor: isConfigured ? "#18884A" : "#884818" }]} />
                <Feather name="chevron-right" size={15} color={t.chevron} />
              </Pressable>
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
    paddingHorizontal: 36, paddingBottom: 36, gap: 10,
  },
  partial: {
    textAlign: "center", fontSize: 13, fontFamily: "Inter_300Light",
    fontStyle: "italic",
  },

  // Center
  centerBlock: { alignItems: "center", paddingVertical: 4 },
  logoWrap:    { alignItems: "center", gap: 10 },
  logoMark:    { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  logoRing: {
    position: "absolute",
    width: 36, height: 36, borderRadius: 18, borderWidth: 0.75,
  },
  logoBead: {
    position: "absolute", top: 7, right: 7,
    width: 5.5, height: 5.5, borderRadius: 2.75,
  },
  logoWord: {
    fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 6,
  },

  // Waveform
  waveformRow: {
    height: WAVE_H,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  bar: {
    width: BAR_W,
    borderRadius: BAR_W / 2,
    marginHorizontal: 2,
  },

  stateLabel: {
    fontFamily: "Inter_300Light", fontSize: 9,
    letterSpacing: 3.5, textAlign: "center",
  },
  tapHint: {
    fontFamily: "Inter_300Light", fontSize: 10,
    letterSpacing: 2.5, textAlign: "center",
  },

  // Lower
  lower: {
    flex: 1, alignItems: "center", justifyContent: "flex-start",
    paddingTop: 28, gap: 8,
  },
  interruptBtn: { padding: 8 },
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
  hamburger: { padding: 4 },
  orderBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: "transparent",
    borderWidth: 0.5,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  orderBadgeNum: { fontFamily: "Inter_500Medium", fontSize: 11 },

  // Panel
  backdrop: { flex: 1 },
  panel: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    borderTopWidth: 0.5, maxHeight: "78%",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 30,
    shadowOffset: { width: 0, height: -6 }, elevation: 12,
  },
  panelHandle: {
    width: 36, height: 3, borderRadius: 2,
    alignSelf: "center", marginTop: 14, marginBottom: 4,
  },
  panelNav: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 22, paddingVertical: 12, gap: 22,
  },
  panelNavBtn: { paddingVertical: 4 },
  panelNavTxt: {
    fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 1, textTransform: "lowercase",
  },
  panelNavOn: { fontFamily: "Inter_400Regular" },
  panelDivider: { height: 0.5, marginTop: 8 },
  link: { fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 0.5, textDecorationLine: "underline" },

  // Receipt
  recTotal:  { fontFamily: "Inter_300Light", fontSize: 44, letterSpacing: -1.5 },
  recLabel:  { fontFamily: "Inter_300Light", fontSize: 9, letterSpacing: 4, marginBottom: 8 },
  recRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  recQty:    { fontFamily: "Inter_400Regular", fontSize: 13, width: 28 },
  recName:   { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  recPrice:  { fontFamily: "Inter_500Medium", fontSize: 13 },

  // Empty
  emptyPanel: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60, gap: 8 },
  emptyTxt:   { fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 0.5 },
  emptyHint:  { fontFamily: "Inter_300Light", fontSize: 11 },

  // Order footer
  orderFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20,
    borderTopWidth: 0.5,
  },
  orderTotal:  { fontFamily: "Inter_300Light", fontSize: 36, letterSpacing: -0.5, marginBottom: 14 },
  orderActions:{ flexDirection: "row", gap: 12 },
  clearBtn: {
    width: 50, height: 50, borderRadius: 25, borderWidth: 0.5,
    alignItems: "center", justifyContent: "center",
  },
  submitBtn: {
    flex: 1, height: 50, borderRadius: 25, borderWidth: 0.5,
    alignItems: "center", justifyContent: "center",
  },
  submitTxt: {
    fontFamily: "Inter_400Regular", fontSize: 14, letterSpacing: 1, textTransform: "lowercase",
  },

  // Catalog
  catalogRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 15, paddingHorizontal: 22, borderBottomWidth: 0.5,
  },
  catalogName:  { fontFamily: "Inter_400Regular", fontSize: 14 },
  catalogCat:   { fontFamily: "Inter_300Light", fontSize: 11 },
  catalogPrice: { fontFamily: "Inter_300Light", fontSize: 13 },

  // Settings
  settingsPanel: { padding: 16 },
  settingsRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 16, paddingHorizontal: 8, borderBottomWidth: 0.5,
  },
  settingsRowTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
});
