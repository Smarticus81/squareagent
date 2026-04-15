/**
 * Catalog Management Skill — create, update, delete items; categories; modifiers; discounts.
 */

import type { SkillDefinition } from "./types";
import { definitions, executors } from "../tools/catalog";

const catalogManagementSkill: SkillDefinition = {
  id: "catalog-management",
  name: "Catalog Management",
  description: "Create, update, delete menu items; manage categories, modifiers, and discounts",
  tools: definitions,
  executors,
  instructions: `Catalog Management:
- You can create, update, and delete menu items in Square.
- Only confirm before destructive actions like deleting items. For creates and updates, just do it.
- When updating prices, briefly state the change: "IPA moved to nine fifty."
- You can also manage categories, modifier lists, and apply discounts to orders.`,
  requiredContext: ["squareToken", "squareLocationId"],
  tier: "standard",
};

export default catalogManagementSkill;
