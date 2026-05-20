import pg from "pg";
import { encrypt, decrypt } from "../src/lib/secrets";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query("SELECT id, square_access_token FROM venues WHERE square_access_token IS NOT NULL");
  let migrated = 0;
  for (const row of rows) {
    // decrypt first to check if already encrypted (returns same value if plaintext)
    const plain = decrypt(row.square_access_token);
    const encrypted = encrypt(plain);
    if (encrypted !== row.square_access_token) {
      await pool.query("UPDATE venues SET square_access_token = $1 WHERE id = $2", [encrypted, row.id]);
      migrated++;
    }
  }
  console.log(`Migrated ${migrated} of ${rows.length} venue tokens`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
