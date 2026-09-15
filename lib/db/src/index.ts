import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import * as autonomySchema from "./autonomy-schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const hasDatabaseConfig = Boolean(databaseUrl);

if (!hasDatabaseConfig) {
  console.warn(
    "⚠ DATABASE_URL not set — database features (auth, users) will be unavailable.",
  );
}

// Pool size is env-tunable so it can be aligned with the Postgres
// max_connections budget when running multiple instances on Railway:
// (instances × DATABASE_POOL_MAX) must stay under the server limit. Default 20
// suits a single instance; lower it per-instance before scaling horizontally.
const poolMax = (() => {
  const raw = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(raw) && raw > 0 ? raw : 20;
})();

// Preserve the repo's historical non-nullable Pool export so existing callers
// do not all acquire nullable types, while avoiding `(null as any)`, which erased
// pg's generic query signatures. At runtime this sentinel is still falsy and the
// existing `if (!pool)` guards continue to work exactly as before.
export const pool: pg.Pool = hasDatabaseConfig
  ? new Pool({
      connectionString: databaseUrl,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : (null as unknown as pg.Pool);

export const db = pool
  ? drizzle(pool, { schema: { ...schema, ...autonomySchema } })
  : (null as any);

// Periodic pool saturation metrics. `waitingCount > 0` means requests are
// queued for a connection — the signal that the pool is undersized or that
// queries are holding connections too long. Off by default; enable with
// DATABASE_POOL_METRICS=1 (interval via DATABASE_POOL_METRICS_MS, default 60s).
if (pool && process.env.DATABASE_POOL_METRICS === "1") {
  const intervalMs = Number(process.env.DATABASE_POOL_METRICS_MS) || 60_000;
  const timer = setInterval(() => {
    console.log(
      JSON.stringify({
        component: "db.pool",
        max: poolMax,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      }),
    );
  }, intervalMs);
  // Don't keep the event loop alive solely for metrics.
  if (typeof timer.unref === "function") timer.unref();
}

export * from "./schema";
export * from "./autonomy-schema";
