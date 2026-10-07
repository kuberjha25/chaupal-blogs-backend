require('dotenv').config();

/* Production fail-fast: zaroori env vars check. Sirf variable NAME print karo, value kade nahi. */
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
    console.error('\nProduction env invalid — server start nahi hoya:\n  - ' + bad.join('\n  - ') + '\n');
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

/* Uploaded webp images served statically. S3 migration me ye line hat jayegi. */
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
  /* Production me 5xx details (SQL errors wagairah) client nu nahi dikhane */
  const hide = process.env.NODE_ENV === 'production' && status >= 500;
  res.status(status).json({ error: hide ? 'Server error' : err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

/* MERN-style boot: pehla DB apne aap ensure (create + schema + first-time seed),
   phir hi listen. Data pehla ton hai ta bootstrap kuchh nahi chhedta. */
const { ensureDatabase, seedMode } = require('./database/bootstrap');

(async () => {
  try {
    await ensureDatabase();
  } catch (e) {
    console.error('\nDB bootstrap fail — server start nahi hoya.\n' + e.message + '\n');
    process.exit(1);
  }
  /* Email config galat hove ta server fir bhi chalda; sirf reader signup/forgot 503 */
  const mail = require('./src/mailer').status();
  if (!mail.configured)
    console.warn(
      `→ Reader email disabled (EMAIL_MODE=${mail.mode || 'unset'}): ${mail.reason}. Signup/forgot return 503.`
    );
  else console.log(`→ Reader email: ${mail.mode}`);
  if (!process.env.VAPID_PUBLIC_KEY) console.warn('→ Web push disabled: VAPID_* env not set (npm run vapid)');
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`Chaupal Te Charcha API chal rahi hai → http://localhost:${PORT}  (SEED_MODE=${seedMode()})`);
  });
})();
