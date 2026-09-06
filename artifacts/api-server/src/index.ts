import { createServer } from "http";
import app from "./app";
import { pool } from "@workspace/db";
import { assertJwtSecret } from "./routes/auth";
import { attachWebSocketRelay, closeAllRelays } from "./routes/ws-relay";
import { assertSecretsEncryptionKey } from "./lib/secrets";
import { ensureInfraTables } from "./lib/ensure-infra-tables";
import { flushAllDirtySessions, stopSessionStoreBackgroundTasks } from "./lib/session-store";
import { stopVoiceSessionSweeper } from "./lib/voice-session-metering";
import { startAutonomyScheduler, stopAutonomyScheduler } from "./autonomy/scheduler";

async function main() {
  assertJwtSecret();
  assertSecretsEncryptionKey();

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
    // Operational tables (OAuth handshake state, pending token claims, rate
    // limits, autonomy control-plane ledger) are created idempotently so a
    // deploy never depends on a manual schema push for runtime plumbing.
    await ensureInfraTables();
  }

  const server = createServer(app);

  attachWebSocketRelay(server);

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startAutonomyScheduler();
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully…`);
    stopAutonomyScheduler();
    stopVoiceSessionSweeper();
    stopSessionStoreBackgroundTasks();

    try {
      await closeAllRelays();
      await flushAllDirtySessions();
    } catch (e: any) {
      console.warn("Pre-shutdown flush warning:", e.message);
    }

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

    setTimeout(() => {
      console.error("Graceful shutdown timed out — forcing exit.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
}

main().catch((error: any) => {
  console.error(error.message || error);
  process.exit(1);
});
