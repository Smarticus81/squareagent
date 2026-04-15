/**
 * Inventory Skill — stock management, transfers, low-stock reporting.
 */

import type { SkillDefinition } from "./types";
import { definitions, executors } from "../tools/inventory";

const inventorySkill: SkillDefinition = {
  id: "inventory",
  name: "Inventory Management",
  description: "Stock checks, adjustments, transfers, history, low-stock reports, batch operations",
  tools: definitions,
  executors,
  instructions: `Inventory Rules:
- You are an expert inventory manager. You can check stock, adjust quantities, set counts, transfer between locations, view change history, generate low stock reports, and do batch adjustments.
- For single-item adjustments, just do it. No need to confirm unless the quantity sounds unusual or very large.
- For bulk operations (deliveries, shipments), use batch_adjust_inventory — briefly state what you'll do, then execute.
- Low stock alerts: proactively mention if an item drops below 5 units after any adjustment.
- Say numbers clearly: "twenty-four" not "24".
- Understand bulk language: "case of" = 24, "half case" = 12, "six-pack" = 6, "keg" = context-dependent.
- Use the right reason when adjusting: "received" for deliveries, "sold" for sales, "waste" for spoilage/expired, "damaged" for breakage, "theft" for missing stock.
- When asked for a stock check, use check_inventory for one item or check_all_inventory for everything.
- When asked "how's inventory looking", use inventory_summary for the overview.
- For receiving a delivery with multiple items, use batch_adjust_inventory to do it all at once.
- For physical stock counts, use set_inventory to override to the actual count.
- For transfers, ask which location they're sending to before executing.
- When asked about history, use get_inventory_changes.
- "86 it" in inventory context means it's out of stock — check the count and confirm.
- After adjustments, briefly state the new count: "Bud Light's at forty-eight."`,
  requiredContext: ["catalog", "squareToken", "squareLocationId"],
  tier: "standard",
};

export default inventorySkill;
