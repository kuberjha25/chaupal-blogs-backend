# Patch: Auto-DB bootstrap + PROD/UAT split

Repo root te in files nu **same paths pe overwrite/add** karo, phir commit.
(`backend/.env` chal reha purana bhi kaam karega — naye ADMIN_*/SEED_MODE optional ne, defaults smart ne.)

## Files
| File | Kya |
|---|---|
| `backend/database/bootstrap.js` | **NEW** — boot te DB create + schema + first-time seed, MySQL retry + OS hints. Kade destructive nahi. |
| `backend/database/data.js` | **NEW** — seed data 2 hisse: `essential` (prod-safe) + `dummy` (UAT). |
| `backend/database/seed.js` | **REPLACED** — thin CLI: `npm run seed` (demo reset) / `npm run seed:prod` (essential reset). |
| `backend/server.js` | **MODIFIED** — listen ton pehla `ensureDatabase()`. |
| `backend/package.json` | **MODIFIED** — `seed:prod` script. |
| `backend/.env.example` | **REPLACED** — SEED_MODE + ADMIN_* vars, comments. |
| `backend/.env.production.example` | **NEW** — annotated prod template (★ = zaroor badlo). |
| `frontend/.env.production.example` | **NEW** — prod frontend env (API/site URLs; GA4+GSC pre-filled). |

## Naya flow (dev/UAT)
MySQL service ON (one-time auto-enable, niche) → repo root te `npm run dev`.
Bas. DB, tables, dummy data — pehli boot te apne aap. Baad wali boots te untouched.

## SEED_MODE
- `demo` — essential + poora dummy (NODE_ENV!=production da default)
- `essential` — sirf admin(env) + taxonomy + settings + purane-WP /category/ 301s (production default)
- `off` — kuchh auto nahi (managed DB / DBA-controlled)
Boot kade DROP nahi karda; sirf khali DB bharta hai. Destructive reset = sirf CLI.

## PROD te kya badalna (★ templates me marked)
Backend `.env` (← `.env.production.example`): `NODE_ENV=production`, `SEED_MODE=essential`,
prod `DB_HOST/USER/PASSWORD`, **`JWT_SECRET`** (`openssl rand -hex 32`),
**`ADMIN_EMAIL` + strong `ADMIN_PASSWORD`** (ehi prod Studio login), `FRONTEND_URL`/`SITE_URL=https://blog.chaupal.com`.
Frontend `.env.local` (← `.env.production.example`): `NEXT_PUBLIC_API_URL` (asli API domain),
`API_INTERNAL_URL`, `NEXT_PUBLIC_SITE_URL=https://blog.chaupal.com` → `npm run build && npm start`.

## MySQL "apne aap" (one-time, per machine)
- Windows: install te MySQL80 service Automatic hi hondi hai; na ho ta Admin CMD: `sc config MySQL80 start= auto && net start MySQL80`
- Mac (Homebrew): `brew services start mysql`  ← login te auto-start register
- Linux: `sudo systemctl enable --now mysql`
Iton baad laptop boot = MySQL up, tusi sirf `npm run dev`. Prod te managed MySQL
(Railway/RDS/PlanetScale) lo — MongoDB Atlas jaisa: koi server manage nahi, sirf `.env` me connection.
Server down/galat-password ho ta backend saaf hint de ke rukda hai, chup-chaap hang nahi.
