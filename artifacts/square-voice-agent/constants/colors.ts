/**
 * VoyceLab — warm hospitality palette shared by Expo and EAS builds.
 */
const palette = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceElevated: "#FAFAFB",
  surfaceBorder: "rgba(10,10,11,0.10)",
  surfaceBorderLight: "rgba(10,10,11,0.06)",
  text: "#0A0A0B",
  textSecondary: "rgba(10,10,11,0.66)",
  textMuted: "rgba(10,10,11,0.42)",
  accent: "#6366F1",
  accentBright: "#818CF8",
  accentDim: "rgba(99,102,241,0.16)",
  accentSubtle: "rgba(99,102,241,0.08)",
  accentGlow: "rgba(99,102,241,0.30)",
  secondary: "#A38EDC",
  secondaryDim: "rgba(199,183,229,0.30)",
  danger: "#DC2626",
  dangerDim: "rgba(220,38,38,0.12)",
  warning: "#F59E0B",
  success: "#10B981",
  successDim: "rgba(16,185,129,0.14)",
  wake: "#6366F1",
  wakeDim: "rgba(99,102,241,0.18)",
  wakeGlow: "rgba(99,102,241,0.32)",
  tint: "#6366F1",
  tabIconDefault: "rgba(10,10,11,0.36)",
  tabIconSelected: "#6366F1",
  orderItem: "#FAFAFB",
  waveform: "#6366F1",
  waveformInactive: "rgba(10,10,11,0.12)",
  micActive: "#6366F1",
  micInactive: "#FAFAFB",
  cardShadow: "rgba(10,10,11,0.10)",
  ember: "#FF6B47",
};

const Colors = {
  // Both kept so existing `Colors.dark.x` references still work; the values
  // now describe the light cream/indigo theme that matches the landing site.
  dark: palette,
  light: palette,
};

export default Colors;
export type ThemeColors = typeof palette;
