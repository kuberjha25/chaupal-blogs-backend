# Patch: Auto-DB bootstrap + PROD/UAT split

From the repo root, **overwrite/add these files at the same paths**, then commit.
(An existing `backend/.env` keeps working — the new ADMIN_*/SEED_MODE vars are optional and the defaults are sensible.)

## Files
| File | What |
|---|---|
| `backend/database/bootstrap.js` | **NEW** — at boot: DB create + schema + first-time seed, MySQL retry + OS hints. Never destructive. |
| `backend/database/data.js` | **NEW** — seed data in 2 parts: `essential` (prod-safe) + `dummy` (UAT). |
| `backend/database/seed.js` | **REPLACED** — thin CLI: `npm run seed` (demo reset) / `npm run seed:prod` (essential reset). |
| `backend/server.js` | **MODIFIED** — `ensureDatabase()` before listen. |
| `backend/package.json` | **MODIFIED** — `seed:prod` script. |
| `backend/.env.example` | **REPLACED** — SEED_MODE + ADMIN_* vars, comments. |
| `backend/.env.production.example` | **NEW** — annotated prod template (★ = must change). |
| `frontend/.env.production.example` | **NEW** — prod frontend env (API/site URLs; GA4+GSC pre-filled). |

## New flow (dev/UAT)
MySQL service ON (one-time auto-enable, below) → `npm run dev` from the repo root.
That's it. DB, tables, dummy data — created automatically on the first boot. Untouched on later boots.

## SEED_MODE
- `demo` — essential + full dummy data (the default when NODE_ENV != production)
- `essential` — only admin (from env) + taxonomy + settings + old-WP /category/ 301s (production default)
- `off` — nothing automatic (managed DB / DBA-controlled)
Boot never DROPs; it only fills an empty DB. Destructive reset = CLI only.

## What to change in PROD (marked ★ in the templates)
Backend `.env` (← `.env.production.example`): `NODE_ENV=production`, `SEED_MODE=essential`,
prod `DB_HOST/USER/PASSWORD`, **`JWT_SECRET`** (`openssl rand -hex 32`),
**`ADMIN_EMAIL` + a strong `ADMIN_PASSWORD`** (this is the prod Studio login), `FRONTEND_URL`/`SITE_URL=https://blog.chaupal.com`.
Frontend `.env.local` (← `.env.production.example`): `NEXT_PUBLIC_API_URL` (the real API domain),
`API_INTERNAL_URL`, `NEXT_PUBLIC_SITE_URL=https://blog.chaupal.com` → `npm run build && npm start`.

## MySQL "by itself" (one-time, per machine)
- Windows: the MySQL80 service is Automatic after install; if not, Admin CMD: `sc config MySQL80 start= auto && net start MySQL80`
- Mac (Homebrew): `brew services start mysql`  ← also registers auto-start at login
- Linux: `sudo systemctl enable --now mysql`
After that, laptop boot = MySQL up, you only run `npm run dev`. In prod, use managed MySQL
(Railway/RDS/PlanetScale) — like MongoDB Atlas: no server to manage, just the connection in `.env`.
If the server is down or the password is wrong, the backend stops with a clear hint instead of hanging silently.
