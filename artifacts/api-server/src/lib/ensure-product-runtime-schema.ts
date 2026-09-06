import { pool } from "@workspace/db";

/** Keep production-compatible columns required by durable voice metering present.
 * Railway does not run drizzle-kit push automatically, so additive, nullable/defaulted
 * runtime columns are repaired idempotently at boot.
 */
export async function ensureProductRuntimeSchema(): Promise<void> {
  if (!pool) return;
  const ddl = [
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "metered_duration_ms" integer NOT NULL DEFAULT 0`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "ended_at" timestamp`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "finalized_duration_ms" integer`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "pipeline_provider" text`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "agent_profile_id" uuid`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "venue_id" integer`,
    `CREATE INDEX IF NOT EXISTS "voice_sessions_finalized_idx" ON "voice_sessions" ("finalized_at")`,
    `CREATE INDEX IF NOT EXISTS "voice_sessions_stale_heartbeat_idx" ON "voice_sessions" ("last_heartbeat_at", "finalized_at")`,
    `ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "session_id" text`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_voice_session_unique" ON "usage_events" ("session_id") WHERE "session_id" IS NOT NULL AND "kind"='voice_minutes'`,
  ];
  for (const statement of ddl) await pool.query(statement);
}
