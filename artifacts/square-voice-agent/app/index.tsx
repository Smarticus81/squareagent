import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import { KeyboardAvoidingView as KeyboardAvoidingViewKC } from "react-native-keyboard-controller";

import Colors from "@/constants/colors";
import { useVoiceAgent, ConversationMessage, AgentState } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { MicButton } from "@/components/MicButton";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP_INSET = 67;
const WEB_BOTTOM_INSET = 34;

function ConversationBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === "user";
  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.agentBubble,
      ]}
    >
      <Text style={[styles.bubbleText, isUser ? styles.userText : styles.agentText]}>
        {message.content}
      </Text>
    </Animated.View>
  );
}

function AgentStatusBadge({ state }: { state: AgentState }) {
  const labels: Record<AgentState, string> = {
    idle: "Ready",
    listening: "Listening...",
    processing: "Thinking...",
    speaking: "Speaking",
    error: "Error",
  };

  const colors: Record<AgentState, string> = {
    idle: Colors.dark.textMuted,
    listening: Colors.dark.danger,
    processing: Colors.dark.warning,
    speaking: Colors.dark.accent,
    error: Colors.dark.danger,
  };

  return (
    <View style={styles.statusBadge}>
      <View style={[styles.statusDot, { backgroundColor: colors[state] }]} />
      <Text style={[styles.statusText, { color: colors[state] }]}>{labels[state]}</Text>
    </View>
  );
}

