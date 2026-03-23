import { createServer } from "http";
import app from "./app";
import { pool } from "@workspace/db";

async function main() {
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
  }

  const server = createServer(app);

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((error: any) => {
  console.error(error.message || error);
  process.exit(1);
});
