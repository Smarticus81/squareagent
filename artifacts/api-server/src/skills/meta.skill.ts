/**
 * Meta skill — conversation-control tools that should be available in every
 * realtime session regardless of plan or assistant kind.
 *
 * Currently provides `wait_for_user`, the no-op tool recommended by the
 * OpenAI Realtime 2 prompting guide for handling silence, background noise,
 * hold music, TV audio, and side conversations.
 *
 * Reference: https://developers.openai.com/api/docs/guides/realtime-models-prompting#handle-silence-and-background-audio
 */

import type { SkillDefinition } from "./types";
import type { ToolDefinition, ToolExecutor } from "../tools/types";

const waitForUserDefinition: ToolDefinition = {
  type: "function",
  name: "wait_for_user",
  description:
    "Call this when the latest audio does not need a spoken response, such as silence, background noise, hold music, TV audio, side conversation, or speech not addressed to the assistant. This tool helps end the turn without a spoken reply.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

const waitForUserExecutor: ToolExecutor = async () => {
  // No-op. The point of this tool is to give the model a valid non-speaking
  // action so it does not say "I'm here" or "I didn't catch that" when it
  // hears silence or background noise. Returning an empty result is correct.
  return { result: "" };
};

const metaSkill: SkillDefinition = {
  id: "meta",
  name: "Conversation Control",
  description:
    "Built-in conversation-control tools (wait_for_user) included in every session.",
  tools: [waitForUserDefinition],
  executors: { wait_for_user: waitForUserExecutor },
  instructions: `## Handling Silence and Background Noise

If the latest audio is silence, background noise, hold music, TV audio, side conversation, or speech not addressed to you, call \`wait_for_user\`.

- Do not respond conversationally after calling this tool.
- Do not say "I'm here", "I didn't catch that", "Take your time", or "Let me know when you're ready".
- Resume normal responses only when the user clearly addresses you or asks for help.

## Unclear Audio

- Only respond to clear audio or text aimed at you.
- If the user's audio is ambiguous, noisy, partially cut off, or unintelligible, ask one short clarification ("Sorry, could you repeat that?") instead of guessing.
- Do not repeat the same unclear-audio clarification twice in a row — if the second attempt is still unclear, call \`wait_for_user\` and let the user re-engage.
- Do not infer missing words, call tools, or capture entities from unclear audio.
- Do not provide a preamble when the audio is unclear.`,
  requiredContext: [],
  tier: "core",
};

export default metaSkill;
