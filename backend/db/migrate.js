// Aplica db/schema.sql contra la base indicada en DATABASE_URL
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); // necesario para gen_random_uuid()
  await pool.query(sql);
  console.log('Esquema aplicado correctamente.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
