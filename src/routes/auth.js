const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();

function computeSignature(secret, siteUrl, timestamp, moodleUserId) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${siteUrl}:${timestamp}:${moodleUserId}`)
        .digest('hex');
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/auth/moodle
// Body enviado por el plugin PHP (firmado con el secret del sitio):
// { site_url, timestamp, signature, moodle_user_id, user_name, user_type,
//   moodle_course_id, course_name, city, device_category, operating_system }
router.post('/moodle', async (req, res) => {
    const {
        site_url, timestamp, signature, moodle_user_id, user_name, user_type,
        moodle_course_id, course_name, city, device_category, operating_system,
    } = req.body || {};

    if (!site_url || !timestamp || !signature || !moodle_user_id) {
        return res.status(400).json({ error: 'faltan campos requeridos' });
    }

    // 1. Ventana anti-replay: el timestamp no puede ser muy viejo ni futuro
    const tolerance = Number(process.env.AUTH_TIMESTAMP_TOLERANCE_SECONDS || 300);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > tolerance) {
        return res.status(401).json({ error: 'timestamp fuera de rango' });
    }

    try {
        // 2. Buscar el sitio (tenant) por su URL
        const siteResult = await pool.query(
            'SELECT id, secret FROM sites WHERE site_url = $1 AND active = TRUE',
            [site_url]
        );
        const site = siteResult.rows[0];
        if (!site) {
            return res.status(401).json({ error: 'sitio no registrado' });
        }

        // 3. Verificar la firma HMAC calculada por el plugin PHP
        const expected = computeSignature(site.secret, site_url, timestamp, moodle_user_id);
        if (!safeEqual(expected, signature)) {
            return res.status(401).json({ error: 'firma invalida' });
        }

        // 4. Upsert del usuario para este sitio
        const upsert = await pool.query(
            `INSERT INTO users (site_id, moodle_user_id, user_name, user_type, moodle_course_id,
                                 course_name, city, device_category, operating_system, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
             ON CONFLICT (site_id, moodle_user_id) DO UPDATE SET
                 user_name = EXCLUDED.user_name,
                 user_type = EXCLUDED.user_type,
                 moodle_course_id = EXCLUDED.moodle_course_id,
                 course_name = EXCLUDED.course_name,
                 city = EXCLUDED.city,
                 device_category = EXCLUDED.device_category,
                 operating_system = EXCLUDED.operating_system,
                 last_seen_at = now()
             RETURNING id, onboarding_completed`,
            [site.id, moodle_user_id, user_name, user_type, moodle_course_id,
                course_name, city, device_category, operating_system]
        );
        const user = upsert.rows[0];

        // 5. Emitir el JWT propio de sesion (esto es lo que el widget guarda como backendState.token)
        const token = jwt.sign(
            { site_id: site.id, user_id: user.id, moodle_user_id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
        );

        return res.json({ token, onboarding_completed: user.onboarding_completed });
    } catch (err) {
        console.error('[auth/moodle] error', err);
        return res.status(500).json({ error: 'error interno' });
    }
});

module.exports = router;
