import { pgTable, text, timestamp, integer, index, jsonb, boolean, uuid, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Autonomous business control-plane tables.
 *
 * These tables intentionally keep organization/user references as scalar ids
 * instead of database FKs. Business events can exist before signup and the
 * control plane must remain able to ingest anonymous acquisition telemetry.
 */

export const businessEventsTable = pgTable("business_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id"),
  userId: integer("user_id"),
  visitorId: text("visitor_id"),
  sessionId: text("session_id"),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull().default("system"),
  actorId: text("actor_id"),
  source: text("source"),
  campaign: text("campaign"),
  experimentId: uuid("experiment_id"),
  variant: text("variant"),
  valueCents: integer("value_cents"),
  properties: jsonb("properties").notNull().default({}),
  dedupeKey: text("dedupe_key"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("business_events_type_time_idx").on(table.eventType, table.occurredAt),
  index("business_events_org_time_idx").on(table.organizationId, table.occurredAt),
  index("business_events_campaign_idx").on(table.campaign, table.occurredAt),
  index("business_events_visitor_idx").on(table.visitorId, table.occurredAt),
  uniqueIndex("business_events_dedupe_unique").on(table.dedupeKey),
]);

export const autonomyRunsTable = pgTable("autonomy_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runType: text("run_type").notNull(), // strategy | growth | activation | product | support | finance | evaluator
  trigger: text("trigger").notNull().default("scheduler"),
  status: text("status").notNull().default("running"),
  objective: text("objective").notNull(),
  objectiveScoreBefore: integer("objective_score_before"),
  objectiveScoreAfter: integer("objective_score_after"),
  plan: jsonb("plan").notNull().default({}),
  result: jsonb("result").notNull().default({}),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export const autonomousActionsTable = pgTable("autonomous_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id"),
  agent: text("agent").notNull(),
  actionType: text("action_type").notNull(),
  riskLevel: text("risk_level").notNull().default("low"),
  authority: text("authority").notNull().default("autonomous"),
  status: text("status").notNull().default("planned"),
  reversible: boolean("reversible").notNull().default(true),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  expectedImpact: jsonb("expected_impact").notNull().default({}),
  actualImpact: jsonb("actual_impact").notNull().default({}),
  externalRef: text("external_ref"),
  costCents: integer("cost_cents").notNull().default(0),
  approvedAt: timestamp("approved_at"),
  executedAt: timestamp("executed_at"),
  rolledBackAt: timestamp("rolled_back_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("autonomous_actions_run_idx").on(table.runId),
  index("autonomous_actions_agent_status_idx").on(table.agent, table.status),
  index("autonomous_actions_created_idx").on(table.createdAt),
]);

export const experimentsTable = pgTable("experiments", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("draft"),
  hypothesis: text("hypothesis").notNull(),
  primaryMetric: text("primary_metric").notNull(),
  variants: jsonb("variants").notNull().default([]),
  guardrails: jsonb("guardrails").notNull().default([]),
  allocation: jsonb("allocation").notNull().default({}),
  winner: text("winner"),
  result: jsonb("result").notNull().default({}),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("experiments_slug_unique").on(table.slug),
  index("experiments_status_idx").on(table.status),
]);

export const metricSnapshotsTable = pgTable("metric_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  metricName: text("metric_name").notNull(),
  valueMilli: integer("value_milli").notNull(),
  numerator: integer("numerator"),
  denominator: integer("denominator"),
  dimensions: jsonb("dimensions").notNull().default({}),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (table) => [
  index("metric_snapshots_metric_time_idx").on(table.metricName, table.capturedAt),
]);

export const opportunitiesTable = pgTable("autonomy_opportunities", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceRunId: uuid("source_run_id"),
  kind: text("kind").notNull(), // growth | activation | product | retention | pricing | reliability
  status: text("status").notNull().default("open"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priorityScore: integer("priority_score").notNull().default(0),
  confidenceMilli: integer("confidence_milli").notNull().default(0),
  estimatedImpact: jsonb("estimated_impact").notNull().default({}),
  evidence: jsonb("evidence").notNull().default([]),
  recommendation: jsonb("recommendation").notNull().default({}),
  effort: text("effort").notNull().default("medium"),
  riskLevel: text("risk_level").notNull().default("low"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("autonomy_opportunities_status_score_idx").on(table.status, table.priorityScore),
  index("autonomy_opportunities_kind_idx").on(table.kind),
]);

export const productFindingsTable = pgTable("product_findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceRunId: uuid("source_run_id"),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull().default("open"),
  severity: text("severity").notNull().default("medium"),
  subsystem: text("subsystem").notNull(),
  title: text("title").notNull(),
  evidence: jsonb("evidence").notNull().default([]),
  baseline: jsonb("baseline").notNull().default({}),
  observed: jsonb("observed").notNull().default({}),
  recommendedChange: jsonb("recommended_change").notNull().default({}),
  githubIssueUrl: text("github_issue_url"),
  githubPrUrl: text("github_pr_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("product_findings_fingerprint_unique").on(table.fingerprint),
  index("product_findings_status_severity_idx").on(table.status, table.severity),
]);

export const prospectLeadsTable = pgTable("prospect_leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyName: text("company_name").notNull(),
  website: text("website"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  segment: text("segment").notNull(),
  stage: text("stage").notNull().default("new"),
  source: text("source").notNull().default("autonomous_research"),
  fitScore: integer("fit_score").notNull().default(0),
  evidence: jsonb("evidence").notNull().default([]),
  profile: jsonb("profile").notNull().default({}),
  lastContactedAt: timestamp("last_contacted_at"),
  nextContactAt: timestamp("next_contact_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("prospect_leads_stage_score_idx").on(table.stage, table.fitScore),
  index("prospect_leads_next_contact_idx").on(table.nextContactAt),
]);

export type BusinessEventRow = typeof businessEventsTable.$inferSelect;
export type AutonomyRunRow = typeof autonomyRunsTable.$inferSelect;
export type AutonomousActionRow = typeof autonomousActionsTable.$inferSelect;
export type ExperimentRow = typeof experimentsTable.$inferSelect;
export type MetricSnapshotRow = typeof metricSnapshotsTable.$inferSelect;
export type OpportunityRow = typeof opportunitiesTable.$inferSelect;
export type ProductFindingRow = typeof productFindingsTable.$inferSelect;
export type ProspectLeadRow = typeof prospectLeadsTable.$inferSelect;
