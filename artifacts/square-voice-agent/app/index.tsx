import React, {
  useEffect, useMemo, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ActivityIndicator, Linking, useWindowDimensions,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedProps, useAnimatedStyle, useSharedValue,
  withRepeat, withSequence, withTiming,
  FadeIn, FadeOut, Easing, SharedValue,
} from "react-native-reanimated";

import Colors from "@/constants/colors";
import { useWakeWord, TERMINATE_PHRASES, isWakeWordSupported } from "@/hooks/useWakeWord";
import { useVoiceAgent, ConversationMessage, AgentState, OrderCommand } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { OrderCard } from "@/components/OrderCard";

// ── Animated SVG ──────────────────────────────────────────────────────────────
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const WEB_TOP = 67;
const WEB_BOT = 34;
type OrbKey = AgentState | "wake";

// ── Particle ──────────────────────────────────────────────────────────────────
interface P {
  bx: number; by: number;
  r: number;
  ax: number; ay: number;
  fx: number; fy: number; fo: number;
  px: number; py: number; po: number;
  bo: number;
}

function mkParticles(W: number, H: number, n: number): P[] {
  return Array.from({ length: n }, () => ({
    bx: Math.random() * W,
    by: Math.random() * H,
    r:  1.5 + Math.random() * 3.5,     // 1.5 – 5px, clearly visible
    ax: 8  + Math.random() * 24,
    ay: 8  + Math.random() * 24,
    fx: 0.00013 + Math.random() * 0.00044,
    fy: 0.00011 + Math.random() * 0.00040,
    fo: 0.00009 + Math.random() * 0.00034,
    px: Math.random() * Math.PI * 2,
    py: Math.random() * Math.PI * 2,
    po: Math.random() * Math.PI * 2,
    bo: 0.38 + Math.random() * 0.52,   // 0.38 – 0.90, clearly visible
  }));
}

function Dot({ p, time, fill }: { p: P; time: SharedValue<number>; fill: string }) {
  const ap = useAnimatedProps(() => ({
    cx: p.bx + Math.sin(time.value * p.fx + p.px) * p.ax,
    cy: p.by + Math.sin(time.value * p.fy + p.py) * p.ay,
    opacity: p.bo * (0.12 + 0.88 * ((1 + Math.sin(time.value * p.fo + p.po)) * 0.5)),
  }));
  return <AnimatedCircle animatedProps={ap} r={p.r} fill={fill} />;
}

// ── Palette ───────────────────────────────────────────────────────────────────
interface Pal { dot: string; glow: string; edge: string }

const PAL: Record<OrbKey, Pal> = {
  disconnected: { dot: "#5C3E08", glow: "rgba(160,118,20,0.18)",  edge: "rgba(175,138,44,0.20)" },
  connecting:   { dot: "#6A3010", glow: "rgba(170,84,22,0.20)",   edge: "rgba(190,100,38,0.22)" },
  listening:    { dot: "#0E3E6E", glow: "rgba(20,96,180,0.20)",   edge: "rgba(36,112,196,0.22)" },
  thinking:     { dot: "#302828", glow: "rgba(100,88,88,0.16)",   edge: "rgba(120,108,108,0.18)" },
  speaking:     { dot: "#0E3E28", glow: "rgba(18,100,64,0.20)",   edge: "rgba(32,120,80,0.22)" },
  error:        { dot: "#600A0A", glow: "rgba(150,24,24,0.18)",   edge: "rgba(170,40,40,0.20)" },
  wake:         { dot: "#340A70", glow: "rgba(88,32,172,0.20)",   edge: "rgba(108,48,192,0.22)" },
};

