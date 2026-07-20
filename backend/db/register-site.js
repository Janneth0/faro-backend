// Uso: node db/register-site.js "https://miuniversidad.edu/moodle" "Nombre visible del Moodle"
// Imprime el api_secret que hay que pegar en la configuración del plugin dentro de Moodle.
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

async function main() {
  const [siteUrl, siteName] = process.argv.slice(2);
  if (!siteUrl) {
    console.error('Uso: node db/register-site.js <site_url> [site_name]');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const r = await pool.query(
    `INSERT INTO moodle_site (site_url, site_name, api_secret) VALUES ($1,$2,$3)
     ON CONFLICT (site_url) DO UPDATE SET site_name = EXCLUDED.site_name
     RETURNING moodle_site_id, api_secret`,
    [siteUrl, siteName || siteUrl, apiSecret]
  );
  console.log('Sitio registrado. Guarda estos datos en la configuración del plugin en Moodle:');
  console.log('  moodle_site_id:', r.rows[0].moodle_site_id);
  console.log('  api_secret    :', r.rows[0].api_secret);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
