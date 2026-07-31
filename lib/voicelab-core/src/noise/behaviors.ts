import type { NoiseMode, NoiseModeBehavior } from "./types";

// Collapsed from 6 modes to 3 (2026-05-22):
//   quiet_room + restaurant → standard
//   bar + event_venue → loud
//   nightclub + manual_push_to_talk → push_to_talk
export const NOISE_MODE_BEHAVIORS: Record<NoiseMode, NoiseModeBehavior> = {
  standard: {
    mode: "standard",
    displayName: "Standard",
    description: "Moderate background noise. Wake word still usable.",
    allowWakeWord: true,
    pushToTalkPreferred: false,
    pushToTalkRequired: false,
    vadSensitivity: "medium",
    bargeInEnabled: true,
    confirmationStrictness: "medium",
    visualFeedback: "standard",
    grammarHint: "natural",
  },
  loud: {
    mode: "loud",
    displayName: "Loud venue",
    description: "Loud, with crowd noise. Push-to-talk prominent. Short commands recommended.",
    allowWakeWord: true,
    pushToTalkPreferred: true,
    pushToTalkRequired: false,
    vadSensitivity: "strict",
    bargeInEnabled: true,
    confirmationStrictness: "high",
    visualFeedback: "prominent",
    grammarHint: "short_command",
  },
  push_to_talk: {
    mode: "push_to_talk",
    displayName: "Push to talk",
    description: "No wake word, no ambient listening. Button or hardware trigger required.",
    allowWakeWord: false,
    pushToTalkPreferred: true,
    pushToTalkRequired: true,
    vadSensitivity: "off",
    bargeInEnabled: false,
    confirmationStrictness: "low",
    visualFeedback: "max",
    grammarHint: "menu_driven",
  },
};

export function getNoiseModeBehavior(mode: NoiseMode): NoiseModeBehavior {
  return NOISE_MODE_BEHAVIORS[mode];
}

export function listNoiseModeBehaviors(): NoiseModeBehavior[] {
  return Object.values(NOISE_MODE_BEHAVIORS);
}
