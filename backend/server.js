require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origen no permitido'));
  }
}));

// ------------------------------------------------------------------
// Salud
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ------------------------------------------------------------------
// Middleware: valida el JWT del usuario final
// ------------------------------------------------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta token' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ------------------------------------------------------------------
// AUTENTICACIÓN
// El plugin PHP de Moodle llama a este endpoint DESDE EL SERVIDOR
// (server-to-server) firmando el payload con el api_secret del sitio,
// que se generó al registrar el Moodle (ver /api/admin/sites).
// Devuelve un JWT que el navegador del alumno usa para el resto de
// las llamadas.
// ------------------------------------------------------------------
app.post('/api/auth/moodle', async (req, res) => {
  const { site_url, timestamp, signature, moodle_user_id, user_name, user_type,
          moodle_course_id, course_name, city, province, age_range } = req.body;

  if (!site_url || !signature || !moodle_user_id) {
    return res.status(400).json({ error: 'Payload incompleto' });
  }

  // Evita replay de firmas viejas (5 minutos de margen)
  if (!timestamp || Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Timestamp inválido o expirado' });
  }

  try {
    const siteRes = await pool.query('SELECT * FROM moodle_site WHERE site_url = $1 AND active = true', [site_url]);
    if (siteRes.rowCount === 0) return res.status(404).json({ error: 'Sitio Moodle no registrado' });
    const site = siteRes.rows[0];

    const base = `${site_url}|${moodle_user_id}|${timestamp}`;
    const expected = crypto.createHmac('sha256', site.api_secret).update(base).digest('hex');
    if (expected !== signature) return res.status(401).json({ error: 'Firma inválida' });

    // Upsert usuario
    const userRes = await pool.query(
      `INSERT INTO app_user (moodle_site_id, moodle_user_id, user_name, user_type, city, province, age_range)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (moodle_site_id, moodle_user_id)
       DO UPDATE SET user_name = EXCLUDED.user_name, updated_at = now()
       RETURNING user_id`,
      [site.moodle_site_id, moodle_user_id, user_name || null, user_type || 'estudiante', city || null, province || null, age_range || null]
    );
    const userId = userRes.rows[0].user_id;

    // Upsert curso (si vino uno)
    let courseId = null;
    if (moodle_course_id) {
      const courseRes = await pool.query(
        `INSERT INTO course (moodle_site_id, moodle_course_id, course_name)
         VALUES ($1,$2,$3)
         ON CONFLICT (moodle_site_id, moodle_course_id)
         DO UPDATE SET course_name = EXCLUDED.course_name
         RETURNING course_id`,
        [site.moodle_site_id, moodle_course_id, course_name || null]
      );
      courseId = courseRes.rows[0].course_id;
    }

    // Crea sesión
    const sessionRes = await pool.query(
      `INSERT INTO session (moodle_site_id, user_id, device_category, operating_system)
       VALUES ($1,$2,$3,$4) RETURNING session_id`,
      [site.moodle_site_id, userId, req.body.device_category || 'desconocido', req.body.operating_system || 'desconocido']
    );

    const token = jwt.sign(
      { user_id: userId, moodle_site_id: site.moodle_site_id, course_id: courseId, session_id: sessionRes.rows[0].session_id },
      JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token, user_id: userId, course_id: courseId, session_id: sessionRes.rows[0].session_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno de autenticación' });
  }
});

// ------------------------------------------------------------------
// PERFIL DE ACCESIBILIDAD (leer / guardar)
// ------------------------------------------------------------------
app.get('/api/profile', requireAuth, async (req, res) => {
  const r = await pool.query('SELECT * FROM user_accessibility_settings WHERE user_id = $1', [req.auth.user_id]);
  res.json(r.rows[0] || { user_id: req.auth.user_id, profile_key: null, settings_json: {}, onboarding_completed: false });
});

app.put('/api/profile', requireAuth, async (req, res) => {
  const { profile_key, settings_json, onboarding_completed } = req.body;
  const r = await pool.query(
    `INSERT INTO user_accessibility_settings (user_id, profile_key, settings_json, onboarding_completed, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       profile_key = COALESCE(EXCLUDED.profile_key, user_accessibility_settings.profile_key),
       settings_json = COALESCE(EXCLUDED.settings_json, user_accessibility_settings.settings_json),
       onboarding_completed = COALESCE(EXCLUDED.onboarding_completed, user_accessibility_settings.onboarding_completed),
       updated_at = now()
     RETURNING *`,
    [req.auth.user_id, profile_key || null, settings_json ? JSON.stringify(settings_json) : null, onboarding_completed ?? null]
  );
  await pool.query('UPDATE app_user SET accessibility_profile = $1 WHERE user_id = $2', [profile_key || null, req.auth.user_id]);
  res.json(r.rows[0]);
});

// ------------------------------------------------------------------
// EVENTOS DE ANALYTICS (cada acción del widget se loguea acá)
// ------------------------------------------------------------------
app.post('/api/events', requireAuth, async (req, res) => {
  const { event_name, feature, feature_value, mode, preset, activity_id, activity_name, action, detail, status } = req.body;
  await pool.query(
    `INSERT INTO evento (moodle_site_id, session_id, user_id, course_id, event_name, accessibility_profile,
                          feature, feature_value, mode, preset, activity_id, activity_name, action, detail, status)
     VALUES ($1,$2,$3,$4,$5,(SELECT accessibility_profile FROM app_user WHERE user_id=$3),$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [req.auth.moodle_site_id, req.auth.session_id, req.auth.user_id, req.auth.course_id,
     event_name, feature || null, feature_value || null, mode || null, preset || null,
     activity_id || null, activity_name || null, action || null, detail || null, status || 'success']
  );
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// PROGRESO / ACTIVIDADES PENDIENTES
// ------------------------------------------------------------------
app.get('/api/progress', requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT activity_id, activity_name, status, due_date, progress_percent
     FROM user_progress WHERE user_id = $1 ORDER BY due_date NULLS LAST`,
    [req.auth.user_id]
  );
  res.json(r.rows);
});

// El plugin PHP empuja acá el estado real de Moodle (completion API) cuando el usuario entra a un curso
app.post('/api/progress/sync', requireAuth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for (const it of items) {
    await pool.query(
      `INSERT INTO user_progress (user_id, course_id, activity_id, activity_name, status, due_date, progress_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.auth.user_id, req.auth.course_id, it.activity_id, it.activity_name, it.status, it.due_date || null, it.progress_percent || 0]
    );
  }
  res.json({ ok: true, inserted: items.length });
});

// ------------------------------------------------------------------
// RESUMEN / SIMPLIFICACIÓN DE CONTENIDO
// Resumidor extractivo simple (sin API keys externas) para que el
// plugin funcione "de fábrica" apenas se instala. Si más adelante
// quieren mejor calidad, este endpoint es el único lugar a cambiar
// por una llamada a un LLM externo.
// ------------------------------------------------------------------
app.post('/api/summarize', requireAuth, async (req, res) => {
  const { text, max_sentences = 3 } = req.body;
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Falta texto' });
  const summary = extractiveSummary(text, max_sentences);
  res.json({ summary });
});

function extractiveSummary(text, maxSentences) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.length > 0);
  if (sentences.length <= maxSentences) return clean;

  const stopwords = new Set(['de','la','que','el','en','y','a','los','del','se','las','por','un','para','con','no','una','su','al','lo','como','más','o']);
  const freq = {};
  for (const s of sentences) {
    for (const w of s.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(' ')) {
      if (!w || stopwords.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(' ');
    const score = words.reduce((acc, w) => acc + (freq[w] || 0), 0) / (words.length || 1);
    return { s, i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxSentences).sort((a, b) => a.i - b.i);
  return top.map(t => t.s).join(' ');
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API de accesibilidad escuchando en puerto ${port}`));
