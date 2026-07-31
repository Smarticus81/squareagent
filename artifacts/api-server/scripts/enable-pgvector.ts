/**
 * One-time migration: enable pgvector extension and create HNSW index
 * on knowledge_chunks.embedding for fast cosine similarity search.
 *
 * Run: npx tsx scripts/enable-pgvector.ts
 */

import { pool } from "@workspace/db";

async function main() {
  console.log("[pgvector] Enabling extension...");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  console.log("[pgvector] Extension enabled.");

  console.log("[pgvector] Creating HNSW index on knowledge_chunks.embedding...");
  await pool.query(`
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
    ON knowledge_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200)
  `);
  console.log("[pgvector] HNSW index created.");

  await pool.end();
  console.log("[pgvector] Done.");
}

main().catch((e) => {
  console.error("[pgvector] Migration failed:", e);
  process.exit(1);
});
