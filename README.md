# FARO backend (etapa 1: onboarding + perfil)

Backend Node.js + Express + PostgreSQL que da soporte al widget FARO embebido en cada Moodle.

## Qué resuelve esta etapa

- Autenticación multi-tenant: cada Moodle (`site_url`) tiene su propio secreto HMAC. El plugin PHP firma la petición; el backend la valida y emite un JWT propio de sesión (no se usa Firebase Auth).
- `GET/PUT /api/profile`: saber si el usuario ya completó el onboarding, y guardar/leer el perfil elegido + personalización (`settings_json`).
- `POST /api/events`: registro simple de eventos (ya usado por el widget vía `faroLogEvent`), para tener la base del tracking aunque el análisis se construya después.

No incluye todavía: `/api/summarize` ni `/api/progress` (el widget los llama, pero fallan de forma controlada — el propio widget cae a un resumen local o muestra "no se pudo cargar"). Se implementan en la siguiente etapa.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completar DATABASE_URL y JWT_SECRET
npm run migrate        # crea las tablas (sites, users, events)
node src/register-site.js "https://campus.miuni.edu" "Universidad Demo"
npm start
```

El comando `register-site.js` imprime un `secret`: ese valor va en la configuración del plugin FARO instalado en **ese** Moodle específico (ver `faro-moodle-plugin/`). Cada Moodle nuevo se registra una vez con su propia URL y obtiene su propio secreto — así los datos de un sitio nunca se mezclan con los de otro.

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/auth/moodle` | firma HMAC del plugin | Valida el sitio + timestamp, upsert del usuario, devuelve JWT |
| GET | `/api/profile` | JWT (Bearer) | `{ onboarding_completed, profile_key, settings_json }` |
| PUT | `/api/profile` | JWT (Bearer) | Actualiza cualquier combinación de esos 3 campos |
| POST | `/api/events` | JWT (Bearer) | `{ event_name, status, ...payload }` |
| GET | `/health` | — | Chequeo de vida |

## Cómo se firma la request desde el plugin PHP

El plugin calcula, con el `secret` de su sitio:

```php
$signature = hash_hmac('sha256', $site_url . ':' . $timestamp . ':' . $moodle_user_id, $secret);
```

Y el backend recalcula lo mismo para verificar (ver `src/routes/auth.js`). El `timestamp` tiene una tolerancia de 5 minutos (`AUTH_TIMESTAMP_TOLERANCE_SECONDS`) para evitar reuso de una firma vieja capturada por un tercero.

## Próxima etapa (ya conversada, no incluida acá)

- `/api/summarize` y `/api/progress`.
- Panel admin para registrar sitios sin usar el CLI.
- Rotación de secretos por sitio.
