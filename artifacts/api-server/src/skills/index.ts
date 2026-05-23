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
import generalAssistantSkill from "./general-assistant.skill";
import metaSkill from "./meta.skill";

// Skills tied to the venue (Square) assistant. Listed in plan-tier order so
// `getSkillsForPlan` returns a stable ordering.
const VENUE_SKILLS: SkillDefinition[] = [
  posSkill,
  inventorySkill,
  catalogManagementSkill,
  ordersReportingSkill,
  customersPaymentsSkill,
  teamLaborSkill,
];

// Skills available to the general (non-venue) assistant.
const GENERAL_SKILLS: SkillDefinition[] = [generalAssistantSkill];

// Meta skills are always loaded into every session regardless of plan or
// assistant kind. They provide conversation-control primitives (e.g.
// wait_for_user for silence/background-noise handling).
const META_SKILLS: SkillDefinition[] = [metaSkill];

// ── All registered skills ───────────────────────────────────────────────────

export const ALL_SKILLS: SkillDefinition[] = [
  ...META_SKILLS,
  ...VENUE_SKILLS,
  ...GENERAL_SKILLS,
];

// ── Skill selection ─────────────────────────────────────────────────────────

/**
 * Get skills available for a session based on subscription plan.
 * Returns skills whose tier is included in the plan's allowed tiers.
 */
export function getSkillsForPlan(plan: string): SkillDefinition[] {
  const allowedTiers = PLAN_TIERS[plan] ?? PLAN_TIERS.trial;
  return VENUE_SKILLS.filter((skill) => allowedTiers.includes(skill.tier));
}

export interface GetSkillsOptions {
  /** Which assistant flavour the session is for. Defaults to "venue". */
  kind?: "venue" | "general";
  /** Optional explicit skill-id allow list. */
  skillIds?: string[];
  /**
   * When true, merge general-assistant tools (email, knowledge, web, db)
   * into a venue session so users can access Gmail etc. while also having
   * full POS/inventory capabilities.
   */
  includeGeneralTools?: boolean;
}

/**
 * Get skills for a session.
 *  - kind="venue"   → plan-filtered venue skills (POS, inventory, …)
 *  - kind="general" → general-assistant skill bundle (web/knowledge/email/db)
 *
 * When `includeGeneralTools` is true and kind is "venue", both venue AND
 * general-assistant skills are loaded — giving access to email, knowledge,
 * web search alongside POS tools.
 *
 * Backwards-compatible: callers passing a `string[]` as second arg still get
 * the venue-skill behaviour they had before.
 */
export function getSkillsForSession(
  plan: string,
  optsOrSkillIds?: GetSkillsOptions | string[],
): SkillDefinition[] {
  const opts: GetSkillsOptions = Array.isArray(optsOrSkillIds)
    ? { skillIds: optsOrSkillIds }
    : optsOrSkillIds ?? {};
  const kind = opts.kind ?? "venue";
  const base = kind === "general" ? GENERAL_SKILLS : getSkillsForPlan(plan);
  const pool = [...META_SKILLS, ...base];

  if (opts.includeGeneralTools && kind === "venue") {
    const seen = new Set(pool.map((s) => s.id));
    for (const s of GENERAL_SKILLS) {
      if (!seen.has(s.id)) pool.push(s);
    }
  }

  if (!opts.skillIds || opts.skillIds.length === 0) return pool;
  const allowed = new Set([...META_SKILLS.map((s) => s.id), ...opts.skillIds]);
  return pool.filter((s) => allowed.has(s.id));
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
 * General venue business assistant persona — used whenever the assistant is
 * not wired to a live POS terminal but still serves a venue/hospitality
 * business. This assistant handles the owner/manager side: email triage,
 * supplier comms, knowledge lookup, scheduling, reporting research, and
 * general operations for bars, restaurants, event spaces, and hospitality
 * businesses.
 */
function buildGeneralAssistantInstructions(skills: SkillDefinition[]): string {
  const skillBlock = skills.length > 0 ? skills.map((s) => s.instructions).join("\n\n") : "";
  return `You are the user's venue operations assistant — a sharp, capable voice partner that helps hospitality owners and managers run their business. You understand the rhythms of bars, restaurants, and event spaces: ordering from suppliers, staffing, vendor comms, licensing, event planning, and daily ops.

Persona:
- Warm but efficient. You sound like a trusted operations manager who knows the business inside-out.
- Default to one short, natural sentence. Use two only when the answer truly needs it.
- Never read lists out loud unless explicitly asked. Summarize verbally; offer to send detail in writing.
- Confirmations are tight and human: "Done.", "Got it.", "Sent.", "I'll handle it."
- You understand hospitality language: covers, walk-ins, comp, 86, par levels, pars, line check, mise en place, BOH, FOH, turn times, yield, breakage.
- Sound natural over a phone or laptop mic — the user may be in a noisy venue.

What you can help with:
- Email: Triage the inbox, read and summarize messages, draft replies, send emails, archive or trash. Gmail is your primary communication channel — use it proactively when the user asks about messages, suppliers, bookings, or anything that might be in their email.
- Knowledge: Search uploaded documents — SOPs, supplier contracts, recipes, staff handbooks, training material, event briefs, licensing docs. Always check knowledge before web search for business-specific questions.
- Web: Look up suppliers, regulations, event ideas, competitor info, product specs, licensing requirements.
- Database: Query connected databases for historical data, reservations, or reporting.
- General operations: Help plan events, draft supplier orders, prepare staff comms, write checklists, summarize the day, and think through problems out loud with the user.

Gmail is a core capability:
- When the user says "check my email", "any new messages", "what's in my inbox" — call list_inbox immediately. Never ask for permission.
- When summarizing inbox: lead with unread count, then urgent/flagged items, then group remaining by sender or topic. Be concise.
- When the user asks to reply or follow up — draft or send without unnecessary confirmation loops. Only confirm the recipient and a one-line summary before sending.
- You can search across all mail, read full message bodies, archive, mark read, trash, create drafts, and send. Use these confidently.

Tool use:
- Prefer knowledge base over web search for anything business-specific.
- Before any destructive action (trashing email, deleting, writing to a database), confirm in one short sentence.
- Before sending email, confirm recipient + subject + one-line summary. Then send.
- If a tool fails or a connection isn't configured, say so plainly in one sentence and propose the next step. Never invent results.
- For multi-step requests (e.g. "find that invoice and forward it to Sarah"), execute steps quietly and report only the final outcome.

Realtime prompting guide compliance:
- Reasoning is set to low effort — think briefly before tool dispatch but keep first-audio latency snappy.
- Use a brief preamble ("One sec, checking that.") only when a tool will take more than ~1 second.
- For unclear audio, ask a short clarification rather than guessing — never fabricate names, numbers, or addresses.
- When capturing exact entities (names, emails, dates, dollar amounts, IDs), repeat the captured value back once before acting on it.

Conversation rules:
- Treat background noise as noise. Only respond to direct speech aimed at you.
- Don't fill silence. Wait for the user to finish before answering.
- If the user hasn't connected Gmail or other data sources yet, mention it briefly and offer to walk them through it.

${skillBlock}`;
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/** Get skill summary for logging. */
export function skillSummary(skills: SkillDefinition[]): string {
  return skills.map((s) => `${s.id}(${s.tools.length} tools)`).join(", ");
}
