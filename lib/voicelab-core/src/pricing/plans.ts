import type { VoicePipelineProvider } from "../voice-pipeline/types";

/**
 * VoyceLab pricing — single source of truth used by:
 *   - Clerk Billing checkout (plan-id lookup)
 *   - Wizard / pricing page (display)
 *   - API gating (which voice pipelines a plan can pick at agent creation)
 *   - Subscription tier-> skill mapping (in api-server/src/skills/types.ts)
 *
 * Pricing target: a busy bar or restaurant gets material time savings vs.
 * paying a manager to chase POS reports. Bar managers earn $20-$35/hr; if
 * VoyceLab saves 4 hours/week, that's >$320/mo of value at the low end.
 * Premium tiers are priced for multi-venue groups, where the platform
 * replaces full-time night-of-event coordinators.
 *
 * Underlying voice cost (verified against provider price sheets):
 *   - Gemini 3.1 Flash Live / 2.5 Native Audio: ~$0.005/min audio in +
 *     ~$0.018/min audio out => ~$0.01 per conversation-minute.
 *   - OpenAI gpt-realtime: ~$0.06/min in / ~$0.24/min out => ~$0.10-0.14
 *     per command-style conversation-minute with cached input.
 *   Blended across the engine mix: ~$0.03-0.06 per spoken minute.
 *
 * Sizing basis: a single busy venue uses 15-30 spoken minutes/day
 * (~450-900 min/month). Included minutes must cover normal full-shift use
 * of every venue on the plan without touching overage; overage exists for
 * spikes, and the 1.5x hard cap is an abuse guard, not a normal ceiling.
 */

export type PlanId = "trial" | "pro" | "business";

/** Map legacy plan names to the new plan they should resolve to. */
const LEGACY_PLAN_MAP: Record<string, PlanId> = {
  starter: "pro",
  professional: "pro",
  premium: "business",
  enterprise: "business",
};

export type SkillTier = "core" | "standard" | "premium";

export interface PlanFeatureBullet {
  /** One-line feature description shown in pricing card. */
  text: string;
  /** Optional emphasis flag — bold this bullet on the card. */
  emphasis?: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  /** Display name on the pricing page. */
  name: string;
  /** Short tagline below the price. */
  tagline: string;
  /** Monthly price in USD. 0 means free trial / contact sales. */
  monthlyPriceUsd: number;
  /** Yearly price in USD per month (display the savings). */
  yearlyPriceUsdPerMonth: number;
  /** Set true for the visually highlighted card. */
  highlighted?: boolean;
  /** Trial length in days (only applies to `trial`). */
  trialDays?: number;
  /** Number of venues the plan can manage. -1 = unlimited. */
  maxVenues: number;
  /** Number of assistants per organization. -1 = unlimited. */
  maxAssistants: number;
  /** Voice minutes included per month. -1 = custom. */
  includedVoiceMinutes: number;
  /** Overage rate per minute beyond the cap. */
  overagePerMinuteUsd: number;
  /** Skill tiers the plan unlocks. */
  skillTiers: SkillTier[];
  /** Voice pipelines the plan can pick when creating an assistant. */
  allowedPipelines: VoicePipelineProvider[];
  /** Friendly bullets shown on the pricing card. */
  bullets: PlanFeatureBullet[];
  /** "Most popular" / "Best value" / etc. ribbon. */
  ribbon?: string;
  /** CTA shown on the card. */
  cta: string;
  /** Clerk Billing plan-id env var name (server reads `process.env[clerkPlanEnvVar]`). */
  clerkPlanEnvVar?: string;
}

const PIPELINES_FALLBACK: VoicePipelineProvider[] = [
  "browser_speech_api_fallback",
  "push_to_talk_text_fallback",
  "text_only_fallback",
];

const PIPELINES_TRIAL: VoicePipelineProvider[] = [
  "openai_realtime_webrtc",
  ...PIPELINES_FALLBACK,
];

const PIPELINES_PAID: VoicePipelineProvider[] = [
  "openai_realtime_webrtc",
  "openai_realtime_server_ws",
  "google_gemini_3_1_flash_live",
  "google_gemini_2_5_flash_native_audio",
  ...PIPELINES_FALLBACK,
];

