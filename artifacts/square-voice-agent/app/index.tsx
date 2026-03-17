import React, {
  useEffect, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ScrollView, ActivityIndicator, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle, useSharedValue,
  withRepeat, withSequence, withTiming, withSpring,
  FadeIn, FadeOut, Easing,
} from "react-native-reanimated";

import Colors from "@/constants/colors";
import { useWakeWord, TERMINATE_PHRASES, isWakeWordSupported } from "@/hooks/useWakeWord";
import { useVoiceAgent, ConversationMessage, AgentState, OrderCommand } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP_INSET = 67;
const WEB_BOTTOM_INSET = 34;

// ── Palette ───────────────────────────────────────────────────────────────────

const ORB: Record<string, { core: string; ring: string; glow: string }> = {
  disconnected: { core: "#1a1a2e", ring: "rgba(255,255,255,0.06)", glow: "transparent" },
  connecting:   { core: "#1e1a10", ring: "rgba(251,191,36,0.18)",  glow: "rgba(251,191,36,0.04)" },
  listening:    { core: "#0f1524", ring: "rgba(255,255,255,0.22)",  glow: "rgba(255,255,255,0.04)" },
  thinking:     { core: "#12100e", ring: "rgba(251,191,36,0.15)",  glow: "rgba(251,191,36,0.03)" },
  speaking:     { core: "#0c0a1a", ring: "rgba(124,110,245,0.35)", glow: "rgba(124,110,245,0.07)" },
  error:        { core: "#1a0a0a", ring: "rgba(255,92,122,0.28)",  glow: "rgba(255,92,122,0.05)" },
  wake:         { core: "#10091a", ring: "rgba(168,85,247,0.28)",  glow: "rgba(168,85,247,0.06)" },
};

// ── Zen Orb ───────────────────────────────────────────────────────────────────

type OrbKey = AgentState | "wake";

