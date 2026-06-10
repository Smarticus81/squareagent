/**
 * One-shot backfill: encrypts plaintext secrets stored before encryption-at-rest
 * was enabled. Safe to re-run — already-encrypted rows are skipped.
 *
 * Usage (from repo root):
 *   pnpm tsx artifacts/api-server/scripts/encrypt-secrets-backfill.ts
 *
 * Reads DATABASE_URL + SECRETS_ENCRYPTION_KEY from env. Dry-run by default;
 * pass --apply to actually write. ENCRYPTION_KEY is accepted only for legacy
 * deployments; do not rely on JWT_SECRET for production encryption.
 */
import { db, externalDbConnectionsTable, emailCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encrypt, isEncrypted } from "../src/lib/secrets";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!db) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  // External DB connection strings
  const dbRows = await db.select().from(externalDbConnectionsTable);
  let dbToFix = 0;
  for (const row of dbRows) {
    if (isEncrypted(row.connectionString)) continue;
    dbToFix++;
    if (APPLY) {
      await db
        .update(externalDbConnectionsTable)
        .set({ connectionString: encrypt(row.connectionString) })
        .where(eq(externalDbConnectionsTable.id, row.id));
      console.log(`  encrypted external_db_connections.id=${row.id}`);
    } else {
      console.log(`  [dry] would encrypt external_db_connections.id=${row.id}`);
    }
  }

  // Email credentials (apiKey)
  const emailRows = await db.select().from(emailCredentialsTable);
  let emailToFix = 0;
  for (const row of emailRows) {
    if (!row.apiKey || isEncrypted(row.apiKey)) continue;
    emailToFix++;
    if (APPLY) {
      await db
        .update(emailCredentialsTable)
        .set({ apiKey: encrypt(row.apiKey) })
        .where(eq(emailCredentialsTable.id, row.id));
      console.log(`  encrypted email_credentials.id=${row.id}`);
    } else {
      console.log(`  [dry] would encrypt email_credentials.id=${row.id}`);
    }
  }

  console.log(
    `\nDone. ${APPLY ? "applied" : "dry-run"}: db_connections=${dbToFix}, email_credentials=${emailToFix}`,
  );
  if (!APPLY && (dbToFix + emailToFix) > 0) {
    console.log("Re-run with --apply to write changes.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
