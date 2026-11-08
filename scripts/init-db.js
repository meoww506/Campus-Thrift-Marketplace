require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database tables created successfully.');
  await pool.end();
}
main().catch(async (err) => {
  console.error('Database setup failed:', err.message);
  await pool.end();
  process.exit(1);
});
