/**
 * Skill Registry — composable tool groups for voice agent sessions.
 *
 * Instead of loading all 43+ tools into every session, skills allow
 * selecting relevant tool groups based on venue config and subscription plan.
 */

import type { SkillDefinition, SkillTier } from "./types";
import type { ToolDefinition, ToolExecutor } from "../tools/types";
import type { CatalogItem, OrderItem } from "../lib/square-helpers";
import { PLAN_TIERS } from "./types";

import posSkill from "./pos.skill";
import inventorySkill from "./inventory.skill";
import catalogManagementSkill from "./catalog-management.skill";
import ordersReportingSkill from "./orders-reporting.skill";
import customersPaymentsSkill from "./customers-payments.skill";
import teamLaborSkill from "./team-labor.skill";

// ── All registered skills ───────────────────────────────────────────────────

export const ALL_SKILLS: SkillDefinition[] = [
  posSkill,
  inventorySkill,
  catalogManagementSkill,
  ordersReportingSkill,
  customersPaymentsSkill,
  teamLaborSkill,
];

// ── Skill selection ─────────────────────────────────────────────────────────

/**
 * Get skills available for a session based on subscription plan.
 * Returns skills whose tier is included in the plan's allowed tiers.
 */
export function getSkillsForPlan(plan: string): SkillDefinition[] {
  const allowedTiers = PLAN_TIERS[plan] ?? PLAN_TIERS.trial;
  return ALL_SKILLS.filter((skill) => allowedTiers.includes(skill.tier));
}

/**
 * Get skills for a session, optionally filtered by specific skill IDs.
 * If no skillIds provided, returns all skills for the plan.
 */
export function getSkillsForSession(
  plan: string,
  skillIds?: string[],
): SkillDefinition[] {
  const planSkills = getSkillsForPlan(plan);
  if (!skillIds || skillIds.length === 0) return planSkills;
  return planSkills.filter((s) => skillIds.includes(s.id));
}

// ── Build tools/executors/instructions from selected skills ─────────────────

/**
 * Flatten tool definitions from selected skills (deduped by name).
 */
export function buildToolsFromSkills(skills: SkillDefinition[]): ToolDefinition[] {
  const seen = new Set<string>();
  const tools: ToolDefinition[] = [];
  for (const skill of skills) {
    for (const tool of skill.tools) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        tools.push(tool);
      }
    }
  }
  return tools;
}

/**
 * Merge executor maps from selected skills (deduped by name).
 */
export function buildExecutorsFromSkills(skills: SkillDefinition[]): Record<string, ToolExecutor> {
  const executors: Record<string, ToolExecutor> = {};
  for (const skill of skills) {
    for (const [name, fn] of Object.entries(skill.executors)) {
      if (!executors[name]) executors[name] = fn;
    }
  }
  return executors;
}

/**
 * Compose a system prompt from the base persona + selected skill instructions.
 */
export function buildInstructionsFromSkills(
  skills: SkillDefinition[],
  catalog: CatalogItem[],
  order: OrderItem[],
): string {
  const catalogStr =
    catalog.length > 0
      ? catalog.map((c) => `  - ${c.name}: $${c.price.toFixed(2)}${c.category ? ` (${c.category})` : ""}`).join("\n")
      : "  (No catalog loaded — ask user to connect Square)";

  const orderStr =
    order.length > 0
      ? order.map((i) => `  - ${i.quantity}x ${i.item_name} @ $${i.price.toFixed(2)}`).join("\n")
      : "  (empty)";

  const skillInstructions = skills
    .map((s) => s.instructions)
    .join("\n\n");

  const activeSkillNames = skills.map((s) => s.name).join(", ");

  return `You are VoyceLab, the voice operating assistant for modern venues running on Square. You have access to the following capabilities: ${activeSkillNames}.

Catalog:
${catalogStr}

Current order:
${orderStr}

Persona:
- Sharp, knowledgeable, confident. You're the venue's operations brain.
- Speak like bar staff: short, punchy, no fluff. Default to one short sentence; use two only if needed.
- NEVER repeat the order back or read items back unless the user explicitly asks ("what's on the ticket", "read that back", "what do I have").
- NEVER ask "is that right?" or "sound good?" after adding items. Just do it and confirm with a few words.
- Keep confirmations ultra-tight: "Got it", "Done", "Added", "On there". Prefer 2 to 6 words.
- Understand bartender slang: "86 it" = remove/out of stock, "ring it up" / "close it out" = submit, "tab it" = add to order, "what's on the ticket" = get order.
- Understand inventory terms: "we got a case of" = add 24, "count" = check levels.

${skillInstructions}

General:
- Noisy environment — ignore background chatter. Only respond to direct speech. If unclear, ask.
- Only confirm before destructive actions (delete, refund). Everything else — just do it.
- Do not repeat back, summarize, or over-explain. Act fast and keep responses minimal.
- You have full Square access — use it confidently.`;
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/** Get skill summary for logging. */
export function skillSummary(skills: SkillDefinition[]): string {
  return skills.map((s) => `${s.id}(${s.tools.length} tools)`).join(", ");
}
