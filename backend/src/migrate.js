require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    console.log('[migrate] aplicando schema.sql...');
    await pool.query(sql);
    console.log('[migrate] listo.');
    await pool.end();
}

migrate().catch((err) => {
    console.error('[migrate] fallo la migracion:', err);
    process.exit(1);
});
