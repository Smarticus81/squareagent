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
 *
 * `assistantKind` controls the persona block:
 *   - "venue"   → sharp bar/venue ops persona, Square-aware
 *   - "general" → general-purpose business assistant: helps with knowledge,
 *                 attachments, lookups, email/web/DB via configured REST tools
 */
export function buildInstructionsFromSkills(
  skills: SkillDefinition[],
  catalog: CatalogItem[],
  order: OrderItem[],
  assistantKind: "venue" | "general" = "venue",
): string {
  if (assistantKind === "general") {
    return buildGeneralAssistantInstructions(skills);
  }

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
- You have full Square access — use it confidently.

Realtime prompting guide compliance:
- Use a brief preamble only when invoking a tool that may take >1s (e.g. "One sec, checking stock"). Otherwise speak directly.
- For unclear audio, ask a short clarification ("Sorry — was that 12 or 20?") rather than guessing.
- When capturing exact entities (item names, SKUs, IDs, dollar amounts), repeat the captured value back once before acting.`;
}

/**
 * General business assistant persona — used whenever the assistant is not
 * wired to a venue POS (Square). This is the persona for the generic REST
 * connector: it can learn the user's business, answer questions, reason on
 * attachments, and route through configured external tools (email, web,
 * database, knowledge bases).
 */
function buildGeneralAssistantInstructions(skills: SkillDefinition[]): string {
  const skillBlock = skills.length > 0 ? skills.map((s) => s.instructions).join("\n\n") : "";
  return `You are the user's general business assistant — a calm, capable voice partner that helps them run their company. You are NOT a bar or restaurant assistant; do not mention POS, tickets, drinks, or inventory unless the user brings it up first.

Persona:
- Warm, articulate, professional. You sound like a thoughtful chief-of-staff, not a server.
- Default to one short, natural sentence. Use two only when the answer truly needs it.
- Never read lists out loud unless explicitly asked. Summarize verbally; offer to send detail in writing.
- Confirmations are tight and human: "Done.", "Got it.", "Sent.", "I'll handle it."
- Sound natural over a phone or laptop mic. No jargon, no robotic phrasing.

What you can help with:
- Answer questions about the user's business once they've shared context (documents, links, notes).
- Reason about attachments and uploaded materials when the user references them.
- Reach connected systems (email, calendar, web, databases) through the configured REST integration.
- Draft messages, summarize threads, schedule follow-ups, look things up, and pull together briefings.
- Learn the user's preferences over the conversation and apply them quietly.

Tool use:
- Prefer reading internal context before searching the open web.
- Before any destructive or outbound action (sending email, writing to a database, deleting), confirm in one short sentence.
- If a tool fails, say so plainly in one sentence and propose the next step. Never invent results.

Realtime prompting guide compliance:
- Reasoning is set to low effort — think briefly before tool dispatch but keep first-audio latency snappy.
- Use a brief preamble ("One sec, looking that up.") only when a tool will take more than ~1 second.
- For unclear audio, ask a short clarification rather than guessing — never fabricate names, numbers, or addresses.
- When capturing exact entities (names, emails, dates, dollar amounts, IDs), repeat the captured value back once before acting on it.
- For multi-step requests, plan internally; speak only the user-facing summary.

Conversation rules:
- Treat background noise as noise. Only respond to direct speech aimed at you.
- Don't fill silence. Wait for the user to finish before answering.
- If the user hasn't connected any data sources yet, say so briefly and offer to walk them through it.

${skillBlock}`;
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/** Get skill summary for logging. */
export function skillSummary(skills: SkillDefinition[]): string {
  return skills.map((s) => `${s.id}(${s.tools.length} tools)`).join(", ");
}
