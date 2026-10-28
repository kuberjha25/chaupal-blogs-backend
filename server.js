require('dotenv').config();

/* Production fail-fast: check the required env vars. Print only the variable NAME, never the value. */
if (process.env.NODE_ENV === 'production') {
  const bad = [];
  for (const k of ['JWT_SECRET', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[k]) bad.push(`${k} is missing`);
  }
  const s = process.env.JWT_SECRET;
  if (s && (s === 'dev-secret' || s === 'CHANGE_ME' || s.length < 32)) {
    bad.push('JWT_SECRET is a placeholder or shorter than 32 characters');
  }
  if (bad.length) {
    console.error('\nProduction env invalid — server did not start:\n  - ' + bad.join('\n  - ') + '\n');
    process.exit(1);
  }
}

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '4mb' }));

/* Uploaded webp images served statically. This line goes away with the S3 migration. */
app.use(
  '/uploads',
  express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads'), {
    maxAge: '30d',
    immutable: true,
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'chaupal-te-charcha-api' }));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/public', require('./src/routes/public'));
app.use('/api/reader', require('./src/routes/reader'));
app.use('/api/admin/posts', require('./src/routes/posts'));
app.use('/api/admin/media', require('./src/routes/media'));
app.use('/api/admin', require('./src/routes/content'));
app.use('/api/admin', require('./src/routes/growth'));
app.use('/api/admin', require('./src/routes/core'));
app.use('/api/admin', require('./src/routes/readersAdmin'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

/* Central error handler */
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  /* In production, never show 5xx details (SQL errors etc.) to the client */
  const hide = process.env.NODE_ENV === 'production' && status >= 500;
  res.status(status).json({ error: hide ? 'Server error' : err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

/* MERN-style boot: first ensure the DB automatically (create + schema + first-time seed),
   only then listen. If data already exists, bootstrap touches nothing. */
const { ensureDatabase, seedMode } = require('./database/bootstrap');

(async () => {
  try {
    await ensureDatabase();
  } catch (e) {
    console.error('\nDB bootstrap failed — server did not start.\n' + e.message + '\n');
    process.exit(1);
  }
  /* If the email config is wrong the server still runs; only reader signup/forgot return 503 */
  const mail = require('./src/mailer').status();
  if (!mail.configured)
    console.warn(
      `→ Reader email disabled (EMAIL_MODE=${mail.mode || 'unset'}): ${mail.reason}. Signup/forgot return 503.`
    );
  else console.log(`→ Reader email: ${mail.mode}`);
  if (!process.env.VAPID_PUBLIC_KEY) console.warn('→ Web push disabled: VAPID_* env not set (npm run vapid)');
  require('./src/notifier').start();
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`Chaupal Te Charcha API is running → http://localhost:${PORT}  (SEED_MODE=${seedMode()})`);
  });
})();
