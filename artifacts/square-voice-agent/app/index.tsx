import React, {
  useEffect, useMemo, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ActivityIndicator, Linking,
} from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop, G, ClipPath } from "react-native-svg";
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

// ── Animated SVG circle ───────────────────────────────────────────────────────
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const WEB_TOP = 67;
const WEB_BOT = 34;

// ── Types ─────────────────────────────────────────────────────────────────────
type OrbKey = AgentState | "wake";

// ── Particle system ───────────────────────────────────────────────────────────
// Viewbox is -110 -110 220 220 → radius = 100 usable units
const SVG_R = 100;
const N = 48;

interface P {
  bx: number; by: number;     // base position (home)
  r: number;                  // dot radius
  ax: number; ay: number;     // drift amplitude
  fx: number; fy: number;     // drift frequency
  fo: number;                 // opacity flicker frequency
  px: number; py: number;     // position phases (for desync)
  po: number;                 // opacity phase
  bo: number;                 // base opacity ceiling
}

function mkParticles(): P[] {
  return Array.from({ length: N }, () => {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * SVG_R * 0.86; // uniform disk distribution
    return {
      bx: Math.cos(a) * d,
      by: Math.sin(a) * d,
      r:  0.6 + Math.random() * 2.4,
      ax: 4   + Math.random() * 16,
      ay: 4   + Math.random() * 16,
      // frequencies: tiny so motion is slow and organic
      fx: 0.00016 + Math.random() * 0.00054,
      fy: 0.00014 + Math.random() * 0.00048,
      fo: 0.00012 + Math.random() * 0.00040,
      px: Math.random() * Math.PI * 2,
      py: Math.random() * Math.PI * 2,
      po: Math.random() * Math.PI * 2,
      bo: 0.22 + Math.random() * 0.72,
    };
  });
}

// Each particle is its own component, driven by a single shared time value
function Dot({ p, time, fill }: { p: P; time: SharedValue<number>; fill: string }) {
  const ap = useAnimatedProps(() => {
    const t = time.value;
    return {
      cx: p.bx + Math.sin(t * p.fx + p.px) * p.ax,
      cy: p.by + Math.sin(t * p.fy + p.py) * p.ay,
      // opacity: smooth sinusoidal flicker, always positive
      opacity: p.bo * (0.12 + 0.88 * ((1 + Math.sin(t * p.fo + p.po)) * 0.5)),
    };
  });
  return <AnimatedCircle animatedProps={ap} r={p.r} fill={fill} />;
}

// ── Orb palette (per state) ───────────────────────────────────────────────────
interface Pal {
  dot: string;       // particle fill color
  gc: string; gco: number;   // gradient center
  gm: string; gmo: number;   // gradient mid
  ring: string;      // boundary ring stroke
  bloom: string;     // soft bloom behind orb
}

const PAL: Record<OrbKey, Pal> = {
  disconnected: {
    dot: "#a5b4fc",
    gc: "#4338ca", gco: 0.40,  gm: "#1e1b4b", gmo: 0.10,
    ring: "rgba(165,180,252,0.14)", bloom: "rgba(99,102,241,0.06)",
  },
  connecting: {
    dot: "#fcd34d",
    gc: "#b45309", gco: 0.48,  gm: "#451a03", gmo: 0.14,
    ring: "rgba(252,211,77,0.22)",  bloom: "rgba(217,119,6,0.09)",
  },
  listening: {
    dot: "#7dd3fc",
    gc: "#0284c7", gco: 0.52,  gm: "#0c4a6e", gmo: 0.18,
    ring: "rgba(125,211,252,0.32)", bloom: "rgba(14,165,233,0.13)",
  },
  thinking: {
    dot: "#fde68a",
    gc: "#78716c", gco: 0.32,  gm: "#292524", gmo: 0.08,
    ring: "rgba(253,230,138,0.16)", bloom: "rgba(120,113,108,0.06)",
  },
  speaking: {
    dot: "#6ee7b7",
    gc: "#059669", gco: 0.50,  gm: "#022c22", gmo: 0.16,
    ring: "rgba(110,231,183,0.28)", bloom: "rgba(5,150,105,0.12)",
  },
  error: {
    dot: "#fca5a5",
    gc: "#b91c1c", gco: 0.48,  gm: "#450a0a", gmo: 0.14,
    ring: "rgba(252,165,165,0.22)", bloom: "rgba(185,28,28,0.08)",
  },
  wake: {
    dot: "#d8b4fe",
    gc: "#7c3aed", gco: 0.50,  gm: "#2e1065", gmo: 0.16,
    ring: "rgba(216,180,254,0.28)", bloom: "rgba(124,58,237,0.11)",
  },
};

