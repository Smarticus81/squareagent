import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const hasDatabaseConfig = Boolean(process.env.DATABASE_URL);

if (!hasDatabaseConfig) {
  console.warn(
    "⚠ DATABASE_URL not set — database features (auth, users) will be unavailable.",
  );
}

export const pool = hasDatabaseConfig
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : (null as any);
export const db = pool ? drizzle(pool, { schema }) : (null as any);

export async function verifyDatabaseConnection(): Promise<void> {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await pool.query("select 1");
}

export * from "./schema";
