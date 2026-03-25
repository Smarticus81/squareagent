import { createServer } from "http";
import app from "./app";
import { pool } from "@workspace/db";
import { assertJwtSecret } from "./routes/auth";

async function main() {
  // Fail immediately if JWT_SECRET is not set in production
  assertJwtSecret();

  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error("PORT environment variable is required but was not provided.");
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  if (pool) {
    try {
      await pool.query("select 1");
      console.log("Database connection verified.");
    } catch (error: any) {
      console.error("Database connection failed.");
      console.error(error.message);
      throw new Error("Configured DATABASE_URL is unreachable. Fix database connectivity before starting the API.");
    }

    // Auto-create exchange_codes table if it doesn't exist
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS exchange_codes (
          code TEXT PRIMARY KEY,
          token TEXT NOT NULL,
          venue_id TEXT NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      console.log("exchange_codes table OK");
    } catch (e: any) {
      console.error("Failed to ensure exchange_codes table:", e.message);
    }
  }

  const server = createServer(app);

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully…`);
    server.close(() => {
      console.log("HTTP server closed.");
      if (pool) {
        pool.end().then(() => {
          console.log("DB pool drained.");
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
    // Force exit after 10s if draining stalls
    setTimeout(() => {
      console.error("Graceful shutdown timed out — forcing exit.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: any) => {
  console.error(error.message || error);
  process.exit(1);
});
