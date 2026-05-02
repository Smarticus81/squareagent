/**
 * Skill types — composable tool groups for voice agent sessions.
 *
 * A skill bundles related tools with context-aware instructions
 * and subscription tier gating.
 */

import type { ToolDefinition, ToolExecutor } from "../tools/types";

export type SkillTier = "core" | "standard" | "premium";

export type RequiredContext = "catalog" | "squareToken" | "squareLocationId";

export interface SkillDefinition {
  /** Unique skill identifier (e.g. "pos", "inventory"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description for logging/admin. */
  description: string;
  /** Tool definitions this skill provides. */
  tools: ToolDefinition[];
  /** Executor map for this skill's tools. */
  executors: Record<string, ToolExecutor>;
  /** System prompt segment for this skill's capabilities. */
  instructions: string;
  /** Context fields required for this skill to function. */
  requiredContext: RequiredContext[];
  /** Subscription tier required to use this skill. */
  tier: SkillTier;
}

/**
 * Subscription plan -> which tiers are included.
 *
 * Source of truth lives in @workspace/voicelab-core/pricing — this map is a
 * runtime-friendly snapshot for skills selection. The canonical mapping
 * (and the pipeline allowlist) is `getPlanSkillTiers` /
 * `getPlanAllowedPipelines` from the pricing module. Legacy plan ids are
 * kept here so existing subscriptions keep resolving correctly.
 */
export const PLAN_TIERS: Record<string, SkillTier[]> = {
  trial:          ["core", "standard", "premium"],
  starter:        ["core"],
  professional:   ["core", "standard"],
  premium:        ["core", "standard", "premium"],
  enterprise:     ["core", "standard", "premium"],
  pos_only:       ["core"],
  inventory_only: ["core", "standard"],
  complete:       ["core", "standard", "premium"],
};
