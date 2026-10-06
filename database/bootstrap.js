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
const { essentialData, dummyData, assertAdminPassword } = require('./data');

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

/* ---------------- Migrations: idempotent + additive only ----------------
   schema.sql sirf khali DB te chalda hai, isliye naye columns/tables live DB te
   ethon aunde ne. Har boot te chalde ne; kuchh missing na hove ta chup. Existing rows nu kade nahi chhedde. */
async function ensureColumn(conn, table, column, ddl, log) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  if (rows.length) return false;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  log(`→ Migration: added column ${table}.${column}`);
  return true;
}

async function ensureTable(conn, name, createSql, log) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [name]
  );
  if (rows.length) return false;
  await conn.query(createSql); /* createSql = CREATE TABLE IF NOT EXISTS ... */
  log(`→ Migration: created table ${name}`);
  return true;
}

/* Column te FK alag-alag: je FK fail hove ta agli boot te dubara try (column pehla ton hon de bawajood) */
async function ensureForeignKey(conn, table, name, ddl, log) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
    [table, name]
  );
  if (rows.length) return false;
  await conn.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${ddl}`);
  log(`→ Migration: added foreign key ${table}.${name}`);
  return true;
}

/* Readers (site de paathak) — staff (users) ton bilkul alag. Order zaroori: readers pehla, FK baad ch. */
const READER_TABLES = [
  [
    'readers',
    `CREATE TABLE IF NOT EXISTS readers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      email_verified_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      notif_status ENUM('unknown','granted','denied') NOT NULL DEFAULT 'unknown',
      notif_updated_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME NULL
    )`,
  ],
  [
    'reader_otps',
    `CREATE TABLE IF NOT EXISTS reader_otps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(120) NOT NULL,
      purpose ENUM('signup','reset') NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts TINYINT NOT NULL DEFAULT 0,
      used_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip VARCHAR(64) NOT NULL DEFAULT '',
      KEY idx_otp_email (email, created_at)
    )`,
  ],
  [
    'reader_sessions',
    `CREATE TABLE IF NOT EXISTS reader_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reader_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME NULL,
      ip VARCHAR(64) NOT NULL DEFAULT '',
      user_agent VARCHAR(200) NOT NULL DEFAULT '',
      CONSTRAINT fk_rs_reader FOREIGN KEY (reader_id) REFERENCES readers(id) ON DELETE CASCADE
    )`,
  ],
  [
    'push_subscriptions',
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reader_id INT NOT NULL,
      endpoint_hash CHAR(64) NOT NULL UNIQUE,
      endpoint TEXT NOT NULL,
      p256dh VARCHAR(200) NOT NULL,
      auth VARCHAR(100) NOT NULL,
      user_agent VARCHAR(200) NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_success_at DATETIME NULL,
      failed_count INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_ps_reader FOREIGN KEY (reader_id) REFERENCES readers(id) ON DELETE CASCADE
    )`,
  ],
  [
    'notifications',
    `CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(80) NOT NULL,
      body VARCHAR(200) NOT NULL,
      url VARCHAR(300) NOT NULL,
      created_by INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      audience VARCHAR(30) NOT NULL,
      target_count INT NOT NULL DEFAULT 0,
      sent_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_notif_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
  ],
];

async function runMigrations(conn, log) {
  let changed = false;
  changed = (await ensureColumn(conn, 'users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1', log)) || changed;
  for (const [name, sql] of READER_TABLES) changed = (await ensureTable(conn, name, sql, log)) || changed;
  changed = (await ensureColumn(conn, 'comments', 'reader_id', 'INT NULL', log)) || changed;
  changed =
    (await ensureForeignKey(
      conn, 'comments', 'fk_c_reader',
      'FOREIGN KEY (reader_id) REFERENCES readers(id) ON DELETE SET NULL', log
    )) || changed;
  return changed;
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
    log('→ Dummy demo data seeded (posts, quiz, poll, rails, campaigns, 3 demo users)');
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
      /* Code in columns te depend karda hai, isliye additive migrations off mode me bhi */
      await runMigrations(conn, log);
      return { mode, created: false, seeded: false };
    }
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB()}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${DB()}\``);
    const created = await applySchemaIfMissing(conn, log);
    const migrated = await runMigrations(conn, log);
    const seeded = await seedIfEmpty(conn, mode, log);
    if (!created && !migrated && !seeded) log(`→ DB "${DB()}" ready (pehla ton seeded — kuchh nahi badleya)`);
    return { mode, created, seeded };
  } finally {
    await conn.end();
  }
}

/* CLI reset — DROP + fresh (destructive, sirf jaan-bujh ke) */
async function resetDatabase(mode, { log = console.log } = {}) {
  assertAdminPassword(); /* DROP se pehla check, taaki DB uda ke fail na ho */
  const conn = await connectWithRetry();
  try {
    log(`→ Database "${DB()}" DROP + fresh ${mode} seed...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${DB()}\`; CREATE DATABASE \`${DB()}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE \`${DB()}\`;`);
    await applySchemaIfMissing(conn, log);
    await runMigrations(conn, log);
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

module.exports = { ensureDatabase, resetDatabase, seedMode, ensureColumn, ensureTable, ensureForeignKey };