export const PLANS: PlanDefinition[] = [
  {
    id: "trial",
    name: "Free trial",
    tagline: "Hands-on, no card required.",
    monthlyPriceUsd: 0,
    yearlyPriceUsdPerMonth: 0,
    trialDays: 14,
    maxVenues: 1,
    maxAssistants: 1,
    includedVoiceMinutes: 100,
    overagePerMinuteUsd: 0,
    skillTiers: ["core"],
    allowedPipelines: PIPELINES_TRIAL,
    cta: "Start free trial",
    bullets: [
      { text: "1 venue, 1 assistant" },
      { text: "100 voice minutes for 14 days" },
      { text: "POS, orders, and reporting" },
      { text: "Build, test, and demo with your team" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Multi-venue teams that need every skill and Gemini-class voice.",
    monthlyPriceUsd: 149,
    yearlyPriceUsdPerMonth: 125,
    highlighted: true,
    ribbon: "Most popular",
    maxVenues: 3,
    maxAssistants: 10,
    includedVoiceMinutes: 1500,
    overagePerMinuteUsd: 0.15,
    skillTiers: ["core", "standard", "premium"],
    allowedPipelines: PIPELINES_PAID,
    cta: "Pick Pro",
    clerkPlanEnvVar: "CLERK_PLAN_PRO_ID",
    bullets: [
      { text: "Up to 3 venues, 10 assistants" },
      { text: "1,500 voice minutes / month included" },
      {
        text: "OpenAI Realtime + Gemini 3.1 Flash Live + Gemini 2.5 Native Audio",
        emphasis: true,
      },
      { text: "Every skill: POS, inventory, catalog, customers, payments, team & labor" },
      { text: "Overage billed at $0.15/min — assistants never hard-stop mid-shift" },
      { text: "Priority email + chat support" },
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "Hospitality groups and event venues. Unlimited scale.",
    monthlyPriceUsd: 399,
    yearlyPriceUsdPerMonth: 335,
    maxVenues: -1,
    maxAssistants: -1,
    includedVoiceMinutes: 6000,
    overagePerMinuteUsd: 0.1,
    skillTiers: ["core", "standard", "premium"],
    allowedPipelines: PIPELINES_PAID,
    cta: "Pick Business",
    clerkPlanEnvVar: "CLERK_PLAN_BUSINESS_ID",
    bullets: [
      { text: "Unlimited venues and assistants" },
      { text: "6,000 voice minutes / month included" },
      { text: "Every skill and every voice engine", emphasis: true },
      { text: "Team & labor: shifts, clock-in, who's on the floor right now" },
      { text: "Overage billed at $0.10/min — assistants never hard-stop mid-shift" },
      { text: "24/7 chat + dedicated customer success" },
    ],
  },
];

/** Resolve a plan id, mapping legacy names to their new equivalents. */
function resolvePlanId(id: string | null | undefined): PlanId {
  if (!id) return "trial";
  const direct = PLANS.find((p) => p.id === id);
  if (direct) return direct.id;
  const mapped = LEGACY_PLAN_MAP[id];
  if (mapped) return mapped;
  return "trial";
}

export function getPlan(id: string): PlanDefinition | undefined {
  const resolved = resolvePlanId(id);
  return PLANS.find((p) => p.id === resolved);
}

/** Returns the resolved skill tiers for a plan. Falls back to business tiers for unknown ids. */
export function getPlanSkillTiers(planId: string | null | undefined): SkillTier[] {
  if (planId === "admin") return ["core", "standard", "premium"];
  if (!planId) return ["core", "standard", "premium"];
  const plan = getPlan(planId);
  if (plan) return plan.skillTiers;
  return ["core", "standard", "premium"];
}

/**
 * Returns the voice pipelines a plan is allowed to choose. Used by the
 * agent-profile route to gate provider selection.
 */
export function getPlanAllowedPipelines(
  planId: string | null | undefined,
): VoicePipelineProvider[] {
  if (planId === "admin") return PIPELINES_PAID;
  if (!planId) return PIPELINES_PAID;
  const plan = getPlan(planId);
  if (plan) return plan.allowedPipelines;
  return PIPELINES_PAID;
}

export function planAllowsPipeline(
  planId: string | null | undefined,
  provider: VoicePipelineProvider,
): boolean {
  return getPlanAllowedPipelines(planId).includes(provider);
}

export type UsageRisk = "ok" | "watch" | "over_included" | "near_cap" | "blocked";

function getPlanIncludedMinutes(planId: string | null | undefined): number {
  if (planId === "admin") return -1;
  return getPlan(planId ?? "trial")?.includedVoiceMinutes ?? getPlan("trial")?.includedVoiceMinutes ?? 60;
}

export interface UsageLimitSnapshot {
  includedMinutes: number;
  hardCapMinutes: number;
  includedPercent: number;
  hardCapPercent: number;
  overIncluded: boolean;
  overIncludedMinutes: number;
  remainingIncludedMinutes: number;
  remainingToHardCapMinutes: number;
  risk: UsageRisk;
}

export function buildUsageLimitSnapshot(planId: string | null | undefined, used: number): UsageLimitSnapshot {
  const included = getPlanIncludedMinutes(planId);
  const unlimited = included === -1;
  const hardCap = unlimited ? -1 : Math.floor(included * 1.5);
  const includedPercent = unlimited || included <= 0 ? 0 : Math.round((used / included) * 100);
  const hardCapPercent = unlimited || hardCap <= 0 ? 0 : Math.round((used / hardCap) * 100);
  const overIncluded = !unlimited && used > included;
  const blocked = !unlimited && used >= hardCap;
  const nearCap = !unlimited && !blocked && used >= hardCap * 0.9;
  const watch = !unlimited && !overIncluded && used >= included * 0.8;
  const risk: UsageRisk = blocked
    ? "blocked"
    : nearCap
    ? "near_cap"
    : overIncluded
    ? "over_included"
    : watch
    ? "watch"
    : "ok";

  return {
    includedMinutes: included,
    hardCapMinutes: hardCap,
    includedPercent,
    hardCapPercent,
    overIncluded,
    overIncludedMinutes: overIncluded ? Math.max(0, used - included) : 0,
    remainingIncludedMinutes: unlimited ? -1 : Math.max(0, included - used),
    remainingToHardCapMinutes: unlimited ? -1 : Math.max(0, hardCap - used),
    risk,
  };
}

