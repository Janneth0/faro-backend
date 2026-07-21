const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/profile
// El widget llama esto justo despues de autenticar para saber si mostrar
// el onboarding y para restaurar el ultimo perfil/personalizacion guardados.
router.get('/', async (req, res) => {
    const { site_id, user_id } = req.faroUser;
    try {
        const result = await pool.query(
            `SELECT onboarding_completed, profile_key, settings_json
             FROM users WHERE id = $1 AND site_id = $2`,
            [user_id, site_id]
        );
        const row = result.rows[0];
        if (!row) return res.status(404).json({ error: 'usuario no encontrado' });
        return res.json(row);
    } catch (err) {
        console.error('[profile:get] error', err);
        return res.status(500).json({ error: 'error interno' });
    }
});

// PUT /api/profile
// Body puede traer cualquier combinacion de: profile_key, settings_json, onboarding_completed
router.put('/', async (req, res) => {
    const { site_id, user_id } = req.faroUser;
    const { profile_key, settings_json, onboarding_completed } = req.body || {};

    const sets = [];
    const values = [];
    let i = 1;

    if (profile_key !== undefined) { sets.push(`profile_key = $${i++}`); values.push(profile_key); }
    if (settings_json !== undefined) {
        // merge superficial sobre lo ya guardado, para no pisar ajustes previos no incluidos en este PUT
        sets.push(`settings_json = settings_json || $${i++}::jsonb`);
        values.push(JSON.stringify(settings_json));
    }
    if (onboarding_completed !== undefined) {
        sets.push(`onboarding_completed = $${i++}`);
        values.push(!!onboarding_completed);
        if (onboarding_completed) sets.push('onboarding_completed_at = now()');
    }

    if (!sets.length) return res.status(400).json({ error: 'nada para actualizar' });

    values.push(user_id, site_id);
    try {
        const result = await pool.query(
            `UPDATE users SET ${sets.join(', ')}
             WHERE id = $${i++} AND site_id = $${i++}
             RETURNING onboarding_completed, profile_key, settings_json`,
            values
        );
        return res.json(result.rows[0]);
    } catch (err) {
        console.error('[profile:put] error', err);
        return res.status(500).json({ error: 'error interno' });
    }
});

module.exports = router;
