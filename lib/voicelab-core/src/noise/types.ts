/**
 * Noise modes encode the environment a venue's voice agent operates in.
 * Each mode shifts VAD sensitivity, wake-word availability, confirmation
 * thresholds, and barge-in behavior.
 */

export type NoiseMode =
  | "quiet_room"
  | "restaurant"
  | "bar"
  | "nightclub"
  | "event_venue"
  | "manual_push_to_talk";

export interface NoiseModeBehavior {
  mode: NoiseMode;
  displayName: string;
  description: string;
  /** Wake word allowed at all. */
  allowWakeWord: boolean;
  /** Push-to-talk recommended/required. */
  pushToTalkPreferred: boolean;
  pushToTalkRequired: boolean;
  /** Hint for VAD sensitivity (provider-specific tuning). */
  vadSensitivity: "high" | "medium" | "strict" | "off";
  /** Whether the agent should support barge-in (interruptible TTS). */
  bargeInEnabled: boolean;
  /** Confirmation friction multiplier — higher means more confirmations. */
  confirmationStrictness: "low" | "medium" | "high" | "very_high";
  /** Visual feedback emphasis (large-card UI for noisy rooms). */
  visualFeedback: "subtle" | "standard" | "prominent" | "max";
  /** Recommended grammar style hint. */
  grammarHint: "natural" | "short_command" | "menu_driven";
}