// ── Nebula orb ────────────────────────────────────────────────────────────────
function NebulaOrb({ orbKey }: { orbKey: OrbKey }) {
  const pal = PAL[orbKey] ?? PAL.disconnected;
  const particles = useMemo(mkParticles, []);

  // Single monotonic timer — all particles derive position from this
  const time = useSharedValue(0);
  useEffect(() => {
    // Tick indefinitely at 1 unit/ms (effectively forever)
    time.value = withTiming(9_000_000, {
      duration: 9_000_000_000,
      easing: Easing.linear,
    });
  }, []);

  // Scale + bloom driven by agent state
  const sc   = useSharedValue(1);
  const blSc = useSharedValue(1);

  useEffect(() => {
    if (orbKey === "listening") {
      sc.value = withRepeat(withSequence(
        withTiming(1.05, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.00, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      ), -1);
      blSc.value = withRepeat(withSequence(
        withTiming(1.6, { duration: 2400 }), withTiming(1.1, { duration: 2400 }),
      ), -1);
    } else if (orbKey === "speaking") {
      sc.value = withRepeat(withSequence(
        withTiming(1.12, { duration: 460, easing: Easing.out(Easing.quad) }),
        withTiming(1.03, { duration: 460, easing: Easing.in(Easing.quad) }),
      ), -1);
      blSc.value = withRepeat(withSequence(
        withTiming(2.0, { duration: 460 }), withTiming(1.4, { duration: 460 }),
      ), -1);
    } else if (orbKey === "wake") {
      sc.value = withRepeat(withSequence(
        withTiming(1.06, { duration: 2900, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.00, { duration: 2900, easing: Easing.inOut(Easing.sin) }),
      ), -1);
      blSc.value = withRepeat(withSequence(
        withTiming(1.7, { duration: 2900 }), withTiming(1.1, { duration: 2900 }),
      ), -1);
    } else if (orbKey === "thinking") {
      sc.value = withRepeat(withSequence(
        withTiming(0.97, { duration: 1100 }), withTiming(0.99, { duration: 1100 }),
      ), -1);
      blSc.value = withTiming(0.75, { duration: 700 });
    } else {
      sc.value  = withTiming(1, { duration: 800 });
      blSc.value = withTiming(1, { duration: 800 });
    }
  }, [orbKey]);

  const orbSt  = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  const blSt   = useAnimatedStyle(() => ({
    transform: [{ scale: blSc.value }],
    opacity: Math.min(1, (blSc.value - 0.7) * 0.55),
  }));

  return (
    <View style={ns.wrap}>
      {/* Diffuse bloom that breathes with the orb */}
      <Animated.View style={[ns.bloom, blSt, { backgroundColor: pal.bloom }]} />

      {/* Orb body */}
      <Animated.View style={orbSt}>
        <Svg width={220} height={220} viewBox="-110 -110 220 220">
          <Defs>
            <RadialGradient id="g" cx="50%" cy="50%" r="50%">
              <Stop offset="0%"   stopColor={pal.gc} stopOpacity={pal.gco} />
              <Stop offset="55%"  stopColor={pal.gm} stopOpacity={pal.gmo} />
              <Stop offset="100%" stopColor="#000000" stopOpacity={0} />
            </RadialGradient>
            <ClipPath id="c">
              <Circle cx={0} cy={0} r={SVG_R} />
            </ClipPath>
          </Defs>

          {/* Radial glow base */}
          <Circle cx={0} cy={0} r={SVG_R} fill="url(#g)" />

          {/* Particles — clipped to sphere boundary */}
          <G clipPath="url(#c)">
            {particles.map((p, i) => (
              <Dot key={i} p={p} time={time} fill={pal.dot} />
            ))}
          </G>

          {/* Thin outer ring */}
          <Circle cx={0} cy={0} r={SVG_R} fill="none" stroke={pal.ring} strokeWidth={0.6} />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <View style={ns.logoWrap}>
      {/* Geometric mark: thin ring + accent bead */}
      <View style={ns.logoMark}>
        <View style={ns.logoRing} />
        <View style={ns.logoBead} />
      </View>
      <Text style={ns.logoWord}>BEVPRO</Text>
    </View>
  );
}

// ── Floating conversation line ────────────────────────────────────────────────
function GhostLine({ msg, rank }: { msg: ConversationMessage; rank: number }) {
  const isUser = msg.role === "user";
  const opacity = rank === 0 ? (isUser ? 0.40 : 0.84) : rank === 1 ? 0.22 : 0.10;
  const size    = rank === 0 ? (isUser ? 14 : 16) : 13;
  return (
    <Animated.Text
      entering={FadeIn.duration(500)}
      exiting={FadeOut.duration(400)}
      style={{
        textAlign: "center",
        fontSize: size,
        lineHeight: 24,
        letterSpacing: isUser ? 0.1 : 0.2,
        fontFamily: isUser ? "Inter_300Light" : "Inter_400Regular",
        color: `rgba(255,255,255,${opacity})`,
      }}
    >
      {msg.content}
    </Animated.Text>
  );
}

// ── State labels ──────────────────────────────────────────────────────────────
const LABEL: Partial<Record<OrbKey, { t: string; c: string }>> = {
  connecting: { t: "CONNECTING", c: "rgba(252,211,77,0.45)" },
  thinking:   { t: "\u00B7  \u00B7  \u00B7", c: "rgba(253,230,138,0.40)" },
  error:      { t: "ERROR",      c: "rgba(252,165,165,0.52)" },
  wake:       { t: "HEY BAR",   c: "rgba(216,180,254,0.52)" },
};

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MainScreen() {
  const insets    = useSafeAreaInsets();
  const topPad    = Platform.OS === "web" ? WEB_TOP : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOT : insets.bottom;

  // ── Contexts ───────────────────────────────────────────────────────────────
  const {
    agentState, isConnected, conversation, partialTranscript, error,
    connect, disconnect, clearConversation, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId } = useSquare();

  // ── Panel ──────────────────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab,  setPanelTab]  = useState<"order" | "catalog">("order");

  // ── Wake word ──────────────────────────────────────────────────────────────
  type WakeMode = "idle" | "wake" | "command";
  const [wakeMode, setWakeMode]   = useState<WakeMode>("idle");
  const wakeModeRef               = useRef<WakeMode>("idle");
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

  // ── Sync contexts ──────────────────────────────────────────────────────────
  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({ id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category })));
  }, [catalogItems, setCatalog]);

  useEffect(() => {
    if (accessToken && locationId) setSquareCredentials(accessToken, locationId);
  }, [accessToken, locationId, setSquareCredentials]);

  useEffect(() => {
    setCurrentOrder((currentOrder?.items ?? []).map((i) => ({ name: i.catalogItem.name, price: i.catalogItem.price, quantity: i.quantity })));
  }, [currentOrder, setCurrentOrder]);

  // ── Order commands ─────────────────────────────────────────────────────────
  const handleCmds = useCallback((commands: OrderCommand[]) => {
    for (const cmd of commands) {
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
            Haptics.notificationAsync(r.success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
            if (r.success) { setPanelTab("order"); setPanelOpen(true); }
          });
          break;
        }
      }
    }
  }, [catalogItems, currentOrder, addItem, removeItem, clearOrder, submitOrder, accessToken, locationId]);

  useEffect(() => { setToolHandler(handleCmds); }, [handleCmds, setToolHandler]);

  // ── Orb tap ────────────────────────────────────────────────────────────────
  async function handleOrbPress() {
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

  const msgs = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;
  const stateLabel = wakeMode === "wake"
    ? { t: wakeListening ? "HEY BAR" : "OPENING MIC\u2026", c: "rgba(216,180,254,0.50)" }
    : LABEL[orbKey] ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* Subtle depth gradient on page background */}
      <LinearGradient
        colors={["#060818", "#0a0d24", "#060818"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* ── Logo ── */}
      <View style={[s.topRow, { paddingTop: topPad + 22 }]}>
        <Logo />
      </View>

      {/* ── Floating conversation — pinterEvents none so taps pass through ── */}
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

      {/* ── Particle orb ── */}
      <Pressable onPress={handleOrbPress} style={s.orbArea} hitSlop={32}>
        <NebulaOrb orbKey={orbKey} />
      </Pressable>

      {/* ── State label ── */}
      {stateLabel ? (
        <Animated.Text
          key={stateLabel.t}
          entering={FadeIn.duration(600)}
          exiting={FadeOut.duration(400)}
          style={[s.stateLabel, { color: stateLabel.c }]}
        >
          {stateLabel.t}
        </Animated.Text>
      ) : <View style={{ height: 34 }} />}

      {/* ── Error whisper ── */}
      {error ? (
        <Animated.Text entering={FadeIn.duration(300)} style={s.errorWhisper}>
          {error}
        </Animated.Text>
      ) : null}

      {/* ── Bottom corners ── */}
      <View style={[s.bottomRow, { paddingBottom: bottomPad + 22 }]}>

        {/* Order indicator */}
        <Pressable onPress={() => { setPanelTab("order"); setPanelOpen(true); }} hitSlop={22}>
          {orderCount > 0 ? (
            <View style={s.orderBadge}>
              <Text style={s.orderBadgeNum}>{orderCount}</Text>
            </View>
          ) : (
            <View style={s.dot} />
          )}
        </Pressable>

        {/* Interrupt — center, only while speaking */}
        {agentState === "speaking" ? (
          <Pressable onPress={interrupt} hitSlop={28} style={s.interruptWrap}>
            <View style={s.interruptDot} />
          </Pressable>
        ) : <View style={{ flex: 1 }} />}

        {/* Settings indicator */}
        <Pressable onPress={() => router.push("/setup")} hitSlop={22}>
          <View style={[s.dot, isConfigured && s.dotActive]} />
        </Pressable>
      </View>

      {/* ── Slide-up panel ── */}
      <Modal
        visible={panelOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPanelOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setPanelOpen(false)} />

        <View style={[s.panel, { paddingBottom: bottomPad + 20 }]}>
          <View style={s.panelHandle} />

          {/* Panel tabs */}
          <View style={s.panelHeader}>
            {(["order", "catalog"] as const).map((tab) => (
              <Pressable key={tab} onPress={() => setPanelTab(tab)} style={s.panelTabBtn}>
                <Text style={[s.panelTabTxt, panelTab === tab && s.panelTabOn]}>
                  {tab}
                </Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPanelOpen(false)} style={{ marginLeft: "auto" }}>
              <Feather name="x" size={16} color="rgba(255,255,255,0.25)" />
            </Pressable>
          </View>

          {/* ── Order tab ── */}
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
                    <View style={{ marginBottom: 16, gap: 4 }}>
                      <Text style={s.bigTotal}>${lastSubmittedOrder.total.toFixed(2)}</Text>
                      <Text style={s.bigTotalSub}>SUBMITTED</Text>
                      <View style={s.divider} />
                    </View>
                  }
                  renderItem={({ item }) => (
                    <View style={s.sRow}>
                      <Text style={s.sQty}>{item.quantity}×</Text>
                      <Text style={s.sName}>{item.catalogItem.name}</Text>
                      <Text style={s.sPrice}>${(item.catalogItem.price * item.quantity).toFixed(2)}</Text>
                    </View>
                  )}
                  ListFooterComponent={
                    <Pressable onPress={() => Linking.openURL("https://squareup.com/dashboard/orders")} style={{ marginTop: 12 }}>
                      <Text style={s.link}>view in Square ↗</Text>
                    </Pressable>
                  }
                  showsVerticalScrollIndicator={false}
                />
              );
            }

            return items.length === 0 ? (
              <View style={s.emptyPanel}>
                <Text style={s.emptyTxt}>no items yet</Text>
                <Text style={s.emptyHint}>speak to the orb to add items</Text>
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
                  <Text style={s.totalAmt}>${total.toFixed(2)}</Text>
                  <View style={s.orderActions}>
                    <Pressable onPress={clearOrder} style={s.clearBtn}>
                      <Feather name="trash-2" size={15} color="rgba(248,113,113,0.7)" />
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
                        ? <ActivityIndicator size="small" color={Colors.dark.accent} />
                        : <Text style={s.submitTxt}>process</Text>}
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })()}

          {/* ── Catalog tab ── */}
          {panelTab === "catalog" && (
            isLoadingCatalog ? (
              <View style={s.emptyPanel}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.2)" />
              </View>
            ) : !isConfigured ? (
              <View style={s.emptyPanel}>
                <Text style={s.emptyTxt}>square not connected</Text>
                <Pressable onPress={() => { setPanelOpen(false); router.push("/setup"); }}>
                  <Text style={s.link}>connect →</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={catalogItems}
                keyExtractor={(it) => it.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={s.catalogRow}
                    onPress={() => {
                      addItem(item, 1);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPanelTab("order");
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.catalogName}>{item.name}</Text>
                      {item.category ? <Text style={s.catalogCat}>{item.category}</Text> : null}
                    </View>
                    <Text style={s.catalogPrice}>${item.price.toFixed(2)}</Text>
                  </Pressable>
                )}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
              />
            )
          )}
        </View>
      </Modal>
    </View>
  );
}