function ZenOrb({ orbKey }: { orbKey: OrbKey }) {
  const p = ORB[orbKey] ?? ORB.disconnected;

  const outerScale   = useSharedValue(1);
  const outerOpacity = useSharedValue(0.5);
  const midScale     = useSharedValue(1);
  const midOpacity   = useSharedValue(0.5);
  const coreOpacity  = useSharedValue(0.6);

  useEffect(() => {
    const base = { duration: 2200, easing: Easing.inOut(Easing.sin) };

    if (orbKey === "listening") {
      outerScale.value   = withRepeat(withSequence(withTiming(1.12, base), withTiming(1, base)), -1, false);
      outerOpacity.value = withRepeat(withSequence(withTiming(0.9, base), withTiming(0.35, base)), -1, false);
      midScale.value     = withRepeat(withSequence(withTiming(1.08, { duration: 1800, easing: base.easing }), withTiming(1, { duration: 1800, easing: base.easing })), -1, false);
      midOpacity.value   = withRepeat(withSequence(withTiming(0.75, base), withTiming(0.3, base)), -1, false);
      coreOpacity.value  = withRepeat(withSequence(withTiming(0.9, base), withTiming(0.55, base)), -1, false);

    } else if (orbKey === "wake") {
      const slow = { duration: 3000, easing: Easing.inOut(Easing.sin) };
      outerScale.value   = withRepeat(withSequence(withTiming(1.1, slow), withTiming(1, slow)), -1, false);
      outerOpacity.value = withRepeat(withSequence(withTiming(0.7, slow), withTiming(0.2, slow)), -1, false);
      midScale.value     = withRepeat(withSequence(withTiming(1.06, slow), withTiming(1, slow)), -1, false);
      midOpacity.value   = withRepeat(withSequence(withTiming(0.55, slow), withTiming(0.18, slow)), -1, false);
      coreOpacity.value  = withRepeat(withSequence(withTiming(0.7, slow), withTiming(0.3, slow)), -1, false);

    } else if (orbKey === "speaking") {
      const fast = { duration: 620, easing: Easing.out(Easing.quad) };
      outerScale.value   = withRepeat(withSequence(withTiming(1.22, fast), withTiming(1, fast)), -1, false);
      outerOpacity.value = withRepeat(withSequence(withTiming(0.9, fast), withTiming(0.1, fast)), -1, false);
      midScale.value     = withRepeat(withSequence(withTiming(1.14, { ...fast, duration: 480 }), withTiming(1, { ...fast, duration: 480 })), -1, false);
      midOpacity.value   = withRepeat(withSequence(withTiming(0.8, fast), withTiming(0.25, fast)), -1, false);
      coreOpacity.value  = withTiming(0.95, { duration: 300 });

    } else if (orbKey === "thinking") {
      const subtle = { duration: 900, easing: Easing.inOut(Easing.quad) };
      outerScale.value   = withRepeat(withSequence(withTiming(1.04, subtle), withTiming(1, subtle)), -1, true);
      outerOpacity.value = withTiming(0.3, { duration: 400 });
      midScale.value     = withTiming(1, { duration: 300 });
      midOpacity.value   = withTiming(0.25, { duration: 400 });
      coreOpacity.value  = withRepeat(withSequence(withTiming(0.65, subtle), withTiming(0.35, subtle)), -1, true);

    } else if (orbKey === "connecting") {
      const pulse = { duration: 1400, easing: Easing.inOut(Easing.sin) };
      outerScale.value   = withRepeat(withSequence(withTiming(1.08, pulse), withTiming(1, pulse)), -1, false);
      outerOpacity.value = withRepeat(withSequence(withTiming(0.6, pulse), withTiming(0.1, pulse)), -1, false);
      midScale.value     = withTiming(1, { duration: 300 });
      midOpacity.value   = withTiming(0.2, { duration: 400 });
      coreOpacity.value  = withTiming(0.45, { duration: 400 });

    } else {
      // disconnected / error / idle
      outerScale.value   = withTiming(1, { duration: 600 });
      outerOpacity.value = withTiming(orbKey === "error" ? 0.4 : 0.12, { duration: 600 });
      midScale.value     = withTiming(1, { duration: 600 });
      midOpacity.value   = withTiming(orbKey === "error" ? 0.3 : 0.08, { duration: 600 });
      coreOpacity.value  = withTiming(orbKey === "error" ? 0.5 : 0.18, { duration: 600 });
    }
  }, [orbKey]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: outerScale.value }],
    opacity: outerOpacity.value,
  }));
  const midStyle = useAnimatedStyle(() => ({
    transform: [{ scale: midScale.value }],
    opacity: midOpacity.value,
  }));
  const coreStyle = useAnimatedStyle(() => ({ opacity: coreOpacity.value }));

  return (
    <View style={s.orbWrap}>
      {/* Outer glow */}
      <Animated.View style={[s.orbOuter, outerStyle, { borderColor: p.ring, backgroundColor: p.glow }]} />
      {/* Mid ring */}
      <Animated.View style={[s.orbMid,   midStyle,   { borderColor: p.ring }]} />
      {/* Core */}
      <Animated.View style={[s.orbCore,  coreStyle,  { backgroundColor: p.core, borderColor: p.ring }]} />
    </View>
  );
}

// ── Minimal Logo ──────────────────────────────────────────────────────────────

function Logo() {
  return (
    <View style={s.logoWrap}>
      <View style={s.logoMark}>
        <View style={s.logoCircle} />
        <View style={s.logoDot} />
      </View>
      <Text style={s.logoText}>bevpro</Text>
    </View>
  );
}

// ── Floating conversation ─────────────────────────────────────────────────────

function ConvoLine({ msg, idx, total }: { msg: ConversationMessage; idx: number; total: number }) {
  const isUser  = msg.role === "user";
  const recency = total - idx; // 1 = most recent
  const opacity = recency === 1 ? (isUser ? 0.45 : 0.88) : recency === 2 ? 0.28 : 0.14;
  const size    = recency === 1 ? (isUser ? 14 : 15) : 13;
  return (
    <Animated.Text
      entering={FadeIn.duration(400)}
      exiting={FadeOut.duration(600)}
      style={[s.convoLine, { opacity, fontSize: size, fontFamily: isUser ? "Inter_300Light" : "Inter_400Regular" }]}
    >
      {msg.content}
    </Animated.Text>
  );
}

