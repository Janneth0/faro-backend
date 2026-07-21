const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/events
// Body: { event_name, status, ...cualquier otro campo va a payload }
router.post('/', async (req, res) => {
    const { site_id, user_id } = req.faroUser;
    const { event_name, status, ...rest } = req.body || {};

    if (!event_name) return res.status(400).json({ error: 'event_name es requerido' });

    try {
        await pool.query(
            `INSERT INTO events (site_id, user_id, event_name, status, payload)
             VALUES ($1,$2,$3,$4,$5)`,
            [site_id, user_id, event_name, status || null, JSON.stringify(rest)]
        );
        return res.status(201).json({ ok: true });
    } catch (err) {
        console.error('[events:post] error', err);
        return res.status(500).json({ error: 'error interno' });
    }
});

module.exports = router;
