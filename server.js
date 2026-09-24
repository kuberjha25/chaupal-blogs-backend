require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

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
app.use('/api/admin/posts', require('./src/routes/posts'));
app.use('/api/admin/media', require('./src/routes/media'));
app.use('/api/admin', require('./src/routes/content'));
app.use('/api/admin', require('./src/routes/growth'));
app.use('/api/admin', require('./src/routes/core'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

/* Central error handler */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
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
  app.listen(PORT, () => {
    console.log(`Chaupal Te Charcha API chal rahi hai → http://localhost:${PORT}  (SEED_MODE=${seedMode()})`);
  });
})();