// ── State label ───────────────────────────────────────────────────────────────

const STATE_LABEL: Partial<Record<OrbKey, string>> = {
  connecting: "connecting",
  thinking:   "\u00B7\u00B7\u00B7",
  error:      "error",
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function MainScreen() {
  const insets    = useSafeAreaInsets();
  const topPad    = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;

  // ── Voice agent ────────────────────────────────────────────────────────────
  const {
    agentState, isConnected, conversation, partialTranscript, error,
    connect, disconnect, clearConversation, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials,
  } = useVoiceAgent();

  // ── Order context ──────────────────────────────────────────────────────────
  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting,
  } = useOrder();

  // ── Square ─────────────────────────────────────────────────────────────────
  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId } = useSquare();

  // ── Panel ──────────────────────────────────────────────────────────────────
  const [panelOpen,  setPanelOpen]  = useState(false);
  const [panelTab,   setPanelTab]   = useState<"order" | "catalog">("order");

  // ── Wake word ──────────────────────────────────────────────────────────────
  type WakeMode = "idle" | "wake" | "command";
  const [wakeMode, setWakeMode]   = useState<WakeMode>("idle");
  const wakeModeRef = useRef<WakeMode>("idle");
  wakeModeRef.current = wakeMode;

  const handleWakeWordDetected = useCallback(async () => {
    setWakeMode("command");
    await connect();
  }, [connect]);

  const handleWakeStopDetected = useCallback(async () => {
    await disconnect();
    setWakeMode("idle");
  }, [disconnect]);

  const { isListening: wakeIsListening, startWakeWord, stopWakeWord } = useWakeWord({
    onWakeWordDetected: handleWakeWordDetected,
    onStopDetected: handleWakeStopDetected,
  });

  const enterWakeMode = useCallback(() => {
    setWakeMode("wake");
    startWakeWord();
  }, [startWakeWord]);

  const exitToIdle = useCallback(async () => {
    stopWakeWord();
    await disconnect();
    setWakeMode("idle");
  }, [stopWakeWord, disconnect]);

  // Auto-return to wake mode when session ends
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (wakeModeRef.current !== "command") return;
    if (isConnected) return;
    const t = setTimeout(() => {
      if (wakeModeRef.current !== "command") return;
      setWakeMode("wake");
      startWakeWord();
    }, 350);
    return () => clearTimeout(t);
  }, [isConnected, startWakeWord]);

  // Terminate-phrase shortcut
  useEffect(() => {
    if (Platform.OS !== "web" || wakeMode !== "command") return;
    const last = [...conversation].reverse().find((m) => m.role === "user");
    if (!last) return;
    const text = last.content.toLowerCase();
    if (TERMINATE_PHRASES.some((p) => text.includes(p))) {
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
    setCurrentOrder((currentOrder?.items ?? []).map((i) => ({
      name: i.catalogItem.name, price: i.catalogItem.price, quantity: i.quantity,
    })));
  }, [currentOrder, setCurrentOrder]);

  // ── Order commands ─────────────────────────────────────────────────────────
  const handleCommands = useCallback((commands: OrderCommand[]) => {
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

  useEffect(() => { setToolHandler(handleCommands); }, [handleCommands, setToolHandler]);

  // ── Toggle ─────────────────────────────────────────────────────────────────
  async function handleOrbPress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") {
      if (wakeMode === "wake")    { exitToIdle(); return; }
      if (wakeMode === "command") { disconnect(); return; }
      if (isWakeWordSupported())  { enterWakeMode(); return; }
    }
    if (isConnected || agentState === "connecting") { disconnect(); }
    else { await connect(); }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const orbKey: OrbKey = wakeMode === "wake" ? "wake"
    : wakeMode === "command" ? agentState
    : agentState;

  const lastMsgs = conversation.slice(-3);
  const orderCount = currentOrder?.items.length ?? 0;

  // State label
  const wakeLabel = wakeMode === "wake"
    ? (wakeIsListening ? `"hey bar"` : "opening mic\u2026")
    : null;
  const stateLabel = wakeLabel ?? STATE_LABEL[orbKey] ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { backgroundColor: Colors.dark.background }]}>

      {/* ── Logo top-center ── */}
      <View style={[s.logoRow, { paddingTop: topPad + 20 }]}>
        <Logo />
      </View>

      {/* ── Floating conversation ── */}
      <View style={[s.convoArea, { pointerEvents: "none" }]}>
        {lastMsgs.map((m, i) => (
          <ConvoLine key={m.id} msg={m} idx={i} total={lastMsgs.length} />
        ))}
        {partialTranscript ? (
          <Animated.Text entering={FadeIn.duration(200)} style={s.partialLine}>
            {partialTranscript}
          </Animated.Text>
        ) : null}
      </View>

      {/* ── Orb — central interactive element ── */}
      <Pressable onPress={handleOrbPress} style={s.orbArea} hitSlop={40}>
        <ZenOrb orbKey={orbKey} />
        {stateLabel ? (
          <Animated.Text entering={FadeIn.duration(500)} exiting={FadeOut.duration(400)} style={[s.stateLabel, wakeMode === "wake" && { color: "#A855F7" }]}>
            {stateLabel}
          </Animated.Text>
        ) : null}
      </Pressable>

      {/* ── Error whisper ── */}
      {error ? (
        <Animated.Text entering={FadeIn.duration(300)} style={s.errorWhisper}>
          {error}
        </Animated.Text>
      ) : null}

      {/* ── Bottom corners ── */}
      <View style={[s.bottomRow, { paddingBottom: bottomPad + 16 }]}>

        {/* Order badge — bottom left */}
        <Pressable
          onPress={() => { setPanelTab("order"); setPanelOpen(true); }}
          style={s.cornerBtn}
          hitSlop={16}
        >
          {orderCount > 0 ? (
            <View style={s.orderBadge}>
              <Text style={s.orderBadgeText}>{orderCount}</Text>
            </View>
          ) : (
            <View style={s.cornerDot} />
          )}
        </Pressable>

        {/* Interrupt — center, only when speaking */}
        {agentState === "speaking" ? (
          <Pressable onPress={interrupt} hitSlop={20} style={s.interruptBtn}>
            <View style={s.interruptDot} />
          </Pressable>
        ) : <View style={{ flex: 1 }} />}

        {/* Settings — bottom right */}
        <Pressable
          onPress={() => router.push("/setup")}
          style={s.cornerBtn}
          hitSlop={16}
        >
          <View style={[s.cornerDot, isConfigured && { backgroundColor: Colors.dark.accent + "55" }]} />
        </Pressable>
      </View>

      {/* ── Panel (order / catalog) ── */}
      <Modal
        visible={panelOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPanelOpen(false)}
      >
        <Pressable style={s.panelBackdrop} onPress={() => setPanelOpen(false)} />
        <View style={[s.panel, { paddingBottom: bottomPad + 16 }]}>
          <View style={s.panelHandle} />

          {/* Panel tab row */}
          <View style={s.panelTabs}>
            {(["order", "catalog"] as const).map((t) => (
              <Pressable key={t} onPress={() => setPanelTab(t)} style={s.panelTabBtn}>
                <Text style={[s.panelTabText, panelTab === t && s.panelTabActive]}>
                  {t}
                </Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPanelOpen(false)} style={s.panelClose}>
              <Feather name="x" size={16} color={Colors.dark.textMuted} />
            </Pressable>
          </View>

          {/* ── Order ── */}
          {panelTab === "order" && (() => {
            const items = currentOrder?.items ?? [];
            const total = currentOrder?.total ?? 0;
            if (lastSubmittedOrder) {
              return (
                <ScrollView style={s.panelScroll} contentContainerStyle={{ padding: 20, gap: 10 }}>
                  <Text style={s.submittedTotal}>${lastSubmittedOrder.total.toFixed(2)}</Text>
                  <Text style={s.submittedSub}>submitted</Text>
                  <View style={s.submittedDivider} />
                  {lastSubmittedOrder.items.map((item) => (
                    <View key={item.id} style={s.submittedRow}>
                      <Text style={s.submittedQty}>{item.quantity}×</Text>
                      <Text style={s.submittedName}>{item.catalogItem.name}</Text>
                      <Text style={s.submittedPrice}>${(item.catalogItem.price * item.quantity).toFixed(2)}</Text>
                    </View>
                  ))}
                  <Pressable onPress={() => Linking.openURL("https://squareup.com/dashboard/orders")} style={s.squareLinkBtn}>
                    <Text style={s.squareLinkText}>view in Square</Text>
                  </Pressable>
                </ScrollView>
              );
            }
            return (
              <View style={{ flex: 1 }}>
                {items.length === 0 ? (
                  <View style={s.emptyPanel}>
                    <Text style={s.emptyPanelText}>no items yet</Text>
                  </View>
                ) : (
                  <>
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
                      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
                      showsVerticalScrollIndicator={false}
                    />
                    <View style={s.orderFooter}>
                      <Text style={s.totalText}>${total.toFixed(2)}</Text>
                      <View style={s.orderActions}>
                        <Pressable onPress={clearOrder} style={s.clearBtn}>
                          <Feather name="trash-2" size={15} color={Colors.dark.danger} />
                        </Pressable>
                        <Pressable
                          onPress={async () => {
                            if (!accessToken || !locationId) return;
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            await submitOrder(accessToken, locationId);
                          }}
                          disabled={isSubmitting || !isConfigured}
                          style={[s.submitBtn, { opacity: isSubmitting || !isConfigured ? 0.5 : 1 }]}
                        >
                          {isSubmitting
                            ? <ActivityIndicator size="small" color={Colors.dark.background} />
                            : <Text style={s.submitText}>process</Text>
                          }
                        </Pressable>
                      </View>
                    </View>
                  </>
                )}
              </View>
            );
          })()}

          {/* ── Catalog ── */}
          {panelTab === "catalog" && (
            isLoadingCatalog ? (
              <View style={s.emptyPanel}>
                <ActivityIndicator size="small" color={Colors.dark.textMuted} />
              </View>
            ) : !isConfigured ? (
              <View style={s.emptyPanel}>
                <Text style={s.emptyPanelText}>square not connected</Text>
                <Pressable onPress={() => { setPanelOpen(false); router.push("/setup"); }} style={s.squareLinkBtn}>
                  <Text style={s.squareLinkText}>connect</Text>
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
                    <Text style={s.catalogName}>{item.name}</Text>
                    <Text style={s.catalogPrice}>${item.price.toFixed(2)}</Text>
                  </Pressable>
                )}
                contentContainerStyle={{ padding: 16 }}
                showsVerticalScrollIndicator={false}
              />
            )
          )}
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // Logo
  logoRow:   { alignItems: "center", paddingBottom: 8 },
  logoWrap:  { alignItems: "center", gap: 7 },
  logoMark:  { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  logoCircle: {
    position: "absolute",
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)",
  },
  logoDot: {
    position: "absolute",
    top: 5, right: 5,
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  logoText: {
    fontFamily: "Inter_300Light", fontSize: 10,
    letterSpacing: 4, color: "rgba(255,255,255,0.2)",
    textTransform: "lowercase",
  },

  // Conversation
  convoArea: {
    flex: 1, alignItems: "center", justifyContent: "flex-end",
    paddingHorizontal: 36, paddingBottom: 28, gap: 10,
  },
  convoLine: {
    textAlign: "center", lineHeight: 22,
    color: "rgba(255,255,255,0.85)",
  },
  partialLine: {
    textAlign: "center", fontSize: 13, lineHeight: 20,
    color: "rgba(255,255,255,0.3)", fontStyle: "italic",
    fontFamily: "Inter_300Light",
  },

  // Orb
  orbArea: { alignItems: "center", gap: 18, paddingVertical: 8 },
  orbWrap: { width: 200, height: 200, alignItems: "center", justifyContent: "center" },
  orbOuter: {
    position: "absolute",
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 0.5,
  },
  orbMid: {
    position: "absolute",
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 0.75,
    backgroundColor: "transparent",
  },
  orbCore: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 0.5,
  },
  stateLabel: {
    fontFamily: "Inter_300Light",
    fontSize: 11, letterSpacing: 2,
    color: "rgba(255,255,255,0.28)",
    textTransform: "lowercase",
  },

  // Error
  errorWhisper: {
    textAlign: "center", paddingHorizontal: 40,
    fontFamily: "Inter_300Light", fontSize: 11,
    color: "rgba(255,92,122,0.5)", letterSpacing: 0.5,
  },

  // Bottom bar
  bottomRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 32, paddingTop: 12,
  },
  cornerBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  cornerDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  orderBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.dark.accent + "22",
    borderWidth: 0.5, borderColor: Colors.dark.accent + "55",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  orderBadgeText: {
    fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.dark.accent,
  },
  interruptBtn: { flex: 1, alignItems: "center" },
  interruptDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
  },

  // Panel
  panelBackdrop: { flex: 1 },
  panel: {
    backgroundColor: "#0c0c14",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 0.5, borderColor: "rgba(255,255,255,0.06)",
    maxHeight: "75%",
    shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 40, shadowOffset: { width: 0, height: -8 },
  },
  panelHandle: {
    width: 32, height: 2.5, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  panelTabs: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 12, gap: 20,
  },
  panelTabBtn: { paddingVertical: 4 },
  panelTabText: {
    fontFamily: "Inter_400Regular", fontSize: 13,
    color: "rgba(255,255,255,0.25)", letterSpacing: 0.5,
    textTransform: "lowercase",
  },
  panelTabActive: { color: "rgba(255,255,255,0.75)" },
  panelClose: {
    marginLeft: "auto", padding: 4,
  },
  panelScroll: { flex: 1 },

  // Order
  emptyPanel: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingBottom: 40,
  },
  emptyPanelText: {
    fontFamily: "Inter_300Light", fontSize: 13,
    color: "rgba(255,255,255,0.2)", letterSpacing: 0.5,
  },
  submittedTotal: {
    fontFamily: "Inter_300Light", fontSize: 40,
    color: Colors.dark.accent, letterSpacing: -1,
  },
  submittedSub: {
    fontFamily: "Inter_300Light", fontSize: 11, letterSpacing: 2,
    color: "rgba(255,255,255,0.3)", textTransform: "lowercase", marginTop: -6,
  },
  submittedDivider: { height: 0.5, backgroundColor: "rgba(255,255,255,0.06)" },
  submittedRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  submittedQty: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.3)", width: 26 },
  submittedName: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.7)" },
  submittedPrice: { fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(255,255,255,0.5)" },
  squareLinkBtn: { marginTop: 4 },
  squareLinkText: {
    fontFamily: "Inter_300Light", fontSize: 12, letterSpacing: 0.5,
    color: Colors.dark.accent, textDecorationLine: "underline",
  },
  orderFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16,
    borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.05)",
    backgroundColor: "#0c0c14",
  },
  totalText: {
    fontFamily: "Inter_300Light", fontSize: 30,
    color: "rgba(255,255,255,0.75)", letterSpacing: -0.5, marginBottom: 12,
  },
  orderActions: { flexDirection: "row", gap: 10 },
  clearBtn: {
    width: 46, height: 46, borderRadius: 23,
    borderWidth: 0.5, borderColor: Colors.dark.danger + "33",
    alignItems: "center", justifyContent: "center",
  },
  submitBtn: {
    flex: 1, height: 46, borderRadius: 23,
    backgroundColor: Colors.dark.accent + "22",
    borderWidth: 0.5, borderColor: Colors.dark.accent + "55",
    alignItems: "center", justifyContent: "center",
  },
  submitText: {
    fontFamily: "Inter_400Regular", fontSize: 14,
    letterSpacing: 1, color: Colors.dark.accent,
    textTransform: "lowercase",
  },

  // Catalog
  catalogRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  catalogName: {
    flex: 1, fontFamily: "Inter_400Regular", fontSize: 14,
    color: "rgba(255,255,255,0.65)",
  },
  catalogPrice: {
    fontFamily: "Inter_300Light", fontSize: 13,
    color: "rgba(255,255,255,0.3)",
  },
});
