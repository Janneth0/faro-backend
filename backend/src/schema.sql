-- FARO: esquema inicial (onboarding + perfil + eventos)
-- Ejecutar una vez contra la base de datos configurada en DATABASE_URL

CREATE TABLE IF NOT EXISTS sites (
    id            SERIAL PRIMARY KEY,
    site_url      TEXT UNIQUE NOT NULL,        -- URL base del Moodle (ej: https://campus.miuni.edu)
    name          TEXT,                        -- nombre descriptivo interno
    secret        TEXT NOT NULL,               -- secreto HMAC compartido con el plugin PHP de ESE Moodle
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id                       SERIAL PRIMARY KEY,
    site_id                  INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    moodle_user_id           TEXT NOT NULL,     -- id de usuario tal cual lo manda Moodle (string, por si acaso)
    user_name                TEXT,
    user_type                TEXT,              -- ej: estudiante, docente
    moodle_course_id         TEXT,
    course_name              TEXT,
    city                     TEXT,
    device_category          TEXT,
    operating_system         TEXT,
    onboarding_completed      BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_completed_at   TIMESTAMPTZ,
    profile_key              TEXT,              -- perfil elegido en el onboarding (ej: 'baja_vision', 'motriz', etc.)
    settings_json            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- personalizacion (contraste, fuente, voz, etc.)
    first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id, moodle_user_id)
);

CREATE TABLE IF NOT EXISTS events (
    id            BIGSERIAL PRIMARY KEY,
    site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_name    TEXT NOT NULL,               -- ej: 'onboarding_shown', 'summary_generated', 'profile_selected'
    status        TEXT,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_site_user_created
    ON events (site_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_site
    ON users (site_id);
