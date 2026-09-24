/* Auto-bootstrap — "just run the backend, DB will be prepared":
  On server boot ensureDatabase() does the following:
    1. Retry connecting to MySQL (if down, provide clear OS-level hints)
    2. If database missing → CREATE DATABASE (utf8mb4)
    3. If tables missing → apply schema.sql
    4. If users table is EMPTY → seed data depending on SEED_MODE:
       SEED_MODE=demo      → essential + full dummy data (dev/UAT default)
       SEED_MODE=essential → only admin + taxonomy + settings + WP 301s (PROD default)
       SEED_MODE=off       → do not create/seed (DBA-managed)
  If data already exists → NOTHING is changed. Boot-time is non-destructive.
  Destructive reset is only via CLI: `npm run seed` (demo) / `npm run seed:prod` (essential). */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { essentialData, dummyData } = require('./data');

const DB = () => process.env.DB_NAME || 'chaupal_charcha';

const cfg = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

function seedMode() {
  const m = (process.env.SEED_MODE || '').toLowerCase();
  if (['demo', 'essential', 'off'].includes(m)) return m;
  return process.env.NODE_ENV === 'production' ? 'essential' : 'demo';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Wait for MySQL server to be up — in dev the service may take a moment to start */
async function connectWithRetry(tries = 15, delayMs = 2000) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await mysql.createConnection(cfg());
    } catch (e) {
      lastErr = e;
      if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'ENOTFOUND') {
        if (i === 1) console.log(`→ Waiting for MySQL (${cfg().host}:${cfg().port})... (is the server starting?)`);
        await sleep(delayMs);
      } else {
        break; /* auth / access errors — retry da faida nahi */
      }
    }
  }
  const hint =
    lastErr && lastErr.code === 'ECONNREFUSED'
      ? [
          '',
          'MySQL server chal nahi reha. Ik vaar start/auto-enable karo:',
          '  Windows : net start MySQL80        (Admin CMD; install te default auto-start hunda hai)',
          '  Mac     : brew services start mysql (Homebrew — login te auto-start register ho janda)',
          '  Linux   : sudo systemctl enable --now mysql',
          'Iton baad laptop boot te MySQL apne aap uthega — dubara kade nahi chalana painda.',
        ].join('\n')
      : lastErr && (lastErr.code === 'ER_ACCESS_DENIED_ERROR' || /Access denied/i.test(lastErr.message))
      ? '\nCheck backend/.env for DB_USER / DB_PASSWORD — MySQL rejected credentials.'
      : '';
  const err = new Error(`MySQL connect fail: ${lastErr ? lastErr.message : 'unknown'}${hint}`);
  err.cause = lastErr;
  throw err;
}

async function applySchemaIfMissing(conn, log) {
  const [tables] = await conn.query('SHOW TABLES');
  if (tables.length > 0) return false;
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  log('→ Tables created (schema.sql)');
  return true;
}

async function seedIfEmpty(conn, mode, log) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) return false;
  if (mode === 'off') {
    log('→ SEED_MODE=off — database is empty but no seeding will be performed (DBA-managed)');
    return false;
  }
  await essentialData(conn);
  log(`→ Essential data seeded (admin: ${process.env.ADMIN_EMAIL || 'admin@chaupal.com'}, taxonomy, settings, WP 301s)`);
  if (mode === 'demo') {
    await dummyData(conn);
    log('→ Dummy demo data seeded (posts, quiz, poll, rails, campaigns, 3 demo users — password Chaupal@123)');
  }
  return true;
}

/* Server boot te — idempotent, kade destructive nahi */
async function ensureDatabase({ log = console.log } = {}) {
  const mode = seedMode();
  const conn = await connectWithRetry();
  try {
    if (mode === 'off') {
      /* Sirf verify — DB exist karda te reachable hai */
      await conn.query(`USE \`${DB()}\``);
      log(`→ DB "${DB()}" connected (SEED_MODE=off — no auto-create)`);
      return { mode, created: false, seeded: false };
    }
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB()}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${DB()}\``);
    const created = await applySchemaIfMissing(conn, log);
    const seeded = await seedIfEmpty(conn, mode, log);
    if (!created && !seeded) log(`→ DB "${DB()}" ready (pehla ton seeded — kuchh nahi badleya)`);
    return { mode, created, seeded };
  } finally {
    await conn.end();
  }
}

/* CLI reset — DROP + fresh (destructive, sirf jaan-bujh ke) */
async function resetDatabase(mode, { log = console.log } = {}) {
  const conn = await connectWithRetry();
  try {
    log(`→ Database "${DB()}" DROP + fresh ${mode} seed...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${DB()}\`; CREATE DATABASE \`${DB()}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE \`${DB()}\`;`);
    await applySchemaIfMissing(conn, log);
    await essentialData(conn);
    log('→ Essential data seeded');
    if (mode === 'demo') {
      await dummyData(conn);
      log('→ Dummy demo data seeded');
    }
  } finally {
    await conn.end();
  }
}

module.exports = { ensureDatabase, resetDatabase, seedMode };
