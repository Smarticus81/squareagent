/**
 * Boot-time schema guard for operational infrastructure tables.
 *
 * Railway deploys never run `drizzle-kit push` — schema migration is a manual
 * step (`cd lib/db && pnpm push`). The tables below are pure runtime plumbing
 * (OAuth handshake state, pending token claims, rate-limit buckets): the app
 * cannot function without them, they hold only short-lived rows, and their
 * absence surfaces as confusing mid-flow failures (e.g. Square OAuth dying on
 * the pending-token insert AFTER the user has authorized). Creating them
 * idempotently at boot removes that deploy/migration ordering hazard.
 *
 * DDL must stay in sync with lib/db/src/schema/index.ts. Domain tables
 * (users, venues, orders, …) are intentionally NOT handled here — those still
 * require a real migration.
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
  `CREATE INDEX IF NOT EXISTS "square_oauth_pending_user_idx" ON "square_oauth_pending_tokens" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "square_oauth_pending_expires_idx" ON "square_oauth_pending_tokens" ("expires_at")`,
  `CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
    "bucket_key" text PRIMARY KEY,
    "hit_count" integer NOT NULL DEFAULT 1,
    "window_start" timestamp NOT NULL,
    "expires_at" timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expires_idx" ON "rate_limit_buckets" ("expires_at")`,
];

export async function ensureInfraTables(): Promise<void> {
  if (!pool) return;
  for (const ddl of INFRA_TABLE_DDL) {
    try {
      await pool.query(ddl);
    } catch (e: any) {
      // A failure here means the base schema (users/organizations) is missing
      // or the DB role lacks DDL rights — either way the operator must run the
      // real migration. Log loudly but let the server come up so /readyz and
      // the rest of the app can report state.
      console.error(
        `[schema] Failed to ensure infra table (run "cd lib/db && pnpm push" against this database): ${e?.message ?? e}`,
      );
      return;
    }
  }
}
