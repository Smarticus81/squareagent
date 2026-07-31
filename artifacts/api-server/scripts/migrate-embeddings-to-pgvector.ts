import pg from "pg";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");

  await pool.query(
    "ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(1536)",
  );

  const { rows } = await pool.query(
    "SELECT id, embedding FROM knowledge_chunks WHERE embedding_vec IS NULL AND embedding IS NOT NULL AND embedding::text != '[]'",
  );

  let migrated = 0;
  for (const row of rows) {
    const arr =
      typeof row.embedding === "string"
        ? JSON.parse(row.embedding)
        : row.embedding;
    if (Array.isArray(arr) && arr.length === 1536) {
      const vecStr = `[${arr.join(",")}]`;
      await pool.query(
        "UPDATE knowledge_chunks SET embedding_vec = $1::vector WHERE id = $2",
        [vecStr, row.id],
      );
      migrated++;
    }
  }

  console.log(`Migrated ${migrated} of ${rows.length} embeddings to pgvector`);

  await pool.query("ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding");
  await pool.query(
    "ALTER TABLE knowledge_chunks RENAME COLUMN embedding_vec TO embedding",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)",
  );

  console.log("HNSW index created");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
