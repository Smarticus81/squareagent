import React, {
  useEffect, useRef, useState, useCallback,
} from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, Modal, ActivityIndicator, Linking, useColorScheme,
} from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle, useSharedValue,
  withRepeat, withSequence, withTiming, FadeIn, FadeOut, Easing,
} from "react-native-reanimated";

import { useWakeWord, isWakeWordSupported } from "@/hooks/useWakeWord";
import { matchTermination } from "@/lib/voice-termination";
import { useVoiceAgent, ConversationMessage, AgentState, OrderCommand } from "@/context/VoiceAgentContext";
import { useOrder } from "@/context/OrderContext";
import { useSquare } from "@/context/SquareContext";
import { useVoicePrefs, SPEEDS } from "@/hooks/useVoicePrefs";
import { OrderCard } from "@/components/OrderCard";

const WEB_TOP = 67;
const WEB_BOT = 34;

// ── Rail colors per state ──────────────────────────────────────────────────────
type RailKey = AgentState | "wake";

const RAIL_COLORS = {
  light: {
    line:       "rgba(17,19,24,0.12)",
    glow:       "rgba(17,19,24,0.05)",
    active:     "rgba(150,110,40,0.55)",
    listening:  "rgba(94,86,230,0.55)",
    speaking:   "rgba(150,110,40,0.55)",
    thinking:   "rgba(220,90,30,0.50)",
    error:      "rgba(180,40,40,0.55)",
    bar:        "rgba(17,19,24,0.18)",
  },
  dark: {
    line:       "rgba(245,239,227,0.10)",
    glow:       "rgba(245,239,227,0.04)",
    active:     "rgba(224,183,106,0.65)",
    listening:  "rgba(124,110,245,0.70)",
    speaking:   "rgba(224,183,106,0.70)",
    thinking:   "rgba(255,106,42,0.55)",
    error:      "rgba(224,82,82,0.65)",
    bar:        "rgba(245,239,227,0.18)",
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

function pipelineProviderLabel(provider: string | null | undefined): string {
  if (!provider) return "";
  switch (provider) {
    case "openai_realtime_webrtc":          return "OpenAI Realtime";
    case "openai_realtime_server_ws":       return "OpenAI Realtime (WS)";
    case "google_gemini_3_1_flash_live":    return "Gemini 2.0 Flash Live";
    case "google_gemini_2_5_flash_native_audio": return "Gemini 2.5 Flash Audio";
    case "google_gemini_live_native_audio": return "Gemini Live";
    case "hume_evi_3":                      return "Hume EVI 3";
    case "elevenlabs_agents":               return "ElevenLabs";
    case "deepgram_voice_agent_api":        return "Deepgram Voice Agent";
    case "livekit_agents":                  return "LiveKit Agents";
    case "pipecat":                         return "Pipecat";
    case "deepgram_flux_cartesia":          return "Deepgram + Cartesia";
    case "deepgram_flux_aura":              return "Deepgram Flux + Aura";
    case "cartesia_ink_sonic":              return "Cartesia Ink + Sonic";
    case "assemblyai_openai_cartesia":      return "AssemblyAI + OpenAI + Cartesia";
    case "custom_modular_pipeline":         return "Custom Pipeline";
    case "browser_speech_api_fallback":     return "Browser Speech";
    case "push_to_talk_text_fallback":      return "Push-to-talk";
    case "text_only_fallback":              return "Text only";
    default:                                return provider;
  }
}

function buildWakeWords(wakePhrase: string): string[] {
  const normalized = wakePhrase.toLowerCase().trim();
  const compact = normalized.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
  // Always include a small set of safe, multi-syllable defaults.
  const words = new Set<string>(["hey voyce", "hey voicelab", "hey voycelab", "voycelab"]);
  if (compact) {
    words.add(compact);
    // Never add the bare name on its own — single-word names like "bev"
    // overlap with common English ("beverage") and cause false wakes.
    if (!compact.startsWith("hey ")) {
      words.add(`hey ${compact}`);
    }
  } else {
    words.add("hey bar");
  }
  return Array.from(words);
}

const NUM_BARS = 24;

// ── Theme ──────────────────────────────────────────────────────────────────────
const THEMES = {
  light: {
    bg:           "#F5EFE3" as const,
    bgGrad:       ["#F8F2E5", "#F0E7D2", "#F5EFE3"] as const,
    logoText:     "rgba(17,19,24,0.78)",
    stateText:    "rgba(17,19,24,0.48)",
    tapHint:      "rgba(17,19,24,0.35)",
    errorText:    "rgba(180,40,40,0.90)",
    hamburger:    "rgba(17,19,24,0.45)",
    badgeBorder:  "rgba(150,110,40,0.32)",
    badgeText:    "rgba(150,110,40,0.85)",
    msgAgent:     (op: number) => `rgba(17,19,24,${op})`,
    msgUser:      (op: number) => `rgba(17,19,24,${op})`,
    partial:      "rgba(17,19,24,0.42)",
    panelBg:      "#FFFFFF",
    panelBorder:  "rgba(17,19,24,0.10)",
    panelHandle:  "rgba(17,19,24,0.18)",
    navText:      "rgba(17,19,24,0.46)",
    navActive:    "rgba(17,19,24,0.86)",
    divider:      "rgba(17,19,24,0.10)",
    recTotal:     "rgba(17,19,24,0.86)",
    recLabel:     "rgba(17,19,24,0.32)",
    rowName:      "rgba(17,19,24,0.78)",
    rowQty:       "rgba(17,19,24,0.42)",
    rowPrice:     "rgba(17,19,24,0.55)",
    emptyTxt:     "rgba(17,19,24,0.42)",
    emptyHint:    "rgba(17,19,24,0.30)",
    orderTotal:   "rgba(17,19,24,0.82)",
    orderFtrBg:   "#FFFFFF",
    clearBorder:  "rgba(180,40,40,0.28)",
    clearIcon:    "rgba(180,40,40,0.74)",
    submitBg:     "rgba(198,154,82,0.10)",
    submitBorder: "rgba(198,154,82,0.32)",
    submitText:   "rgba(150,110,40,0.85)",
    catName:      "rgba(17,19,24,0.78)",
    catCat:       "rgba(17,19,24,0.42)",
    catPrice:     "rgba(17,19,24,0.55)",
    settingsTxt:  "rgba(17,19,24,0.78)",
    settingsIcon: "rgba(17,19,24,0.55)",
    chevron:      "rgba(17,19,24,0.32)",
    link:         "rgba(150,110,40,0.85)",
  },
  dark: {
    bg:           "#07080A" as const,
    bgGrad:       ["#07080A", "#0B0D12", "#07080A"] as const,
    logoText:     "rgba(245,239,227,0.78)",
    stateText:    "rgba(245,239,227,0.50)",
    tapHint:      "rgba(245,239,227,0.38)",
    errorText:    "rgba(232,128,128,0.92)",
    hamburger:    "rgba(245,239,227,0.55)",
    badgeBorder:  "rgba(224,183,106,0.32)",
    badgeText:    "#E0B76A",
    msgAgent:     (op: number) => `rgba(245,239,227,${op})`,
    msgUser:      (op: number) => `rgba(245,239,227,${op})`,
    partial:      "rgba(245,239,227,0.42)",
    panelBg:      "#111318",
    panelBorder:  "rgba(245,239,227,0.10)",
    panelHandle:  "rgba(245,239,227,0.18)",
    navText:      "rgba(245,239,227,0.46)",
    navActive:    "rgba(245,239,227,0.92)",
    divider:      "rgba(245,239,227,0.08)",
    recTotal:     "rgba(245,239,227,0.86)",
    recLabel:     "rgba(245,239,227,0.42)",
    rowName:      "rgba(245,239,227,0.82)",
    rowQty:       "rgba(245,239,227,0.42)",
    rowPrice:     "rgba(245,239,227,0.55)",
    emptyTxt:     "rgba(245,239,227,0.42)",
    emptyHint:    "rgba(245,239,227,0.30)",
    orderTotal:   "rgba(245,239,227,0.86)",
    orderFtrBg:   "#111318",
    clearBorder:  "rgba(224,82,82,0.30)",
    clearIcon:    "rgba(232,128,128,0.74)",
    submitBg:     "rgba(224,183,106,0.10)",
    submitBorder: "rgba(224,183,106,0.32)",
    submitText:   "#E0B76A",
    catName:      "rgba(245,239,227,0.82)",
    catCat:       "rgba(245,239,227,0.42)",
    catPrice:     "rgba(245,239,227,0.55)",
    settingsTxt:  "rgba(245,239,227,0.82)",
    settingsIcon: "rgba(245,239,227,0.55)",
    chevron:      "rgba(245,239,227,0.32)",
    link:         "#E0B76A",
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
    pipelineProvider,
    connect, disconnect, setToolHandler, interrupt,
    setCatalog, setCurrentOrder, setSquareCredentials, setAuthParams, setAgentPipeline,
  } = useVoiceAgent();

  const {
    currentOrder, lastSubmittedOrder,
    addItem, removeItem, updateQuantity, clearOrder, submitOrder, isSubmitting,
  } = useOrder();

  const { isConfigured, catalogItems, isLoadingCatalog, accessToken, locationId, venueId, authToken,
    connectionError, isReconnecting, refreshCredentials, wakePhrase, agentProfile } = useSquare();
  const { voice, speed, setVoice, setSpeed, loaded: voicePrefsLoaded, voices } = useVoicePrefs(
    agentProfile?.voicePipelineProvider,
    agentProfile?.voicePipelineConfig,
  );
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

  const terminationHandledRef = useRef(false);
  useEffect(() => {
    if (wakeMode === "command") terminationHandledRef.current = false;
  }, [wakeMode]);

  const startWakeWordRef = useRef<(() => void | Promise<void>) | null>(null);

  const onWake = useCallback(async () => {
    setWakeMode("command");
    await connect();
  }, [connect]);

  const onSoftTerminateFromWake = useCallback(async () => {
    await disconnect();
    setWakeMode("wake");
    setTimeout(() => startWakeWordRef.current?.(), 450);
  }, [disconnect]);

  const onHardShutdownFromWake = useCallback(async () => {
    setWakeMode("idle");
    await disconnect();
  }, [disconnect]);

  const { isListening: wakeListening, startWakeWord, stopWakeWord } = useWakeWord({
    wakeWords: buildWakeWords(wakePhrase),
    onWakeWordDetected: onWake,
    onStopDetected: onSoftTerminateFromWake,
    onShutdownDetected: onHardShutdownFromWake,
  });

  useEffect(() => {
    startWakeWordRef.current = startWakeWord;
  }, [startWakeWord]);

  const enterWake = useCallback(() => {
    setWakeMode("wake");
    startWakeWord();
  }, [startWakeWord]);

  const exitWake = useCallback(async () => {
    stopWakeWord();
    await disconnect();
    setWakeMode("idle");
  }, [stopWakeWord, disconnect]);

  useEffect(() => {
    if (wakeModeRef.current !== "command" || isConnected) return;
    const ti = setTimeout(() => {
      if (wakeModeRef.current !== "command") return;
      setWakeMode("wake");
      startWakeWord();
    }, 350);
    return () => clearTimeout(ti);
  }, [isConnected, startWakeWord]);

  const applyTermination = useCallback(
    async (kind: "soft" | "hard") => {
      if (terminationHandledRef.current) return;
      terminationHandledRef.current = true;
      if (kind === "hard") {
        setWakeMode("idle");
        await disconnect();
      } else {
        setWakeMode("wake");
        await disconnect();
        setTimeout(() => startWakeWordRef.current?.(), 450);
      }
    },
    [disconnect],
  );

  useEffect(() => {
    if (wakeMode !== "command") return;
    const last = [...conversation].reverse().find((m) => m.role === "user");
    if (!last) return;
    const kind = matchTermination(last.content);
    if (kind) void applyTermination(kind);
  }, [conversation, wakeMode, applyTermination]);

  useEffect(() => {
    if (wakeMode !== "command" || !partialTranscript?.trim()) return;
    const kind = matchTermination(partialTranscript, { partial: true });
    if (kind) void applyTermination(kind);
  }, [partialTranscript, wakeMode, applyTermination]);

  useEffect(() => {
    setCatalog(catalogItems.map((c) => ({ id: c.id, variationId: c.variationId, name: c.name, price: c.price, category: c.category })));
  }, [catalogItems, setCatalog]);

  useEffect(() => { if (accessToken && locationId) setSquareCredentials(accessToken, locationId); }, [accessToken, locationId, setSquareCredentials]);

  // Forward auth params so voice agent can authenticate server-side tool calls
  useEffect(() => { if (venueId && authToken) setAuthParams(venueId, authToken); }, [venueId, authToken, setAuthParams]);

  // Forward the assistant's configured voice pipeline so the connection path
  // matches what was set up on the dashboard (OpenAI vs Gemini vs Deepgram
  // vs modular). Without this the EAS build would silently use OpenAI for
  // every assistant.
  useEffect(() => {
    setAgentPipeline(
      agentProfile?.voicePipelineProvider ?? null,
      agentProfile?.voicePipelineConfig ?? null,
      agentProfile?.id ?? null,
    );
  }, [agentProfile, setAgentPipeline]);

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
          <Svg width={36} height={22} viewBox="0 0 52 32">
            <Defs>
              <SvgLinearGradient id="vl-top-lilac" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#D9CBF0" />
                <Stop offset="100%" stopColor="#A38EDC" />
              </SvgLinearGradient>
              <SvgLinearGradient id="vl-top-coral" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#FF8A66" />
                <Stop offset="100%" stopColor="#E2502E" />
              </SvgLinearGradient>
              <SvgLinearGradient id="vl-top-sage" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#B9DBBE" />
                <Stop offset="100%" stopColor="#7FB386" />
              </SvgLinearGradient>
            </Defs>
            <Rect x={1} y={14} width={3} height={4} rx={1.5} fill="url(#vl-top-lilac)" />
            <Rect x={6} y={11} width={3} height={10} rx={1.5} fill="url(#vl-top-lilac)" />
            <Rect x={11} y={6} width={3} height={20} rx={1.5} fill="url(#vl-top-coral)" />
            <Rect x={16} y={2} width={3} height={28} rx={1.5} fill="url(#vl-top-coral)" />
            <Rect x={21} y={0} width={3} height={32} rx={1.5} fill="url(#vl-top-coral)" />
            <Rect x={26} y={2} width={3} height={28} rx={1.5} fill="url(#vl-top-coral)" />
            <Rect x={31} y={6} width={3} height={20} rx={1.5} fill="url(#vl-top-coral)" />
            <Rect x={36} y={10} width={3} height={12} rx={1.5} fill="url(#vl-top-sage)" />
            <Rect x={41} y={13} width={3} height={6} rx={1.5} fill="url(#vl-top-sage)" />
            <Rect x={46} y={14} width={3} height={4} rx={1.5} fill="url(#vl-top-sage)" />
          </Svg>
          <View style={s.brandWords}>
            <Text style={[s.brandVoyce, { color: t.logoText }]}>Voyce</Text>
            <Text style={[s.brandLabs, { color: t.logoText, opacity: 0.92 }]}>Lab</Text>
          </View>
          {pipelineProvider ? (
            <View style={[s.providerBadge, { borderColor: t.badgeBorder }]}>
              <Text style={[s.providerBadgeText, { color: t.badgeText }]} numberOfLines={1}>
                {pipelineProviderLabel(pipelineProvider)}
              </Text>
            </View>
          ) : null}
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
        {/* Watermark — equalizer mark */}
        <View style={s.watermark} pointerEvents="none">
          <Svg width={190} height={118} viewBox="0 0 52 32" opacity={0.08}>
            <Defs>
              <SvgLinearGradient id="vl-wm-lilac" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#D9CBF0" />
                <Stop offset="100%" stopColor="#A38EDC" />
              </SvgLinearGradient>
              <SvgLinearGradient id="vl-wm-coral" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#FF8A66" />
                <Stop offset="100%" stopColor="#E2502E" />
              </SvgLinearGradient>
              <SvgLinearGradient id="vl-wm-sage" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#B9DBBE" />
                <Stop offset="100%" stopColor="#7FB386" />
              </SvgLinearGradient>
            </Defs>
            <Rect x={1} y={14} width={3} height={4} rx={1.5} fill="url(#vl-wm-lilac)" />
            <Rect x={6} y={11} width={3} height={10} rx={1.5} fill="url(#vl-wm-lilac)" />
            <Rect x={11} y={6} width={3} height={20} rx={1.5} fill="url(#vl-wm-coral)" />
            <Rect x={16} y={2} width={3} height={28} rx={1.5} fill="url(#vl-wm-coral)" />
            <Rect x={21} y={0} width={3} height={32} rx={1.5} fill="url(#vl-wm-coral)" />
            <Rect x={26} y={2} width={3} height={28} rx={1.5} fill="url(#vl-wm-coral)" />
            <Rect x={31} y={6} width={3} height={20} rx={1.5} fill="url(#vl-wm-coral)" />
            <Rect x={36} y={10} width={3} height={12} rx={1.5} fill="url(#vl-wm-sage)" />
            <Rect x={41} y={13} width={3} height={6} rx={1.5} fill="url(#vl-wm-sage)" />
            <Rect x={46} y={14} width={3} height={4} rx={1.5} fill="url(#vl-wm-sage)" />
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
                color={wakeMode === "idle" ? t.hamburger : "#7C6EF5"}
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
                  <Text style={[s.settingsRowTxt, { color: t.settingsTxt }]}>Voice · {pipelineProviderLabel(agentProfile?.voicePipelineProvider)}</Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 28 }}>
                  {voices.map((v) => (
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
  brandVoyce:     { fontFamily: "Inter_500Medium", fontSize: 15, letterSpacing: -0.2, fontWeight: "600" },
  brandLabs:     { fontFamily: "Inter_500Medium", fontSize: 15, letterSpacing: -0.2, fontWeight: "500" },
  providerBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 0.5,
    maxWidth: 140,
  },
  providerBadgeText: { fontFamily: "Inter_500Medium", fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" },
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
