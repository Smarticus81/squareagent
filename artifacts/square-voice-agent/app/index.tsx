import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  FadeInDown,
  Easing,
} from "react-native-reanimated";

import Colors from "@/constants/colors";
import { useVoiceAgent, ConversationMessage, AgentState } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP_INSET = 67;
const WEB_BOTTOM_INSET = 34;

// ── Conversation bubble ───────────────────────────────────────────────────────

function ConversationBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === "user";
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble]}
    >
      <Text style={[styles.bubbleText, isUser ? styles.userText : styles.agentText]}>
        {message.content}
      </Text>
    </Animated.View>
  );
}

// ── Live orb indicator ───────────────────────────────────────────────────────

function LiveOrb({ state }: { state: AgentState }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.7);

  useEffect(() => {
    if (state === "listening") {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) })
        ),
        -1, false
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900 }),
          withTiming(0.5, { duration: 900 })
        ),
        -1, false
      );
    } else if (state === "thinking") {
      scale.value = withRepeat(
        withTiming(1.05, { duration: 400, easing: Easing.inOut(Easing.quad) }),
        -1, true
      );
      opacity.value = withTiming(0.9);
    } else if (state === "speaking") {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 200, easing: Easing.in(Easing.quad) })
        ),
        -1, false
      );
      opacity.value = withTiming(1);
    } else {
      scale.value = withTiming(1, { duration: 400 });
      opacity.value = withTiming(0.5, { duration: 400 });
    }
  }, [state]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const colors: Record<AgentState, string> = {
    disconnected: Colors.dark.textMuted,
    connecting: Colors.dark.warning,
    listening: Colors.dark.accent,
    thinking: Colors.dark.warning,
    speaking: Colors.dark.accent,
    error: Colors.dark.danger,
  };

  const labels: Record<AgentState, string> = {
    disconnected: "Tap to start",
    connecting: "Connecting...",
    listening: "Listening",
    thinking: "Thinking...",
    speaking: "Speaking",
    error: "Error — tap to retry",
  };

  return (
    <View style={styles.orbWrapper}>
      {/* Outer glow */}
      <Animated.View style={[styles.orbGlow, orbStyle, { backgroundColor: colors[state] + "22" }]} />
      {/* Core */}
      <Animated.View style={[styles.orbCore, orbStyle, { backgroundColor: colors[state] }]} />
      <Text style={[styles.orbLabel, { color: colors[state] }]}>{labels[state]}</Text>
    </View>
  );
}

// ── Connect / Disconnect button ───────────────────────────────────────────────