// ── Full-screen particle cloud ────────────────────────────────────────────────
function ParticleCloud({ W, H, orbKey }: { W: number; H: number; orbKey: OrbKey }) {
  const { dot } = PAL[orbKey] ?? PAL.disconnected;
  const particles = useMemo(() => mkParticles(W, H, 52), [W, H]);
  const time = useSharedValue(0);

  useEffect(() => {
    time.value = withTiming(9_000_000, { duration: 9_000_000_000, easing: Easing.linear });
  }, []);

  const cloudOp = useSharedValue(0.78);
  useEffect(() => {
    const t = (orbKey === "listening" || orbKey === "speaking" || orbKey === "wake")
      ? 1.0 : orbKey === "thinking" ? 0.58 : 0.78;
    cloudOp.value = withTiming(t, { duration: 700 });
  }, [orbKey]);

  const cloudStyle = useAnimatedStyle(() => ({ opacity: cloudOp.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, cloudStyle]} pointerEvents="none">
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {particles.map((p, i) => (
          <Dot key={i} p={p} time={time} fill={dot} />
        ))}
      </Svg>
    </Animated.View>
  );
}

// ── Center glow — lives INSIDE the logo container ────────────────────────────
function useGlowAnim(orbKey: OrbKey) {
  const sc = useSharedValue(1);
  const op = useSharedValue(0.88);

  useEffect(() => {
    if (orbKey === "listening") {
      sc.value = withRepeat(withSequence(
        withTiming(1.18, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.00, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      ), -1);
      op.value = withTiming(1.0, { duration: 500 });
    } else if (orbKey === "speaking") {
      sc.value = withRepeat(withSequence(
        withTiming(1.50, { duration: 480, easing: Easing.out(Easing.quad) }),
        withTiming(1.15, { duration: 480, easing: Easing.in(Easing.quad) }),
      ), -1);
      op.value = withTiming(1.0, { duration: 300 });
    } else if (orbKey === "wake") {
      sc.value = withRepeat(withSequence(
        withTiming(1.28, { duration: 2900, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.00, { duration: 2900, easing: Easing.inOut(Easing.sin) }),
      ), -1);
      op.value = withTiming(1.0, { duration: 500 });
    } else if (orbKey === "thinking") {
      sc.value = withRepeat(withSequence(
        withTiming(0.90, { duration: 1100 }), withTiming(0.97, { duration: 1100 }),
      ), -1);
      op.value = withTiming(0.62, { duration: 600 });
    } else {
      sc.value = withTiming(1, { duration: 800 });
      op.value = withTiming(0.88, { duration: 700 });
    }
  }, [orbKey]);

  return useAnimatedStyle(() => ({
    transform: [{ scale: sc.value }],
    opacity: op.value,
  }));
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <View style={s.logoWrap}>
      <View style={s.logoMark}>
        <View style={s.logoRing} />
        <View style={s.logoBead} />
      </View>
      <Text style={s.logoWord}>BEVPRO</Text>
    </View>
  );
}

// ── Conversation ghost text ───────────────────────────────────────────────────
function GhostLine({ msg, rank }: { msg: ConversationMessage; rank: number }) {
  const isUser = msg.role === "user";
  const op = rank === 0 ? (isUser ? 0.42 : 0.80) : rank === 1 ? 0.26 : 0.12;
  const sz = rank === 0 ? (isUser ? 14 : 16) : 13;
  return (
    <Animated.Text
      entering={FadeIn.duration(500)}
      exiting={FadeOut.duration(400)}
      style={{
        textAlign: "center", fontSize: sz, lineHeight: 24,
        fontFamily: isUser ? "Inter_300Light" : "Inter_400Regular",
        color: `rgba(20,16,8,${op})`, letterSpacing: 0.1,
      }}
    >
      {msg.content}
    </Animated.Text>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const topPad    = Platform.OS === "web" ? WEB_TOP  : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOT  : insets.bottom;

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
    const t = setTimeout(() => {
      if (wakeModeRef.current !== "command") return;
      setWakeMode("wake"); startWakeWord();
    }, 350);
    return () => clearTimeout(t);
  }, [isConnected, startWakeWord]);

  useEffect(() => {
    if (Platform.OS !== "web" || wakeMode !== "command") return;
    const last = [...conversation].reverse().find((m) => m.role === "user");
    if (!last) return;
    if (TERMINATE_PHRASES.some((p) => last.content.toLowerCase().includes(p))) {
      const t = setTimeout(() => disconnect(), 1600);
      return () => clearTimeout(t);
    }
  }, [conversation, wakeMode, disconnect]);

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
  const edgeColor  = PAL[orbKey]?.edge ?? PAL.disconnected.edge;
  const glowColor  = PAL[orbKey]?.glow ?? PAL.disconnected.glow;
  const glowStyle  = useGlowAnim(orbKey);

  const stateLabel: { t: string; c: string } | null =
    wakeMode === "wake"
      ? { t: wakeListening ? "HEY BAR" : "OPENING MIC…", c: "rgba(52,10,112,0.58)" }
      : orbKey === "connecting" ? { t: "CONNECTING", c: "rgba(106,48,16,0.55)" }
      : orbKey === "thinking"   ? { t: "\u00B7  \u00B7  \u00B7", c: "rgba(48,40,40,0.48)" }
      : orbKey === "error"      ? { t: "ERROR", c: "rgba(96,10,10,0.62)" }
      : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>

      {/* Particle cloud — full screen, behind everything */}
      <ParticleCloud W={W} H={H} orbKey={orbKey} />

      {/* Edge glow overlays — state-colored */}
      <View style={s.edgeTop} pointerEvents="none">
        <LinearGradient colors={[edgeColor, "transparent"]} style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
      </View>
      <View style={s.edgeBot} pointerEvents="none">
        <LinearGradient colors={["transparent", edgeColor]} style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
      </View>
      <View style={s.edgeLeft} pointerEvents="none">
        <LinearGradient colors={[edgeColor, "transparent"]} style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} />
      </View>
      <View style={s.edgeRight} pointerEvents="none">
        <LinearGradient colors={[edgeColor, "transparent"]} style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} />
      </View>

      {/* Main content */}
      <View style={[s.content, { paddingTop: topPad }]}>

        {/* Upper: conversation */}
        <View style={s.convoArea} pointerEvents="none">
          {msgs.map((m, i) => (
            <GhostLine key={m.id} msg={m} rank={msgs.length - 1 - i} />
          ))}
          {partialTranscript ? (
            <Animated.Text entering={FadeIn.duration(180)} style={s.partial}>
              {partialTranscript}
            </Animated.Text>
          ) : null}
        </View>

        {/* Center: logo inside glow bubble */}
        <View style={s.centerWrapper}>
          {/* Glow circle fills the wrapper, scales behind the logo */}
          <Animated.View
            style={[StyleSheet.absoluteFill, s.glowCircle, { backgroundColor: glowColor }, glowStyle]}
            pointerEvents="none"
          />
          <Pressable onPress={handleLogoPress} hitSlop={60} style={s.logoBtn}>
            <Logo />
          </Pressable>
        </View>

        {/* State label / tap hint below center */}
        <View style={s.belowCenter}>
          {stateLabel ? (
            <Animated.Text key={stateLabel.t} entering={FadeIn.duration(600)} exiting={FadeOut.duration(400)}
              style={[s.stateLabel, { color: stateLabel.c }]}>
              {stateLabel.t}
            </Animated.Text>
          ) : orbKey === "disconnected" ? (
            <Text style={s.tapHint}>tap to begin</Text>
          ) : null}
        </View>

        {/* Lower breathing area */}
        <View style={s.lowerArea}>
          {agentState === "speaking" ? (
            <Pressable onPress={interrupt} hitSlop={24}>
              <View style={s.interruptDot} />
            </Pressable>
          ) : null}
          {error ? <Text style={s.errorText}>{error}</Text> : null}
        </View>
      </View>

      {/* Bottom bar */}
      <View style={[s.bottomBar, { paddingBottom: bottomPad + 18 }]}>
        <Pressable onPress={() => setPanelOpen(true)} hitSlop={22} style={s.hamburger}>
          <Feather name="menu" size={18} color="rgba(20,16,8,0.32)" />
        </Pressable>
        <View style={{ flex: 1 }} />
        {orderCount > 0 ? (
          <Pressable onPress={() => { setPanelTab("order"); setPanelOpen(true); }} hitSlop={22}>
            <View style={s.orderBadge}>
              <Text style={s.orderBadgeNum}>{orderCount}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* ── Slide-up panel ── */}
      <Modal visible={panelOpen} transparent animationType="slide" onRequestClose={() => setPanelOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setPanelOpen(false)} />
        <View style={[s.panel, { paddingBottom: bottomPad + 20 }]}>
          <View style={s.panelHandle} />

          <View style={s.panelNav}>
            {(["order", "menu", "settings"] as const).map((tab) => (
              <Pressable key={tab} onPress={() => setPanelTab(tab)} style={s.panelNavBtn}>
                <Text style={[s.panelNavTxt, panelTab === tab && s.panelNavOn]}>{tab}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPanelOpen(false)} style={{ marginLeft: "auto" }}>
              <Feather name="x" size={16} color="rgba(20,16,8,0.28)" />
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
                      <Text style={s.receiptTotal}>${lastSubmittedOrder.total.toFixed(2)}</Text>
                      <Text style={s.receiptLabel}>SUBMITTED</Text>
                      <View style={s.panelDivider} />
                    </View>
                  }
                  renderItem={({ item }) => (
                    <View style={s.receiptRow}>
                      <Text style={s.receiptQty}>{item.quantity}×</Text>
                      <Text style={s.receiptName}>{item.catalogItem.name}</Text>
                      <Text style={s.receiptPrice}>${(item.catalogItem.price * item.quantity).toFixed(2)}</Text>
                    </View>
                  )}
                  ListFooterComponent={
                    <Pressable onPress={() => Linking.openURL("https://squareup.com/dashboard/orders")} style={{ marginTop: 14 }}>
                      <Text style={s.panelLink}>view in Square ↗</Text>
                    </Pressable>
                  }
                  showsVerticalScrollIndicator={false}
                />
              );
            }

            return items.length === 0 ? (
              <View style={s.emptyPanel}>
                <Text style={s.emptyTxt}>no items yet</Text>
                <Text style={s.emptyHint}>speak to add items</Text>
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
                <View style={s.orderFooter}>
                  <Text style={s.orderTotal}>${total.toFixed(2)}</Text>
                  <View style={s.orderActions}>
                    <Pressable onPress={clearOrder} style={s.clearBtn}>
                      <Feather name="trash-2" size={15} color="rgba(160,40,40,0.70)" />
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        if (!accessToken || !locationId) return;
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        await submitOrder(accessToken, locationId);
                      }}
                      disabled={isSubmitting || !isConfigured}
                      style={[s.submitBtn, { opacity: isSubmitting || !isConfigured ? 0.45 : 1 }]}
                    >
                      {isSubmitting
                        ? <ActivityIndicator size="small" color="rgba(20,16,8,0.6)" />
                        : <Text style={s.submitTxt}>process</Text>}
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })()}

          {/* ── Menu (catalog) ── */}
          {panelTab === "menu" && (
            isLoadingCatalog ? (
              <View style={s.emptyPanel}>
                <ActivityIndicator size="small" color="rgba(20,16,8,0.25)" />
              </View>
            ) : !isConfigured ? (
              <View style={s.emptyPanel}>
                <Text style={s.emptyTxt}>square not connected</Text>
                <Pressable onPress={() => { setPanelOpen(false); router.push("/setup"); }}>
                  <Text style={[s.panelLink, { marginTop: 8 }]}>connect →</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={catalogItems}
                keyExtractor={(it) => it.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={s.catalogRow}
                    onPress={() => { addItem(item, 1); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPanelTab("order"); }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.catalogName}>{item.name}</Text>
                      {item.category ? <Text style={s.catalogCat}>{item.category}</Text> : null}
                    </View>
                    <Text style={s.catalogPrice}>${item.price.toFixed(2)}</Text>
                  </Pressable>
                )}
                showsVerticalScrollIndicator={false}
              />
            )
          )}

          {/* ── Settings ── */}
          {panelTab === "settings" && (
            <View style={s.settingsPanel}>
              <Pressable style={s.settingsRow} onPress={() => { setPanelOpen(false); router.push("/setup"); }}>
                <Feather name="link" size={16} color="rgba(20,16,8,0.45)" />
                <Text style={s.settingsRowTxt}>Square Connection</Text>
                <View style={[s.statusDot, { backgroundColor: isConfigured ? "#167A3C" : "#7A3016" }]} />
                <Feather name="chevron-right" size={15} color="rgba(20,16,8,0.25)" />
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
  root: { flex: 1, backgroundColor: "#F5F3EE" },

  // Edges
  edgeTop:   { position: "absolute", top: 0, left: 0, right: 0, height: 200 },
  edgeBot:   { position: "absolute", bottom: 0, left: 0, right: 0, height: 200 },
  edgeLeft:  { position: "absolute", top: 0, bottom: 0, left: 0, width: 140 },
  edgeRight: { position: "absolute", top: 0, bottom: 0, right: 0, width: 140 },

  // Content
  content: { flex: 1, flexDirection: "column" },
  convoArea: {
    flex: 1,
    alignItems: "center", justifyContent: "flex-end",
    paddingHorizontal: 40, paddingBottom: 40, gap: 10,
  },
  partial: {
    textAlign: "center", fontSize: 13, fontFamily: "Inter_300Light",
    color: "rgba(20,16,8,0.30)", fontStyle: "italic",
  },

  // Center logo + glow
  centerWrapper: {
    width: 280, height: 280,
    alignSelf: "center",
    alignItems: "center", justifyContent: "center",
  },
  glowCircle: { borderRadius: 140 },
  logoBtn: { alignItems: "center" },
  logoWrap: { alignItems: "center", gap: 10 },
  logoMark: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  logoRing: {
    position: "absolute",
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 0.75, borderColor: "rgba(20,16,8,0.28)",
  },
  logoBead: {
    position: "absolute", top: 7, right: 7,
    width: 5.5, height: 5.5, borderRadius: 2.75,
    backgroundColor: "rgba(20,16,8,0.28)",
  },
  logoWord: {
    fontFamily: "Inter_300Light",
    fontSize: 12, letterSpacing: 6,
    color: "rgba(20,16,8,0.58)",
  },

  // Below center
  belowCenter: { alignItems: "center", height: 40, justifyContent: "center" },
  stateLabel: {
    fontFamily: "Inter_300Light", fontSize: 9,
    letterSpacing: 3.5, textAlign: "center",
  },
  tapHint: {
    fontFamily: "Inter_300Light", fontSize: 10, letterSpacing: 2.5,
    color: "rgba(20,16,8,0.24)", textAlign: "center",
  },

  // Lower
  lowerArea: {
    flex: 1, alignItems: "center", justifyContent: "flex-start",
    paddingTop: 30, gap: 10,
  },
  interruptDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: "rgba(20,16,8,0.30)",
  },
  errorText: {
    textAlign: "center", fontFamily: "Inter_300Light",
    fontSize: 11, color: "rgba(96,10,10,0.55)",
    paddingHorizontal: 40,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 32, paddingTop: 8,
  },
  hamburger: { padding: 4 },
  orderBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(20,16,8,0.08)",
    borderWidth: 0.5, borderColor: "rgba(20,16,8,0.22)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  orderBadgeNum: {
    fontFamily: "Inter_500Medium", fontSize: 11, color: "rgba(20,16,8,0.58)",
  },

  // Panel
  backdrop: { flex: 1 },
  panel: {
    backgroundColor: "#FAFAF6",
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    borderTopWidth: 0.5, borderColor: "rgba(20,16,8,0.09)",
    maxHeight: "78%",
    shadowColor: "#000", shadowOpacity: 0.10, shadowRadius: 24,
    shadowOffset: { width: 0, height: -5 }, elevation: 10,
  },
  panelHandle: {
    width: 36, height: 3, borderRadius: 2,
    backgroundColor: "rgba(20,16,8,0.14)",
    alignSelf: "center", marginTop: 14, marginBottom: 4,
  },
  panelNav: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 22, paddingVertical: 12, gap: 22,
  },
  panelNavBtn: { paddingVertical: 4 },
  panelNavTxt: {
    fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 1,
    color: "rgba(20,16,8,0.30)", textTransform: "lowercase",
  },
  panelNavOn: { color: "rgba(20,16,8,0.82)", fontFamily: "Inter_400Regular" },
  panelDivider: { height: 0.5, backgroundColor: "rgba(20,16,8,0.09)", marginTop: 6 },
  panelLink: {
    fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 0.5,
    color: "rgba(20,60,140,0.72)", textDecorationLine: "underline",
  },

  // Receipt
  receiptTotal: {
    fontFamily: "Inter_300Light", fontSize: 44,
    color: "rgba(20,16,8,0.80)", letterSpacing: -1.5,
  },
  receiptLabel: {
    fontFamily: "Inter_300Light", fontSize: 9, letterSpacing: 4,
    color: "rgba(20,16,8,0.32)", marginBottom: 10,
  },
  receiptRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  receiptQty:  { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(20,16,8,0.34)", width: 28 },
  receiptName: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(20,16,8,0.70)" },
  receiptPrice:{ fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(20,16,8,0.46)" },

  // Empty
  emptyPanel: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60, gap: 8 },
  emptyTxt:   { fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 0.5, color: "rgba(20,16,8,0.30)" },
  emptyHint:  { fontFamily: "Inter_300Light", fontSize: 11, color: "rgba(20,16,8,0.18)" },

  // Order footer
  orderFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#FAFAF6",
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20,
    borderTopWidth: 0.5, borderTopColor: "rgba(20,16,8,0.07)",
  },
  orderTotal: {
    fontFamily: "Inter_300Light", fontSize: 36,
    color: "rgba(20,16,8,0.74)", letterSpacing: -0.5, marginBottom: 14,
  },
  orderActions: { flexDirection: "row", gap: 12 },
  clearBtn: {
    width: 50, height: 50, borderRadius: 25,
    borderWidth: 0.5, borderColor: "rgba(160,40,40,0.24)",
    alignItems: "center", justifyContent: "center",
  },
  submitBtn: {
    flex: 1, height: 50, borderRadius: 25,
    backgroundColor: "rgba(20,16,8,0.05)",
    borderWidth: 0.5, borderColor: "rgba(20,16,8,0.20)",
    alignItems: "center", justifyContent: "center",
  },
  submitTxt: {
    fontFamily: "Inter_400Regular", fontSize: 14,
    letterSpacing: 1, color: "rgba(20,16,8,0.68)", textTransform: "lowercase",
  },

  // Catalog
  catalogRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 15, paddingHorizontal: 22,
    borderBottomWidth: 0.5, borderBottomColor: "rgba(20,16,8,0.06)",
  },
  catalogName:  { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(20,16,8,0.70)" },
  catalogCat:   { fontFamily: "Inter_300Light", fontSize: 11, color: "rgba(20,16,8,0.32)" },
  catalogPrice: { fontFamily: "Inter_300Light", fontSize: 13, color: "rgba(20,16,8,0.40)" },

  // Settings
  settingsPanel: { padding: 16 },
  settingsRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 16, paddingHorizontal: 8,
    borderBottomWidth: 0.5, borderBottomColor: "rgba(20,16,8,0.07)",
  },
  settingsRowTxt: {
    flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(20,16,8,0.68)",
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
});
