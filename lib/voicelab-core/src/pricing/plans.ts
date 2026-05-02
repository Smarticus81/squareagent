import type { VoicePipelineProvider } from "../voice-pipeline/types";

/**
 * VoyceLab pricing — single source of truth used by:
 *   - Stripe checkout (price-id lookup)
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
 * Underlying voice cost (gpt-realtime-mini and Gemini Flash Live native
 * audio): ~$0.04 per spoken minute on average. Margins below assume 60%
 * inclusion of plan minutes get used in a typical month.
 */

export type PlanId = "trial" | "starter" | "professional" | "premium" | "enterprise";

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
  /** Stripe price-id env var name (server reads `process.env[stripeEnvVar]`). */
  stripeMonthlyPriceEnvVar?: string;
  stripeYearlyPriceEnvVar?: string;
}

const PIPELINES_FALLBACK: VoicePipelineProvider[] = [
  "browser_speech_api_fallback",
  "push_to_talk_text_fallback",
  "text_only_fallback",
];

const PIPELINES_STARTER: VoicePipelineProvider[] = [
  "openai_realtime_webrtc",
  "openai_realtime_server_ws",
  ...PIPELINES_FALLBACK,
];

const PIPELINES_PROFESSIONAL: VoicePipelineProvider[] = [
  ...PIPELINES_STARTER,
  "google_gemini_3_1_flash_live",
  "google_gemini_2_5_flash_native_audio",
  "google_gemini_live_native_audio",
];

