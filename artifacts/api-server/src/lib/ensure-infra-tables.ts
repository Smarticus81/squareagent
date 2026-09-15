/**
 * Boot-time schema guard for operational infrastructure tables.
 *
 * Railway deploys never run `drizzle-kit push` — schema migration is a manual
 * step (`cd lib/db && pnpm push`). Runtime plumbing and the autonomous control
 * plane are therefore created idempotently at boot. Base product/domain tables
 * still require a real migration.
 */

import { pool } from "@workspace/db";

const INFRA_TABLE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "square_oauth_states" (
    "state" text PRIMARY KEY,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
    "redirect_uri" text NOT NULL,
    "mode" text,
    "return_url" text,
    "return_origin" text,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "square_oauth_states_expires_idx" ON "square_oauth_states" ("expires_at")`,
  `CREATE TABLE IF NOT EXISTS "square_oauth_pending_tokens" (
    "claim_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
    "encrypted_token" text NOT NULL,
    "merchant_id" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE "square_oauth_pending_tokens" ADD COLUMN IF NOT EXISTS "encrypted_refresh_token" text`,
  `ALTER TABLE "square_oauth_pending_tokens" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp`,
  `CREATE INDEX IF NOT EXISTS "square_oauth_pending_user_idx" ON "square_oauth_pending_tokens" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "square_oauth_pending_expires_idx" ON "square_oauth_pending_tokens" ("expires_at")`,
  `CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
    "bucket_key" text PRIMARY KEY,
    "hit_count" integer NOT NULL DEFAULT 1,
    "window_start" timestamp NOT NULL,
    "expires_at" timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expires_idx" ON "rate_limit_buckets" ("expires_at")`,

  `CREATE TABLE IF NOT EXISTS "business_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" uuid,
    "user_id" integer,
    "visitor_id" text,
    "session_id" text,
    "event_type" text NOT NULL,
    "actor_type" text NOT NULL DEFAULT 'system',
    "actor_id" text,
    "source" text,
    "campaign" text,
    "experiment_id" uuid,
    "variant" text,
    "value_cents" integer,
    "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "dedupe_key" text,
    "occurred_at" timestamp NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "business_events_type_time_idx" ON "business_events" ("event_type","occurred_at")`,
  `CREATE INDEX IF NOT EXISTS "business_events_org_time_idx" ON "business_events" ("organization_id","occurred_at")`,
  `CREATE INDEX IF NOT EXISTS "business_events_campaign_idx" ON "business_events" ("campaign","occurred_at")`,
  `CREATE INDEX IF NOT EXISTS "business_events_visitor_idx" ON "business_events" ("visitor_id","occurred_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "business_events_dedupe_unique" ON "business_events" ("dedupe_key")`,

  `CREATE TABLE IF NOT EXISTS "autonomy_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_type" text NOT NULL,
    "trigger" text NOT NULL DEFAULT 'scheduler',
    "status" text NOT NULL DEFAULT 'running',
    "objective" text NOT NULL,
    "objective_score_before" integer,
    "objective_score_after" integer,
    "plan" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "error_message" text,
    "started_at" timestamp NOT NULL DEFAULT now(),
    "finished_at" timestamp
  )`,

  `CREATE TABLE IF NOT EXISTS "autonomous_actions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_id" uuid,
    "agent" text NOT NULL,
    "action_type" text NOT NULL,
    "risk_level" text NOT NULL DEFAULT 'low',
    "authority" text NOT NULL DEFAULT 'autonomous',
    "status" text NOT NULL DEFAULT 'planned',
    "reversible" boolean NOT NULL DEFAULT true,
    "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "output" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "expected_impact" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "actual_impact" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "external_ref" text,
    "cost_cents" integer NOT NULL DEFAULT 0,
    "approved_at" timestamp,
    "executed_at" timestamp,
    "rolled_back_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "autonomous_actions_run_idx" ON "autonomous_actions" ("run_id")`,
  `CREATE INDEX IF NOT EXISTS "autonomous_actions_agent_status_idx" ON "autonomous_actions" ("agent","status")`,
  `CREATE INDEX IF NOT EXISTS "autonomous_actions_created_idx" ON "autonomous_actions" ("created_at")`,

  `CREATE TABLE IF NOT EXISTS "experiments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL UNIQUE,
    "status" text NOT NULL DEFAULT 'draft',
    "hypothesis" text NOT NULL,
    "primary_metric" text NOT NULL,
    "variants" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "guardrails" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "allocation" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "winner" text,
    "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "started_at" timestamp,
    "ended_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "experiments_status_idx" ON "experiments" ("status")`,

  `CREATE TABLE IF NOT EXISTS "metric_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "metric_name" text NOT NULL,
    "value_milli" integer NOT NULL,
    "numerator" integer,
    "denominator" integer,
    "dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "captured_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "metric_snapshots_metric_time_idx" ON "metric_snapshots" ("metric_name","captured_at")`,

  `CREATE TABLE IF NOT EXISTS "autonomy_opportunities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "source_run_id" uuid,
    "kind" text NOT NULL,
    "status" text NOT NULL DEFAULT 'open',
    "title" text NOT NULL,
    "description" text NOT NULL,
    "priority_score" integer NOT NULL DEFAULT 0,
    "confidence_milli" integer NOT NULL DEFAULT 0,
    "estimated_impact" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "recommendation" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "effort" text NOT NULL DEFAULT 'medium',
    "risk_level" text NOT NULL DEFAULT 'low',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "autonomy_opportunities_status_score_idx" ON "autonomy_opportunities" ("status","priority_score")`,
  `CREATE INDEX IF NOT EXISTS "autonomy_opportunities_kind_idx" ON "autonomy_opportunities" ("kind")`,

  `CREATE TABLE IF NOT EXISTS "product_findings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "source_run_id" uuid,
    "fingerprint" text NOT NULL UNIQUE,
    "status" text NOT NULL DEFAULT 'open',
    "severity" text NOT NULL DEFAULT 'medium',
    "subsystem" text NOT NULL,
    "title" text NOT NULL,
    "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "baseline" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "observed" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "recommended_change" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "github_issue_url" text,
    "github_pr_url" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "product_findings_status_severity_idx" ON "product_findings" ("status","severity")`,

  `CREATE TABLE IF NOT EXISTS "prospect_leads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "company_name" text NOT NULL,
    "website" text,
    "contact_name" text,
    "contact_email" text,
    "segment" text NOT NULL,
    "stage" text NOT NULL DEFAULT 'new',
    "source" text NOT NULL DEFAULT 'autonomous_research',
    "fit_score" integer NOT NULL DEFAULT 0,
    "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "last_contacted_at" timestamp,
    "next_contact_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "prospect_leads_stage_score_idx" ON "prospect_leads" ("stage","fit_score")`,
  `CREATE INDEX IF NOT EXISTS "prospect_leads_next_contact_idx" ON "prospect_leads" ("next_contact_at")`,
];

export async function ensureInfraTables(): Promise<void> {
  if (!pool) return;
  for (const ddl of INFRA_TABLE_DDL) {
    try {
      await pool.query(ddl);
    } catch (e: any) {
      console.error(
        `[schema] Failed to ensure runtime table (run "cd lib/db && pnpm push" against this database): ${e?.message ?? e}`,
      );
      return;
    }
  }
}
