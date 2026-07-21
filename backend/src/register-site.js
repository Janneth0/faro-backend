// Uso: node src/register-site.js "https://campus.miuni.edu" "Nombre descriptivo"
// Imprime el site_id y el secret que hay que cargar en la configuracion del plugin de ESE Moodle.

require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('./db');

async function main() {
    const [siteUrl, name] = process.argv.slice(2);
    if (!siteUrl) {
        console.error('Uso: node src/register-site.js <site_url> [nombre]');
        process.exit(1);
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
        `INSERT INTO sites (site_url, name, secret)
         VALUES ($1, $2, $3)
         ON CONFLICT (site_url) DO UPDATE SET secret = EXCLUDED.secret, name = EXCLUDED.name
         RETURNING id`,
        [siteUrl, name || siteUrl, secret]
    );

    console.log('Sitio registrado con id:', result.rows[0].id);
    console.log('site_url:', siteUrl);
    console.log('secret (cargar en la config del plugin FARO en ese Moodle):');
    console.log(secret);

    await pool.end();
}

main().catch((err) => {
    console.error('Error registrando el sitio:', err);
    process.exit(1);
});
