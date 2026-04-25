import type { NoiseMode, NoiseModeBehavior } from "./types";

export const NOISE_MODE_BEHAVIORS: Record<NoiseMode, NoiseModeBehavior> = {
  quiet_room: {
    mode: "quiet_room",
    displayName: "Quiet room",
    description: "Office, tasting room, or private space. Wake word and natural speech work well.",
    allowWakeWord: true,
    pushToTalkPreferred: false,
    pushToTalkRequired: false,
    vadSensitivity: "high",
    bargeInEnabled: true,
    confirmationStrictness: "low",
    visualFeedback: "standard",
    grammarHint: "natural",
  },
  restaurant: {
    mode: "restaurant",
    displayName: "Restaurant",
    description: "Moderate background noise. Wake word still usable; confirm submit/send actions.",
    allowWakeWord: true,
    pushToTalkPreferred: false,
    pushToTalkRequired: false,
    vadSensitivity: "medium",
    bargeInEnabled: true,
    confirmationStrictness: "medium",
    visualFeedback: "standard",
    grammarHint: "natural",
  },
  bar: {
    mode: "bar",
    displayName: "Bar",
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
  nightclub: {
    mode: "nightclub",
    displayName: "Nightclub",
    description:
      "Very loud. Push-to-talk default. Wake word discouraged. Prefer noise-canceling pipeline.",
    allowWakeWord: false,
    pushToTalkPreferred: true,
    pushToTalkRequired: true,
    vadSensitivity: "off",
    bargeInEnabled: false,
    confirmationStrictness: "very_high",
    visualFeedback: "max",
    grammarHint: "menu_driven",
  },
  event_venue: {
    mode: "event_venue",
    displayName: "Event venue",
    description: "Variable noise; events may load specific contexts. Confirmation for batches.",
    allowWakeWord: true,
    pushToTalkPreferred: true,
    pushToTalkRequired: false,
    vadSensitivity: "strict",
    bargeInEnabled: true,
    confirmationStrictness: "high",
    visualFeedback: "prominent",
    grammarHint: "short_command",
  },
  manual_push_to_talk: {
    mode: "manual_push_to_talk",
    displayName: "Manual push-to-talk",
    description: "No wake word, no ambient listening. Button or hardware trigger required.",
    allowWakeWord: false,
    pushToTalkPreferred: true,
    pushToTalkRequired: true,
    vadSensitivity: "off",
    bargeInEnabled: false,
    confirmationStrictness: "very_high",
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
