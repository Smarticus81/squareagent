/**
 * One-shot migration: remaps legacy plan ids to current VoyceLab plans.
 *
 *   pos_only       -> pro
 *   inventory_only -> pro
 *   complete       -> business
 *   starter        -> pro
 *   professional   -> pro
 *   premium        -> business
 *   enterprise     -> business
 *
 * Usage (from repo root):
 *   pnpm tsx artifacts/api-server/scripts/migrate-legacy-plans.ts
 *
 * Reads DATABASE_URL from env. Dry-run by default; pass --apply to write.
 */
import pg from "pg";

const APPLY = process.argv.includes("--apply");

const MAPPING: Record<string, string> = {
  pos_only: "pro",
  inventory_only: "pro",
  complete: "business",
  starter: "pro",
  professional: "pro",
  premium: "business",
  enterprise: "business",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });

  try {
    for (const [legacy, modern] of Object.entries(MAPPING)) {
      const countResult = await pool.query(
        `SELECT count(*) AS n FROM subscriptions WHERE plan = $1`,
        [legacy],
      );
      const count = Number(countResult.rows[0].n);

      if (count === 0) {
        console.log(`  ${legacy} -> ${modern}: 0 rows (skip)`);
        continue;
      }

      if (APPLY) {
        await pool.query(
          `UPDATE subscriptions SET plan = $1 WHERE plan = $2`,
          [modern, legacy],
        );
        console.log(`  ${legacy} -> ${modern}: ${count} rows migrated`);
      } else {
        console.log(`  [dry] ${legacy} -> ${modern}: ${count} rows would migrate`);
      }
    }

    console.log(`\nDone (${APPLY ? "applied" : "dry-run"}).`);
    if (!APPLY) {
      console.log("Re-run with --apply to write changes.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