export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const {
    agentState,
    conversation,
    isRecording,
    transcript,
    agentResponse,
    error,
    startListening,
    stopListening,
    sendTextMessage,
    clearConversation,
    cancelSpeaking,
  } = useVoiceAgent();
  const { currentOrder, addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting } = useOrder();
  const { isConfigured, catalogItems, isLoadingCatalog, searchCatalog, accessToken, locationId } = useSquare();

  const [textInput, setTextInput] = useState("");
  const [activeTab, setActiveTab] = useState<"voice" | "order" | "catalog">("voice");
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList>(null);

  // Register global action handler
  useEffect(() => {
    (globalThis as any).__voiceAgentActionHandler = (action: any) => {
      handleAgentAction(action);
    };
    return () => {
      delete (globalThis as any).__voiceAgentActionHandler;
    };
  }, [catalogItems]);

  function handleAgentAction(action: any) {
    if (!action?.type) return;

    switch (action.type) {
      case "ADD_ITEM": {
        const query = action.itemName?.toLowerCase() || "";
        const found = catalogItems.find(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            query.includes(item.name.toLowerCase())
        );
        if (found) {
          addItem(found, action.quantity || 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setActiveTab("order");
        }
        break;
      }
      case "REMOVE_ITEM": {
        const query = action.itemName?.toLowerCase() || "";
        const lineItem = currentOrder?.items.find((i) =>
          i.catalogItem.name.toLowerCase().includes(query)
        );
        if (lineItem) removeItem(lineItem.id);
        break;
      }
      case "CLEAR_ORDER":
        clearOrder();
        break;
      case "SUBMIT_ORDER":
        setActiveTab("order");
        break;
      case "SHOW_ORDER":
        setActiveTab("order");
        break;
    }
  }

  async function handleMicPress() {
    if (agentState === "speaking") {
      cancelSpeaking();
      return;
    }
    if (isRecording) {
      await stopListening();
    } else if (agentState === "idle" || agentState === "error") {
      await startListening();
    }
  }

  async function handleSendText() {
    if (!textInput.trim() || agentState !== "idle") return;
    const text = textInput;
    setTextInput("");
    await sendTextMessage(text);
    inputRef.current?.focus();
  }

  async function handleSubmitOrder() {
    if (!accessToken || !locationId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const result = await submitOrder(accessToken, locationId);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await sendTextMessage("The order has been submitted. Square order ID: " + result.orderId);
      setActiveTab("voice");
    }
  }

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  const bottomPad = Platform.OS === "web" ? WEB_BOTTOM_INSET : insets.bottom;

  const reversedConvo = [...conversation].reverse();

  function renderVoiceTab() {
    return (
      <View style={styles.voiceTabContent}>
        {/* Conversation */}
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
              <Feather name="mic" size={36} color={Colors.dark.textMuted} />
              <Text style={styles.emptyConvoTitle}>Voice POS Agent</Text>
              <Text style={styles.emptyConvoSub}>
                Tap the mic and say something like{"\n"}"Add 2 coffees and a croissant"
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />

        {/* Waveform */}
        <View style={styles.waveformContainer}>
          <WaveformVisualizer
            isActive={isRecording}
            isSpeaking={agentState === "speaking"}
            barCount={32}
            height={52}
          />
          {transcript && agentState !== "idle" && (
            <Text style={styles.transcriptText} numberOfLines={2}>
              {transcript}
            </Text>
          )}
        </View>

        {/* Mic Area */}
        <View style={styles.micArea}>
          <AgentStatusBadge state={agentState} />
          <MicButton
            isRecording={isRecording}
            isProcessing={agentState === "processing"}
            isSpeaking={agentState === "speaking"}
            onPress={handleMicPress}
            size={84}
          />
          <Pressable
            onPress={clearConversation}
            style={styles.clearBtn}
            disabled={conversation.length === 0}
          >
            <Feather
              name="trash-2"
              size={20}
              color={conversation.length === 0 ? Colors.dark.textMuted : Colors.dark.textSecondary}
            />
          </Pressable>
        </View>

        {/* Text input */}
        <View style={[styles.textInputArea, { paddingBottom: bottomPad + 8 }]}>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={textInput}
            onChangeText={setTextInput}
            placeholder="Or type a command..."
            placeholderTextColor={Colors.dark.textMuted}
            onSubmitEditing={handleSendText}
            blurOnSubmit={false}
            returnKeyType="send"
            editable={agentState === "idle"}
          />
          <Pressable
            onPress={handleSendText}
            disabled={!textInput.trim() || agentState !== "idle"}
            style={[
              styles.sendBtn,
              { opacity: !textInput.trim() || agentState !== "idle" ? 0.4 : 1 },
            ]}
          >
            <Feather name="send" size={16} color={Colors.dark.background} />
          </Pressable>
        </View>

        {error && (
          <Text style={styles.errorText}>{error}</Text>
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
              Use the mic to add items by voice, or browse the catalog
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
                  onPress={handleSubmitOrder}
                  disabled={isSubmitting || !isConfigured}
                  style={[styles.submitBtn, { opacity: isSubmitting || !isConfigured ? 0.6 : 1 }]}
                  testID="submit-order-btn"
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
            <Text style={styles.notConnectedSub}>Connect your Square account to see inventory</Text>
            <Pressable
              onPress={() => router.push("/setup")}
              style={styles.connectBtn}
            >
              <Text style={styles.connectBtnText}>Connect Square</Text>
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
                testID={`catalog-item-${item.id}`}
              >
                <View style={styles.catalogInfo}>
                  <Text style={styles.catalogName}>{item.name}</Text>
                  {item.category && (
                    <Text style={styles.catalogCategory}>{item.category}</Text>
                  )}
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
    <KeyboardAvoidingViewKC
      style={[styles.root, { backgroundColor: Colors.dark.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoMark}>
            <Feather name="mic" size={16} color={Colors.dark.accent} />
          </View>
          <Text style={styles.headerTitle}>Voice POS</Text>
        </View>

        <View style={styles.headerRight}>
          {currentOrder && currentOrder.items.length > 0 && (
            <Pressable
              onPress={() => setActiveTab("order")}
              style={styles.orderBadgeBtn}
            >
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
            onPress={() => {
              setActiveTab(tab);
              Haptics.selectionAsync();
            }}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
          >
            <Feather
              name={tab === "voice" ? "mic" : tab === "order" ? "shopping-bag" : "grid"}
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
    </KeyboardAvoidingViewKC>
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
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.dark.accentDim,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  orderBadgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dark.accentDim,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  orderCount: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  orderCountText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    color: Colors.dark.background,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBar: {
    flexDirection: "row",
    marginHorizontal: 16,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 11,
  },
  tabActive: {
    backgroundColor: Colors.dark.surfaceElevated,
  },
  tabLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  tabLabelActive: {
    color: Colors.dark.accent,
  },
  content: {
    flex: 1,
  },

  // Voice tab
  voiceTabContent: {
    flex: 1,
  },
  conversationList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    flexGrow: 1,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: Colors.dark.accent,
    borderBottomRightRadius: 4,
  },
  agentBubble: {
    alignSelf: "flex-start",
    backgroundColor: Colors.dark.surfaceElevated,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  bubbleText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: Colors.dark.background,
  },
  agentText: {
    color: Colors.dark.text,
  },
  emptyConvo: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  emptyConvoTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.dark.text,
  },
  emptyConvoSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  waveformContainer: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 6,
  },
  transcriptText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    fontStyle: "italic",
  },
  micArea: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 90,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  clearBtn: {
    minWidth: 90,
    alignItems: "flex-end",
    padding: 8,
  },
  textInputArea: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.surfaceBorder,
  },
  textInput: {
    flex: 1,
    height: 44,
    backgroundColor: Colors.dark.surfaceElevated,
    borderRadius: 22,
    paddingHorizontal: 16,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.surfaceBorder,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.danger,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },

  // Order tab
  orderTabContent: {
    flex: 1,
  },
  orderList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  emptyOrder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyOrderTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.dark.text,
  },
  emptyOrderSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  orderFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.surfaceBorder,
    gap: 12,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  totalAmount: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: Colors.dark.text,
    letterSpacing: -1,
  },
  orderActions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  clearOrderBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.dark.dangerDim,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.dark.danger + "33",
  },
  submitBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.dark.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.background,
  },

  // Catalog tab
  catalogTabContent: {
    flex: 1,
  },
  loadingCatalog: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  notConnected: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  notConnectedTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.dark.text,
  },
  notConnectedSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  connectBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.dark.accent,
  },
  connectBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.background,
  },
  catalogItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.surfaceBorder,
  },
  catalogInfo: {
    flex: 1,
    marginRight: 12,
  },
  catalogName: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: Colors.dark.text,
  },
  catalogCategory: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  catalogRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  catalogPrice: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.accent,
  },
  addBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.dark.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
