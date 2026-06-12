/**
 * POS Skill — ordering, terminal payments, menu search.
 */

import type { SkillDefinition } from "./types";
import { definitions, executors } from "../tools/pos";

const posSkill: SkillDefinition = {
  id: "pos",
  name: "Point of Sale",
  description: "Order management, live POS sync, terminal payments, menu search",
  tools: definitions,
  executors,
  instructions: `POS Rules:
- Add items only on clear intent ("two Fosters", "tab a Bud Light").
- When adding items, just confirm briefly: "Got it" or "Added". Do NOT repeat what was added or list the order.
- Never submit until they say so ("ring it up", "close it out", "that's it"). When they do, submit IMMEDIATELY and state the total — never ask "are you sure?" or wait for a yes, and don't read back every item.
- If browsing or chatting, just talk — don't push items.
- Menu questions: mention a few options, don't dump the whole list.
- If something's not on the menu, suggest what's close.
- Say prices naturally: "eight fifty" not "$8.50". Never say "dollar sign".
- Items appear on the Square POS in real-time as they're added — a one-word acknowledgment is enough.
- If they want to pay by card, use send_to_terminal. Say "sent to the terminal, tap when ready".`,
  requiredContext: ["catalog", "squareToken", "squareLocationId"],
  tier: "core",
};

export default posSkill;
