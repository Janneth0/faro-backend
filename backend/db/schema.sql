-- ============================================================
-- Esquema PostgreSQL - Plugin de Accesibilidad para Moodle
-- Multi-tenant: cada Moodle que instale el plugin es un "site"
-- distinto. Todo se filtra por moodle_site_id para no mezclar
-- usuarios/datos entre instalaciones distintas.
-- ============================================================

-- ---------- TENANTS (cada instalación de Moodle) ----------
CREATE TABLE IF NOT EXISTS moodle_site (
    moodle_site_id      SERIAL PRIMARY KEY,
    site_url            TEXT UNIQUE NOT NULL,      -- ej: https://miuniversidad.edu/moodle
    site_name           VARCHAR(255),
    api_secret          TEXT NOT NULL,             -- secreto compartido con el plugin PHP (HMAC)
    created_at          TIMESTAMPTZ DEFAULT now(),
    active              BOOLEAN DEFAULT true
);

-- ---------- USER ----------
CREATE TABLE IF NOT EXISTS app_user (
    user_id             SERIAL PRIMARY KEY,
    moodle_site_id      INTEGER NOT NULL REFERENCES moodle_site(moodle_site_id),
    moodle_user_id      INTEGER NOT NULL,          -- id del usuario dentro de SU Moodle
    user_name           VARCHAR(255),
    user_segment        VARCHAR(100),
    city                VARCHAR(150),
    province            VARCHAR(150),
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,
    age_range           VARCHAR(50),
    user_type           VARCHAR(50),               -- estudiante / docente / admin
    accessibility_profile VARCHAR(50),              -- perfil activo actual (denormalizado, ver tabla abajo)
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (moodle_site_id, moodle_user_id)
);

-- ---------- COURSE ----------
CREATE TABLE IF NOT EXISTS course (
    course_id           SERIAL PRIMARY KEY,
    moodle_site_id      INTEGER NOT NULL REFERENCES moodle_site(moodle_site_id),
    moodle_course_id    INTEGER NOT NULL,
    course_name         VARCHAR(255),
    UNIQUE (moodle_site_id, moodle_course_id)
);

-- ---------- SESSION ----------
CREATE TABLE IF NOT EXISTS session (
    session_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moodle_site_id          INTEGER NOT NULL REFERENCES moodle_site(moodle_site_id),
    user_id                 INTEGER REFERENCES app_user(user_id),
    device_category         VARCHAR(50),   -- desktop / mobile / tablet
    operating_system        VARCHAR(50),
    started_at              TIMESTAMPTZ DEFAULT now(),
    ended_at                TIMESTAMPTZ,
    session_duration_seconds INTEGER
);

-- ---------- EVENTOS ----------
CREATE TABLE IF NOT EXISTS evento (
    id_event            BIGSERIAL PRIMARY KEY,
    moodle_site_id      INTEGER NOT NULL REFERENCES moodle_site(moodle_site_id),
    session_id          UUID REFERENCES session(session_id),
    user_id             INTEGER REFERENCES app_user(user_id),
    course_id           INTEGER REFERENCES course(course_id),
    event_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    event_timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_name          VARCHAR(120) NOT NULL,     -- ej: profile_selected, tts_play, summary_generated
    accessibility_profile VARCHAR(50),
    feature              VARCHAR(80),               -- ej: contraste, tamano_fuente, tts, resumen
    feature_value         VARCHAR(120),
    mode                  VARCHAR(50),
    preset                VARCHAR(50),
    activity_id           INTEGER,
    activity_name          VARCHAR(255),
    action                VARCHAR(80),
    detail                 TEXT,
    status                  VARCHAR(30)              -- success / error / pending
);
CREATE INDEX IF NOT EXISTS idx_evento_site_date ON evento (moodle_site_id, event_date);
CREATE INDEX IF NOT EXISTS idx_evento_user ON evento (user_id);

-- ---------- VISTA "INNOVALAB" (tabla ancha para BI / data analytics) ----------
-- En vez de duplicar datos, se arma como VIEW que junta todo.
CREATE OR REPLACE VIEW innovalab AS
SELECT
    e.event_date,
    e.event_timestamp,
    e.event_name,
    u.user_id,
    u.user_name,
    u.user_segment,
    u.city,
    u.province,
    u.latitude,
    u.longitude,
    u.age_range,
    u.user_type,
    e.accessibility_profile,
    c.course_id,
    c.course_name,
    s.device_category,
    s.operating_system,
    e.session_id,
    s.session_duration_seconds,
    e.feature,
    e.feature_value,
    e.mode,
    e.preset,
    e.activity_id,
    e.activity_name,
    e.action,
    e.detail,
    e.status,
    e.moodle_site_id
FROM evento e
LEFT JOIN app_user u ON u.user_id = e.user_id
LEFT JOIN course c ON c.course_id = e.course_id
LEFT JOIN session s ON s.session_id = e.session_id;

-- ---------- PERFILES DE ACCESIBILIDAD GUARDADOS POR USUARIO ----------
CREATE TABLE IF NOT EXISTS user_accessibility_settings (
    user_id             INTEGER PRIMARY KEY REFERENCES app_user(user_id),
    profile_key         VARCHAR(50),   -- filtros_color | asistente_voz | fuentes_legibles | seguridad_visual | visibilidad | enfoque
    settings_json        JSONB DEFAULT '{}'::jsonb,  -- personalización fina (contraste, tamaño, velocidad voz, etc.)
    onboarding_completed BOOLEAN DEFAULT false,
    updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ---------- PROGRESO / ACTIVIDADES PENDIENTES (cache liviano desde Moodle) ----------
CREATE TABLE IF NOT EXISTS user_progress (
    id                   BIGSERIAL PRIMARY KEY,
    user_id              INTEGER REFERENCES app_user(user_id),
    course_id            INTEGER REFERENCES course(course_id),
    activity_id          INTEGER,
    activity_name         VARCHAR(255),
    status                 VARCHAR(30),  -- pendiente / en_progreso / completada
    due_date               TIMESTAMPTZ,
    progress_percent        SMALLINT DEFAULT 0,
    updated_at               TIMESTAMPTZ DEFAULT now()
);
