import { pool } from "@workspace/db";

/** Keep production-compatible columns required by durable voice metering present.
 * Railway does not run drizzle-kit push automatically, so additive/defaulted runtime
 * columns are repaired idempotently at boot. Legacy voice_sessions installations may
 * predate the durable session model, so include every column read by the metering path.
 */
export async function ensureProductRuntimeSchema(): Promise<void> {
  if (!pool) return;
  const ddl = [
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "organization_id" uuid`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "metered_duration_ms" integer NOT NULL DEFAULT 0`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "ended_at" timestamp`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "finalized_duration_ms" integer`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "pipeline_provider" text`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "agent_profile_id" uuid`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "venue_id" integer`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT NOW()`,
    `ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp`,
    `UPDATE "voice_sessions" SET "expires_at" = COALESCE("expires_at", NOW() + INTERVAL '30 minutes') WHERE "expires_at" IS NULL`,
    `CREATE INDEX IF NOT EXISTS "voice_sessions_finalized_idx" ON "voice_sessions" ("finalized_at")`,
    `CREATE INDEX IF NOT EXISTS "voice_sessions_stale_heartbeat_idx" ON "voice_sessions" ("last_heartbeat_at", "finalized_at")`,
    `ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "session_id" text`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_voice_session_unique" ON "usage_events" ("session_id") WHERE "session_id" IS NOT NULL AND "kind"='voice_minutes'`,
  ];
  for (const statement of ddl) await pool.query(statement);

  // Fail fast during boot if runtime schema repair did not produce the columns the
  // stale-session sweeper depends on. This prevents a silently broken background loop.
  await pool.query(`SELECT "id", "user_id", "organization_id", "metered_duration_ms", "agent_profile_id", "venue_id", "pipeline_provider", "finalized_at", "last_heartbeat_at" FROM "voice_sessions" LIMIT 0`);
}