const PIPELINES_PREMIUM: VoicePipelineProvider[] = [
  ...PIPELINES_PROFESSIONAL,
  "elevenlabs_agents",
  "deepgram_voice_agent_api",
  "livekit_agents",
  "pipecat",
  "deepgram_flux_cartesia",
  "deepgram_flux_aura",
  "cartesia_ink_sonic",
  "assemblyai_openai_cartesia",
  "custom_modular_pipeline",
  "hume_evi_3",
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
    maxAssistants: 3,
    includedVoiceMinutes: 200,
    overagePerMinuteUsd: 0,
    skillTiers: ["core", "standard", "premium"],
    allowedPipelines: PIPELINES_PREMIUM,
    cta: "Start free trial",
    bullets: [
      { text: "Every feature unlocked for 14 days" },
      { text: "200 voice minutes" },
      { text: "Build, test, and demo with your team" },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Single bar, simple ops, real voice ordering.",
    monthlyPriceUsd: 79,
    yearlyPriceUsdPerMonth: 65,
    maxVenues: 1,
    maxAssistants: 2,
    includedVoiceMinutes: 500,
    overagePerMinuteUsd: 0.18,
    skillTiers: ["core"],
    allowedPipelines: PIPELINES_STARTER,
    cta: "Pick Starter",
    stripeMonthlyPriceEnvVar: "STRIPE_PRICE_STARTER_MONTHLY",
    stripeYearlyPriceEnvVar: "STRIPE_PRICE_STARTER_YEARLY",
    bullets: [
      { text: "1 venue, 2 voice assistants" },
      { text: "500 voice minutes / month included" },
      { text: "OpenAI Realtime (WebRTC + WebSocket)" },
      { text: "POS, orders, reporting" },
      { text: "Email support" },
    ],
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "Multi-venue groups that need inventory + Gemini-class voice.",
    monthlyPriceUsd: 199,
    yearlyPriceUsdPerMonth: 165,
    highlighted: true,
    ribbon: "Most popular",
    maxVenues: 3,
    maxAssistants: 10,
    includedVoiceMinutes: 2000,
    overagePerMinuteUsd: 0.15,
    skillTiers: ["core", "standard"],
    allowedPipelines: PIPELINES_PROFESSIONAL,
    cta: "Pick Professional",
    stripeMonthlyPriceEnvVar: "STRIPE_PRICE_PROFESSIONAL_MONTHLY",
    stripeYearlyPriceEnvVar: "STRIPE_PRICE_PROFESSIONAL_YEARLY",
    bullets: [
      { text: "Up to 3 venues, 10 assistants" },
      { text: "2,000 voice minutes / month included" },
      {
        text: "OpenAI Realtime + Gemini 3.1 Flash Live + Gemini 2.5 Native Audio",
        emphasis: true,
      },
      { text: "Inventory, catalog management, customers & payments" },
      { text: "Priority email + chat support" },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    tagline: "Hospitality groups and event venues. Every voice engine, every skill.",
    monthlyPriceUsd: 499,
    yearlyPriceUsdPerMonth: 415,
    maxVenues: -1,
    maxAssistants: -1,
    includedVoiceMinutes: 10000,
    overagePerMinuteUsd: 0.12,
    skillTiers: ["core", "standard", "premium"],
    allowedPipelines: PIPELINES_PREMIUM,
    cta: "Pick Premium",
    stripeMonthlyPriceEnvVar: "STRIPE_PRICE_PREMIUM_MONTHLY",
    stripeYearlyPriceEnvVar: "STRIPE_PRICE_PREMIUM_YEARLY",
    bullets: [
      { text: "Unlimited venues and assistants" },
      { text: "10,000 voice minutes / month included" },
      { text: "Every voice engine: ElevenLabs, Deepgram, LiveKit, Hume, modular cascaded", emphasis: true },
      { text: "Team & labor: shifts, clock-in, who's on the floor right now" },
      { text: "24/7 chat + dedicated customer success" },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom relay, audit trails, SSO, on-prem. Talk to us.",
    monthlyPriceUsd: 0,
    yearlyPriceUsdPerMonth: 0,
    maxVenues: -1,
    maxAssistants: -1,
    includedVoiceMinutes: -1,
    overagePerMinuteUsd: 0,
    skillTiers: ["core", "standard", "premium"],
    allowedPipelines: PIPELINES_PREMIUM,
    cta: "Contact sales",
    bullets: [
      { text: "Custom voice minutes + dedicated relay region" },
      { text: "SOC2-aligned audit logs to your S3 bucket" },
      { text: "SSO, SCIM, IP allowlist" },
      { text: "On-prem or VPC-isolated deployment" },
      { text: "SLA + named CS lead" },
    ],
  },
];

export function getPlan(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}

/**
 * Returns the resolved skill tiers for a plan.
 * Backwards compatible with the legacy plan ids ("pos_only",
 * "inventory_only", "complete") still present in the database.
 */
export function getPlanSkillTiers(planId: string | null | undefined): SkillTier[] {
  if (!planId) return ["core", "standard", "premium"];
  const direct = PLANS.find((p) => p.id === planId);
  if (direct) return direct.skillTiers;
  switch (planId) {
    case "pos_only":
      return ["core"];
    case "inventory_only":
      return ["core", "standard"];
    case "complete":
      return ["core", "standard", "premium"];
    default:
      return ["core", "standard", "premium"];
  }
}

/**
 * Returns the voice pipelines a plan is allowed to choose. Used by the
 * agent-profile route to gate provider selection.
 */
export function getPlanAllowedPipelines(
  planId: string | null | undefined,
): VoicePipelineProvider[] {
  if (!planId) return PIPELINES_PREMIUM;
  const direct = PLANS.find((p) => p.id === planId);
  if (direct) return direct.allowedPipelines;
  switch (planId) {
    case "pos_only":
      return PIPELINES_STARTER;
    case "inventory_only":
      return PIPELINES_PROFESSIONAL;
    case "complete":
      return PIPELINES_PREMIUM;
    default:
      return PIPELINES_PREMIUM;
  }
}

export function planAllowsPipeline(
  planId: string | null | undefined,
  provider: VoicePipelineProvider,
): boolean {
  return getPlanAllowedPipelines(planId).includes(provider);
}
