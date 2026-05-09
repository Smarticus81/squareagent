/**
 * query_database — execute a read-only SQL query against the user's external
 * Postgres connection. Each call opens a fresh client, runs the query inside a
 * READ ONLY transaction, then disconnects. Results are capped at 100 rows.
 *
 * Connection strings come from the external_db_connections table and are NOT
 * exposed to the model — only the row results.
 */

import { db, externalDbConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pg from "pg";
import { decrypt } from "../../lib/secrets";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "../types";

const { Client } = pg;

const FORBIDDEN = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|vacuum|analyze)\b/i;

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "query_database",
    description:
      "Run a read-only SQL SELECT against the user's connected database. Returns up to 100 rows as JSON. Schema hints (if configured) are included in your system prompt. Never use this for writes — they are blocked.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT statement (no semicolons, no DDL/DML)" },
        connection_label: { type: "string", description: "Optional connection label if the user has multiple", default: "default" },
      },
      required: ["sql"],
    },
  },
  {
    type: "function",
    name: "list_database_connections",
    description: "List the database connections available to query_database.",
    parameters: { type: "object", properties: {} },
  },
];

async function queryDatabase(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.userId) return { result: "query_database: missing user context." };
  if (!db) return { result: "query_database: workspace database is not configured." };

  const sql = String(args.sql ?? "").trim().replace(/;+\s*$/, "");
  if (!sql) return { result: "query_database: sql is required." };
  if (!/^\s*select\b/i.test(sql) && !/^\s*with\b/i.test(sql)) {
    return { result: "query_database: only SELECT / WITH queries are allowed." };
  }
  if (FORBIDDEN.test(sql)) return { result: "query_database: write/DDL keywords are blocked." };
  if (sql.includes(";")) return { result: "query_database: multiple statements are not allowed." };

  const label = String(args.connection_label ?? "default");
  const rows = await db
    .select()
    .from(externalDbConnectionsTable)
    .where(eq(externalDbConnectionsTable.userId, ctx.userId));
  const conn = rows.find((r: typeof rows[number]) => r.label === label) ?? rows[0];
  if (!conn) {
    return { result: "query_database: no database connection configured. Add one in the dashboard." };
  }

  const client = new Client({
    connectionString: decrypt(conn.connectionString),
    statement_timeout: 8_000,
    query_timeout: 8_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    // Wrap as subquery so user-supplied LIMIT / ORDER BY / OFFSET still works
    // and we still cap the cardinality at 100 rows.
    const wrapped = `SELECT * FROM (${sql}) AS _voycelab_q LIMIT 100`;
    const result = await client.query(wrapped);
    await client.query("ROLLBACK");
    const rows = result.rows ?? [];
    if (rows.length === 0) return { result: "Query returned 0 rows." };
    const preview = JSON.stringify(rows.slice(0, 100), null, 2);
    return { result: `Returned ${rows.length} row(s):\n${preview.slice(0, 6000)}` };
  } catch (e: any) {
    return { result: `query_database error: ${e.message}` };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

async function listConnections(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.userId) return { result: "list_database_connections: missing user context." };
  if (!db) return { result: "list_database_connections: workspace database is not configured." };
  const rows = await db
    .select()
    .from(externalDbConnectionsTable)
    .where(eq(externalDbConnectionsTable.userId, ctx.userId));
  if (rows.length === 0) return { result: "No database connections configured." };
  return {
    result: rows
      .map((r: typeof rows[number]) => `- ${r.label} (${r.kind})${r.schemaHint ? ` — ${r.schemaHint.slice(0, 120)}` : ""}`)
      .join("\n"),
  };
}

export const executors: Record<string, ToolExecutor> = {
  query_database: queryDatabase,
  list_database_connections: listConnections,
};
