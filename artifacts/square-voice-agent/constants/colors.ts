/**
 * VoyceLab — voice surface palette.
 * Dark flagship: black marble, brass edge light, voice violet, ember scan.
 */
const Colors = {
  dark: {
    background: "#07080A",
    surface: "#111318",
    surfaceElevated: "#181B22",
    surfaceBorder: "#242832",
    surfaceBorderLight: "rgba(245,239,227,0.14)",
    text: "#F5EFE3",
    textSecondary: "rgba(245,239,227,0.62)",
    textMuted: "rgba(245,239,227,0.38)",
    accent: "#E0B76A",
    accentBright: "#F1CD86",
    accentDim: "rgba(224,183,106,0.14)",
    accentSubtle: "rgba(224,183,106,0.08)",
    accentGlow: "rgba(224,183,106,0.32)",
    secondary: "#7C6EF5",
    secondaryDim: "rgba(124,110,245,0.18)",
    danger: "#E05252",
    dangerDim: "rgba(224,82,82,0.18)",
    warning: "#F2B84B",
    success: "#35C275",
    successDim: "rgba(53,194,117,0.18)",
    wake: "#7C6EF5",
    wakeDim: "rgba(124,110,245,0.20)",
    wakeGlow: "rgba(124,110,245,0.40)",
    tint: "#E0B76A",
    tabIconDefault: "rgba(245,239,227,0.36)",
    tabIconSelected: "#E0B76A",
    orderItem: "#0E1015",
    waveform: "#E0B76A",
    waveformInactive: "#242832",
    micActive: "#7C6EF5",
    micInactive: "#181B22",
    cardShadow: "#00000080",
    ember: "#FF6A2A",
  },
};

export default Colors;
export type ThemeColors = typeof Colors.dark;