// ── Nebula orb component styles ───────────────────────────────────────────────
const ns = StyleSheet.create({
  wrap: {
    width: 220, height: 220,
    alignItems: "center", justifyContent: "center",
  },
  bloom: {
    position: "absolute",
    width: 360, height: 360, borderRadius: 180,
  },
  // Logo
  logoWrap: { alignItems: "center", gap: 7 },
  logoMark: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  logoRing: {
    position: "absolute",
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 0.5, borderColor: "rgba(165,180,252,0.30)",
  },
  logoBead: {
    position: "absolute", top: 5, right: 5,
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: "rgba(165,180,252,0.50)",
  },
  logoWord: {
    fontFamily: "Inter_300Light",
    fontSize: 8, letterSpacing: 5,
    color: "rgba(255,255,255,0.26)",
  },
});

// ── Main screen styles ────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060818" },

  topRow: { alignItems: "center", paddingBottom: 8 },

  convoArea: {
    flex: 1,
    alignItems: "center", justifyContent: "flex-end",
    paddingHorizontal: 36, paddingBottom: 32, gap: 10,
  },
  partial: {
    textAlign: "center", fontSize: 13, fontStyle: "italic",
    fontFamily: "Inter_300Light", color: "rgba(255,255,255,0.26)",
  },

  orbArea: { alignItems: "center" },

  stateLabel: {
    textAlign: "center",
    fontFamily: "Inter_300Light",
    fontSize: 9, letterSpacing: 3.5,
    marginTop: 18,
  },
  errorWhisper: {
    textAlign: "center",
    fontFamily: "Inter_300Light", fontSize: 11,
    color: "rgba(252,165,165,0.48)",
    paddingHorizontal: 40, marginTop: 8,
  },

  bottomRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 36, paddingTop: 10,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  dotActive: {
    backgroundColor: "rgba(124,110,245,0.45)",
    borderWidth: 0.5, borderColor: "rgba(124,110,245,0.6)",
  },
  orderBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(124,110,245,0.16)",
    borderWidth: 0.5, borderColor: "rgba(124,110,245,0.40)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
  },
  orderBadgeNum: {
    fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.dark.accent,
  },
  interruptWrap: { flex: 1, alignItems: "center" },
  interruptDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: "rgba(255,255,255,0.32)",
  },

  // Panel
  backdrop: { flex: 1 },
  panel: {
    backgroundColor: "#0b0d20",
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    borderTopWidth: 0.5, borderColor: "rgba(255,255,255,0.07)",
    maxHeight: "78%",
    shadowColor: "#000", shadowOpacity: 0.7, shadowRadius: 40,
    shadowOffset: { width: 0, height: -10 },
    elevation: 20,
  },
  panelHandle: {
    width: 36, height: 3, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignSelf: "center", marginTop: 14, marginBottom: 4,
  },
  panelHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 22, paddingVertical: 12, gap: 22,
  },
  panelTabBtn: { paddingVertical: 4 },
  panelTabTxt: {
    fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 1,
    color: "rgba(255,255,255,0.22)", textTransform: "lowercase",
  },
  panelTabOn: { color: "rgba(255,255,255,0.82)", fontFamily: "Inter_400Regular" },

  // Submitted receipt
  bigTotal: {
    fontFamily: "Inter_300Light", fontSize: 46,
    color: Colors.dark.accent, letterSpacing: -2,
  },
  bigTotalSub: {
    fontFamily: "Inter_300Light", fontSize: 9, letterSpacing: 4,
    color: "rgba(255,255,255,0.24)", marginBottom: 16,
  },
  divider: { height: 0.5, backgroundColor: "rgba(255,255,255,0.06)", marginBottom: 8 },
  sRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  sQty:  { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.28)", width: 28 },
  sName: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.62)" },
  sPrice: { fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(255,255,255,0.40)" },
  link: {
    fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 0.5,
    color: Colors.dark.accent, textDecorationLine: "underline",
  },

  // Empty
  emptyPanel: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingBottom: 60, gap: 8,
  },
  emptyTxt: {
    fontFamily: "Inter_300Light", fontSize: 13, letterSpacing: 0.5,
    color: "rgba(255,255,255,0.18)",
  },
  emptyHint: {
    fontFamily: "Inter_300Light", fontSize: 11,
    color: "rgba(255,255,255,0.10)", letterSpacing: 0.3,
  },

  // Order footer
  orderFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#0b0d20",
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20,
    borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.05)",
  },
  totalAmt: {
    fontFamily: "Inter_300Light", fontSize: 36,
    color: "rgba(255,255,255,0.70)", letterSpacing: -0.5, marginBottom: 14,
  },
  orderActions: { flexDirection: "row", gap: 12 },
  clearBtn: {
    width: 50, height: 50, borderRadius: 25,
    borderWidth: 0.5, borderColor: "rgba(248,113,113,0.28)",
    alignItems: "center", justifyContent: "center",
  },
  submitBtn: {
    flex: 1, height: 50, borderRadius: 25,
    backgroundColor: "rgba(124,110,245,0.15)",
    borderWidth: 0.5, borderColor: "rgba(124,110,245,0.40)",
    alignItems: "center", justifyContent: "center",
  },
  submitTxt: {
    fontFamily: "Inter_400Regular", fontSize: 14, letterSpacing: 1,
    color: Colors.dark.accent, textTransform: "lowercase",
  },

  // Catalog
  catalogRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 15, paddingHorizontal: 22,
    borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  catalogName: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.58)" },
  catalogCat:  { fontFamily: "Inter_300Light", fontSize: 11, color: "rgba(255,255,255,0.22)" },
  catalogPrice: { fontFamily: "Inter_300Light", fontSize: 13, color: "rgba(255,255,255,0.26)" },
});
