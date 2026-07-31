import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const hasDatabaseConfig = Boolean(databaseUrl);

if (!hasDatabaseConfig) {
  console.warn(
    "⚠ DATABASE_URL not set — database features (auth, users) will be unavailable.",
  );
}

export const pool = hasDatabaseConfig
  ? new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : (null as any);
export const db = pool ? drizzle(pool, { schema }) : (null as any);

export * from "./schema";
