import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

if (!databaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
