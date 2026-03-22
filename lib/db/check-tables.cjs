const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
  .then(r => {
    console.log("Tables in public schema:", r.rows.map(x => x.table_name));
    return pool.query("SELECT COUNT(*) FROM users");
  })
  .then(r => {
    console.log("Users count:", r.rows[0].count);
    return pool.end();
  })
  .catch(e => {
    console.error("ERROR:", e.message);
    pool.end();
    process.exit(1);
  });
