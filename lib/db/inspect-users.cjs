const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position")
  .then(r => {
    console.log("Columns in users table:");
    r.rows.forEach(row => console.log(`  ${row.column_name} (${row.data_type})`));
    return pool.query("SELECT * FROM users LIMIT 1");
  })
  .then(r => {
    console.log("\nSample row:", JSON.stringify(r.rows[0], null, 2));
    return pool.end();
  })
  .catch(e => {
    console.error("ERROR:", e.message);
    pool.end();
    process.exit(1);
  });