function ConnectButton({
  state,
  onPress,
}: {
  state: AgentState;
  onPress: () => void;
}) {
  const isConnected = state !== "disconnected" && state !== "error" && state !== "connecting";
  const isConnecting = state === "connecting";

  return (
    <Pressable
      onPress={onPress}
      disabled={isConnecting}
      style={[
        styles.connectButton,
        isConnected && styles.connectButtonActive,
        { opacity: isConnecting ? 0.7 : 1 },
      ]}
    >
      {isConnecting ? (
        <ActivityIndicator size="small" color={Colors.dark.warning} />
      ) : (
        <Feather
          name={isConnected ? "mic-off" : "mic"}
          size={22}
          color={isConnected ? Colors.dark.danger : Colors.dark.accent}
        />
      )}
      <Text style={[styles.connectButtonText, isConnected && { color: Colors.dark.danger }]}>
        {isConnecting ? "Connecting" : isConnected ? "Stop Agent" : "Start Agent"}
      </Text>
    </Pressable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const {
    agentState,
    isConnected,
    conversation,
    partialTranscript,
    error,
    connect,
    disconnect,
    clearConversation,
    setToolHandler,
    interrupt,
  } = useVoiceAgent();

  const {
    currentOrder,
    addItem,
    removeItem,
    updateQuantity,
    clearOrder,
    submitOrder,
    isSubmitting,
  } = useOrder();

  const {
    isConfigured,
    catalogItems,
    isLoadingCatalog,
    accessToken,
    locationId,
  } = useSquare();

  const [activeTab, setActiveTab] = useState<"voice" | "order" | "catalog">("voice");
  const listRef = useRef<FlatList>(null);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;

  // ── Tool handler (registered once) ─────────────────────────────────────────

  const handleTool = useCallback(
    async (toolName: string, params: Record<string, unknown>): Promise<string> => {
      switch (toolName) {
        case "add_item": {
          const query = String(params.item_name ?? "").toLowerCase();
          const qty = Number(params.quantity ?? 1);
          const found = catalogItems.find(
            (c) =>
              c.name.toLowerCase().includes(query) ||
              query.includes(c.name.toLowerCase())
          );
          if (!found) return `Item "${query}" not found in catalog.`;
          addItem(found, qty);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setActiveTab("order");
          return `Added ${qty}x ${found.name} ($${(found.price * qty).toFixed(2)}). Order has ${(currentOrder?.items.length ?? 0) + 1} item(s).`;
        }

        case "remove_item": {
          const query = String(params.item_name ?? "").toLowerCase();
          const line = currentOrder?.items.find((i) =>
            i.catalogItem.name.toLowerCase().includes(query)
          );
          if (!line) return `"${query}" not in current order.`;
          removeItem(line.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          return `Removed ${line.catalogItem.name}.`;
        }

        case "get_order": {
          if (!currentOrder || currentOrder.items.length === 0) {
            return "Order is empty.";
          }
          const lines = currentOrder.items.map(
            (i) => `${i.quantity}x ${i.catalogItem.name} ($${(i.catalogItem.price * i.quantity).toFixed(2)})`
          );
          return `Order: ${lines.join(", ")}. Total: $${currentOrder.total.toFixed(2)}.`;
        }

        case "clear_order": {
          clearOrder();
          return "Order cleared.";
        }

        case "submit_order": {
          if (!accessToken || !locationId) {
            return "Square not connected. Please connect in Settings first.";
          }
          if (!currentOrder || currentOrder.items.length === 0) {
            return "Order is empty — nothing to submit.";
          }
          setActiveTab("order");
          const result = await submitOrder(accessToken, locationId);
          if (result.success) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            return `Order submitted! Square ID: ${result.orderId}. Total: $${currentOrder.total.toFixed(2)}.`;
          } else {
            return `Order submission failed: ${result.error ?? "unknown error"}`;
          }
        }

        default:
          return `Unknown tool: ${toolName}`;
      }
    },
    [catalogItems, currentOrder, addItem, removeItem, clearOrder, submitOrder, accessToken, locationId]
  );

  // Register tool handler whenever deps change
  useEffect(() => {
    setToolHandler(handleTool);
  }, [handleTool, setToolHandler]);

  // ── Toggle connect / disconnect ─────────────────────────────────────────────

  async function handleToggle() {
    if (isConnected || agentState === "connecting") {
      disconnect();
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await connect();
    }
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  const reversedConvo = [...conversation].reverse();

  function renderVoiceTab() {
    return (
      <View style={styles.voiceTabContent}>
        {/* Conversation history */}
        <FlatList
          ref={listRef}
          data={reversedConvo}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConversationBubble message={item} />}
          inverted={!!conversation.length}
          scrollEnabled={!!conversation.length}
          contentContainerStyle={styles.conversationList}
          ListEmptyComponent={
            <View style={styles.emptyConvo}>
              <Feather name="activity" size={36} color={Colors.dark.textMuted} />
              <Text style={styles.emptyConvoTitle}>Continuous Voice Agent</Text>
              <Text style={styles.emptyConvoSub}>
                Press Start Agent — it listens continuously.{"\n"}
                No tapping required. Just speak.
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />

        {/* Live partial transcript */}
        {partialTranscript ? (
          <View style={styles.partialContainer}>
            <Text style={styles.partialText}>{partialTranscript}</Text>
          </View>
        ) : null}

        {/* Waveform */}
        <View style={styles.waveformContainer}>
          <WaveformVisualizer
            isActive={agentState === "listening"}
            isSpeaking={agentState === "speaking"}
            barCount={36}
            height={48}
          />
        </View>

        {/* Orb + status */}
        <View style={styles.orbArea}>
          {/* Left: clear conversation */}
          <Pressable
            onPress={clearConversation}
            disabled={conversation.length === 0}
            style={styles.sideBtn}
          >
            <Feather
              name="trash-2"
              size={20}
              color={conversation.length === 0 ? Colors.dark.textMuted : Colors.dark.textSecondary}
            />
          </Pressable>

          {/* Center: Live orb + connect button */}
          <View style={styles.orbCenter}>
            <LiveOrb state={agentState} />
            <ConnectButton state={agentState} onPress={handleToggle} />
          </View>

          {/* Right: interrupt */}
          <Pressable
            onPress={interrupt}
            disabled={agentState !== "speaking"}
            style={styles.sideBtn}
          >
            <Feather
              name="square"
              size={20}
              color={agentState === "speaking" ? Colors.dark.accent : Colors.dark.textMuted}
            />
          </Pressable>
        </View>

        {/* Error message */}
        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={14} color={Colors.dark.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Not connected notice */}
        {agentState === "disconnected" && !error && !isConfigured && (
          <Pressable
            onPress={() => router.push("/setup")}
            style={[styles.noticeBar, { marginBottom: bottomPad + 8 }]}
          >
            <Feather name="link" size={13} color={Colors.dark.warning} />
            <Text style={styles.noticeText}>Connect Square to enable order management</Text>
            <Feather name="chevron-right" size={13} color={Colors.dark.textMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  function renderOrderTab() {
    const items = currentOrder?.items || [];
    const total = currentOrder?.total || 0;

    return (
      <View style={styles.orderTabContent}>
        {items.length === 0 ? (
          <View style={styles.emptyOrder}>
            <Feather name="shopping-bag" size={40} color={Colors.dark.textMuted} />
            <Text style={styles.emptyOrderTitle}>No items yet</Text>
            <Text style={styles.emptyOrderSub}>
              Start the agent and say what you need
            </Text>
          </View>
        ) : (
          <>
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
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
              contentContainerStyle={styles.orderList}
              showsVerticalScrollIndicator={false}
            />
            <View style={[styles.orderFooter, { paddingBottom: bottomPad + 8 }]}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>${total.toFixed(2)}</Text>
              </View>
              <View style={styles.orderActions}>
                <Pressable onPress={clearOrder} style={styles.clearOrderBtn}>
                  <Feather name="trash-2" size={18} color={Colors.dark.danger} />
                </Pressable>
                <Pressable
                  onPress={async () => {
                    if (!accessToken || !locationId) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    await submitOrder(accessToken, locationId);
                  }}
                  disabled={isSubmitting || !isConfigured}
                  style={[styles.submitBtn, { opacity: isSubmitting || !isConfigured ? 0.6 : 1 }]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color={Colors.dark.background} />
                  ) : (
                    <>
                      <Feather name="check" size={18} color={Colors.dark.background} />
                      <Text style={styles.submitBtnText}>
                        {!isConfigured ? "Connect Square first" : "Process Order"}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    );
  }

  function renderCatalogTab() {
    return (
      <View style={styles.catalogTabContent}>
        {isLoadingCatalog ? (
          <View style={styles.loadingCatalog}>
            <ActivityIndicator size="large" color={Colors.dark.accent} />
            <Text style={styles.loadingText}>Loading catalog...</Text>
          </View>
        ) : !isConfigured ? (
          <View style={styles.notConnected}>
            <Feather name="link" size={40} color={Colors.dark.textMuted} />
            <Text style={styles.notConnectedTitle}>Not Connected</Text>
            <Text style={styles.notConnectedSub}>Connect Square to see inventory</Text>
            <Pressable onPress={() => router.push("/setup")} style={styles.connectCatalogBtn}>
              <Text style={styles.connectCatalogBtnText}>Connect Square</Text>
            </Pressable>
          </View>
        ) : catalogItems.length === 0 ? (
          <View style={styles.emptyOrder}>
            <Feather name="package" size={40} color={Colors.dark.textMuted} />
            <Text style={styles.emptyOrderTitle}>No items found</Text>
            <Text style={styles.emptyOrderSub}>Add items to your Square catalog</Text>
          </View>
        ) : (
          <FlatList
            data={catalogItems}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.catalogItem}
                onPress={() => {
                  addItem(item, 1);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveTab("order");
                }}
              >
                <View style={styles.catalogInfo}>
                  <Text style={styles.catalogName}>{item.name}</Text>
                  {item.category && <Text style={styles.catalogCategory}>{item.category}</Text>}
                </View>
                <View style={styles.catalogRight}>
                  <Text style={styles.catalogPrice}>${item.price.toFixed(2)}</Text>
                  <View style={styles.addBadge}>
                    <Feather name="plus" size={14} color={Colors.dark.background} />
                  </View>
                </View>
              </Pressable>
            )}
            contentContainerStyle={{ paddingBottom: bottomPad + 16 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: Colors.dark.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.logoMark, isConnected && styles.logoMarkActive]}>
            <Feather name="mic" size={16} color={isConnected ? Colors.dark.background : Colors.dark.accent} />
          </View>
          <Text style={styles.headerTitle}>Voice POS</Text>
        </View>
        <View style={styles.headerRight}>
          {currentOrder && currentOrder.items.length > 0 && (
            <Pressable onPress={() => setActiveTab("order")} style={styles.orderBadgeBtn}>
              <Feather name="shopping-bag" size={16} color={Colors.dark.accent} />
              <View style={styles.orderCount}>
                <Text style={styles.orderCountText}>{currentOrder.items.length}</Text>
              </View>
            </Pressable>
          )}
          <Pressable onPress={() => router.push("/setup")} style={styles.settingsBtn}>
            <Feather
              name="settings"
              size={20}
              color={isConfigured ? Colors.dark.accent : Colors.dark.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {(["voice", "order", "catalog"] as const).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
          >
            <Feather
              name={tab === "voice" ? "activity" : tab === "order" ? "shopping-bag" : "grid"}
              size={15}
              color={activeTab === tab ? Colors.dark.accent : Colors.dark.textSecondary}
            />
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab === "voice" ? "Voice" : tab === "order" ? "Order" : "Catalog"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === "voice" && renderVoiceTab()}
        {activeTab === "order" && renderOrderTab()}
        {activeTab === "catalog" && renderCatalogTab()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.dark.accentDim,
    alignItems: "center", justifyContent: "center",
  },
  logoMarkActive: { backgroundColor: Colors.dark.accent },
  headerTitle: {
    fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.dark.text, letterSpacing: -0.5,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  orderBadgeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: Colors.dark.accentDim, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  orderCount: {
    backgroundColor: Colors.dark.accent, borderRadius: 8,
    minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  orderCountText: { fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.dark.background },
  settingsBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  tabBar: {
    flexDirection: "row", marginHorizontal: 16,
    backgroundColor: Colors.dark.surface, borderRadius: 14, padding: 4, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 9, borderRadius: 11,
  },
  tabActive: { backgroundColor: Colors.dark.surfaceElevated },
  tabLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.dark.textSecondary },
  tabLabelActive: { color: Colors.dark.accent },
  content: { flex: 1 },

  // Voice tab
  voiceTabContent: { flex: 1 },
  conversationList: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexGrow: 1,
  },
  bubble: {
    maxWidth: "80%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8,
  },
  userBubble: {
    alignSelf: "flex-end", backgroundColor: Colors.dark.accent, borderBottomRightRadius: 4,
  },
  agentBubble: {
    alignSelf: "flex-start", backgroundColor: Colors.dark.surfaceElevated,
    borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  bubbleText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  userText: { color: Colors.dark.background },
  agentText: { color: Colors.dark.text },
  emptyConvo: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 32, paddingVertical: 40,
  },
  emptyConvoTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.dark.text },
  emptyConvoSub: {
    fontFamily: "Inter_400Regular", fontSize: 14,
    color: Colors.dark.textSecondary, textAlign: "center", lineHeight: 20,
  },
  partialContainer: {
    marginHorizontal: 20, marginBottom: 6,
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  partialText: {
    fontFamily: "Inter_400Regular", fontSize: 13,
    color: Colors.dark.textSecondary, fontStyle: "italic",
  },
  waveformContainer: {
    alignItems: "center", paddingHorizontal: 20, paddingBottom: 4,
  },
  orbArea: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingVertical: 16,
  },
  sideBtn: {
    width: 48, height: 48, alignItems: "center", justifyContent: "center",
  },
  orbCenter: { flex: 1, alignItems: "center", gap: 16 },
  orbWrapper: { alignItems: "center", justifyContent: "center", gap: 8 },
  orbGlow: {
    position: "absolute", width: 80, height: 80, borderRadius: 40,
  },
  orbCore: {
    width: 24, height: 24, borderRadius: 12,
  },
  orbLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  connectButton: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14,
    backgroundColor: Colors.dark.surface, borderWidth: 1.5,
    borderColor: Colors.dark.accent,
  },
  connectButtonActive: {
    borderColor: Colors.dark.danger,
    backgroundColor: Colors.dark.dangerDim,
  },
  connectButtonText: {
    fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark.accent,
  },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.dark.dangerDim,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.dark.danger + "44",
  },
  errorText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.dark.danger },
  noticeBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  noticeText: {
    flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.dark.textSecondary,
  },

  // Order tab
  orderTabContent: { flex: 1 },
  emptyOrder: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 32,
  },
  emptyOrderTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.dark.text },
  emptyOrderSub: {
    fontFamily: "Inter_400Regular", fontSize: 14,
    color: Colors.dark.textSecondary, textAlign: "center",
  },
  orderList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  orderFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.dark.background,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.dark.surfaceBorder,
  },
  totalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
  },
  totalLabel: { fontFamily: "Inter_500Medium", fontSize: 16, color: Colors.dark.textSecondary },
  totalAmount: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.dark.text },
  orderActions: { flexDirection: "row", gap: 12 },
  clearOrderBtn: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: Colors.dark.dangerDim,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: Colors.dark.danger + "44",
  },
  submitBtn: {
    flex: 1, height: 52, borderRadius: 14, backgroundColor: Colors.dark.accent,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  submitBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.dark.background },

  // Catalog tab
  catalogTabContent: { flex: 1 },
  loadingCatalog: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.dark.textSecondary },
  notConnected: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  notConnectedTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.dark.text },
  notConnectedSub: {
    fontFamily: "Inter_400Regular", fontSize: 14,
    color: Colors.dark.textSecondary, textAlign: "center",
  },
  connectCatalogBtn: {
    backgroundColor: Colors.dark.accent, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12,
  },
  connectCatalogBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark.background },
  catalogItem: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginHorizontal: 16, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.dark.surfaceBorder,
  },
  catalogInfo: { flex: 1, gap: 2 },
  catalogName: { fontFamily: "Inter_500Medium", fontSize: 15, color: Colors.dark.text },
  catalogCategory: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.dark.textSecondary },
  catalogRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  catalogPrice: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.dark.text },
  addBadge: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.dark.accent,
    alignItems: "center", justifyContent: "center",
  },
});
