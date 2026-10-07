/* /api/reader — site de paathak (readers). Staff (users table, JWT, roles) ton bilkul alag.
   Har write: sameOrigin (X-CTC + JSON + Origin) + rate limits. Email registered hai ya nahi, eh kade leak nahi karna:
   signup/start te password/forgot same jawab dinde ne, te lookup + code + mail response ton BAAD background ch hunde ne. */
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { q, tx } = require('../db');
const { a, EMAIL_RE } = require('../utils');
const mailer = require('../mailer');
const { jwtSecret } = require('../middleware/auth');
const {
  sha256, readCookie, COOKIE, createSession, clearSessionCookie, loadReader, requireReader, sameOrigin,
} = require('../middleware/reader');
const {
  readerLoginIpLimiter, readerLoginEmailLimiter, readerWriteLimiter, otpIpLimiter,
} = require('../middleware/rateLimit');

const BCRYPT_COST = 11;
const OTP_MAX_ATTEMPTS = 5;
const SIGNUP_MSG = 'If this email can be registered, we have sent a code.';
const FORGOT_MSG = 'If an account exists for this email, we have sent a code.';
const BAD_CODE = 'Invalid or expired code';

router.use(sameOrigin);
router.use((req, res, next) => (req.method === 'GET' ? next() : readerWriteLimiter(req, res, next)));

/* ---------------- validation ---------------- */
const cleanEmail = (v) => {
  const e = typeof v === 'string' ? v.toLowerCase().trim() : '';
  return EMAIL_RE.test(e) && e.length <= 120 ? e : null;
};

/* Control characters te < > hata ke, 2-60 characters */
const cleanName = (v) => {
  const n = typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F-\u009F<>]/g, '').trim() : '';
  const len = Array.from(n).length;
  return len >= 2 && len <= 60 ? n : null;
};

function passwordError(pw) {
  if (typeof pw !== 'string') return 'Password is required';
  const bytes = Buffer.byteLength(pw, 'utf8');
  if (bytes < 8 || bytes > 72 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return 'Password must be 8 to 72 characters with at least one letter and one digit';
  return null;
}

const isCode = (v) => typeof v === 'string' && /^\d{6}$/.test(v);

/* User-not-found te bhi bcrypt chale, taaki login timing ton email da pata na lagge */
let dummyHash;
const dummy = () => dummyHash || (dummyHash = bcrypt.hashSync('timing-dummy-password-1', BCRYPT_COST));

const publicReader = (r) => ({ id: r.id, name: r.name, notif_status: r.notif_status });

/* Response ton baad chalan wala kam. Error log ch email/SQL message nahi (SES / dup-key messages vich email hundi).
   Client nu pehla hi generic jawab mil chukka — fail hove ta bhi email enumeration nahi. */
function background(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch((e) => {
      if (e && e.logged) return; /* mailer ne "[mail] send failed: ..." pehla hi likh ditta */
      const detail = e && e.name === 'MailConfigError' ? e.message : (e && (e.code || e.name)) || 'error';
      console.error(`[reader] ${label} failed: ${detail}`);
    });
}

/* ---------------- OTP ---------------- */
const otpHash = (purpose, email, code) =>
  crypto.createHmac('sha256', jwtSecret()).update(`${purpose}:${email}:${code}`).digest('hex');

/* Naya code: 60s cooldown, 5 per email per hour. Limit lagge ta chup-chaap kuchh nahi (429 email da status leak karda).
   Reader row lock karke — do parallel requests limits paar na kar sakan. Pehle wale codes invalid. */
async function issueOtp(email, purpose, ip) {
  const code = await tx(async (conn) => {
    const [locked] = await conn.query('SELECT id FROM readers WHERE email = ? FOR UPDATE', [email]);
    if (!locked[0]) return null;
    await conn.query('DELETE FROM reader_otps WHERE email = ? AND created_at < NOW() - INTERVAL 1 DAY', [email]);
    const [[lim]] = await conn.query(
      `SELECT COUNT(*) AS hour_count,
              COALESCE(SUM(created_at > NOW() - INTERVAL 60 SECOND), 0) AS recent_count
       FROM reader_otps WHERE email = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
      [email]
    );
    if (Number(lim.recent_count) > 0 || Number(lim.hour_count) >= 5) return null;
    const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await conn.query(
      'UPDATE reader_otps SET used_at = NOW() WHERE email = ? AND purpose = ? AND used_at IS NULL',
      [email, purpose]
    );
    await conn.query(
      `INSERT INTO reader_otps (email, purpose, code_hash, expires_at, attempts, ip)
       VALUES (?, ?, ?, NOW() + INTERVAL 10 MINUTE, 0, ?)`,
      [email, purpose, otpHash(purpose, email, c), String(ip || '').slice(0, 64)]
    );
    return c;
  });
  if (!code) return;
  await mailer.sendMail({ to: email, ...mailer.otpEmail(code, purpose) });
}

/* Single use, 10 min, 5 galat attempts te code khatam */
async function consumeOtp(email, purpose, code) {
  return tx(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, code_hash, attempts FROM reader_otps
       WHERE email = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [email, purpose]
    );
    const row = rows[0];
    if (!row) return false;
    const want = Buffer.from(row.code_hash, 'hex');
    const got = Buffer.from(otpHash(purpose, email, code), 'hex');
    if (want.length === got.length && crypto.timingSafeEqual(want, got)) {
      await conn.query('UPDATE reader_otps SET used_at = NOW() WHERE id = ?', [row.id]);
      return true;
    }
    const attempts = Number(row.attempts) + 1;
    await conn.query('UPDATE reader_otps SET attempts = ? WHERE id = ?', [attempts, row.id]);
    if (attempts >= OTP_MAX_ATTEMPTS) await conn.query('UPDATE reader_otps SET used_at = NOW() WHERE id = ?', [row.id]);
    return false;
  });
}

const mailNotReady = (res) => res.status(503).json({ error: 'Email is not configured' });

/* ---------------- SIGNUP ---------------- */
router.post(
  '/signup/start',
  otpIpLimiter,
  a(async (req, res) => {
    if (!mailer.status().configured) return mailNotReady(res);
    const b = req.body || {};
    const name = cleanName(b.name);
    const email = cleanEmail(b.email);
    if (!name) return res.status(400).json({ error: 'Name must be 2 to 60 characters' });
    if (!email) return res.status(400).json({ error: 'Please enter a valid email' });
    const pwErr = passwordError(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const hash = await bcrypt.hash(b.password, BCRYPT_COST);
    const ip = req.ip;
    res.json({ ok: true, message: SIGNUP_MSG });

    background('signup', async () => {
      /* Verified row nu kade nahi badalna; unverified row nu naya name/password */
      await q(
        `INSERT INTO readers (name, email, password_hash) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = IF(email_verified_at IS NULL, VALUES(name), name),
           password_hash = IF(email_verified_at IS NULL, VALUES(password_hash), password_hash)`,
        [name, email, hash]
      );
      const rows = await q('SELECT email_verified_at, is_active FROM readers WHERE email = ?', [email]);
      const r = rows[0];
      if (!r || r.email_verified_at || !r.is_active) return;
      await issueOtp(email, 'signup', ip);
    });
  })
);

router.post(
  '/signup/verify',
  a(async (req, res) => {
    const b = req.body || {};
    const email = cleanEmail(b.email);
    if (!email || !isCode(b.code)) return res.status(400).json({ error: BAD_CODE });
    if (!(await consumeOtp(email, 'signup', b.code))) return res.status(400).json({ error: BAD_CODE });

    const rows = await q('SELECT id, name, notif_status, is_active FROM readers WHERE email = ?', [email]);
    const r = rows[0];
    if (!r || !r.is_active) return res.status(400).json({ error: BAD_CODE });
    await q(
      'UPDATE readers SET email_verified_at = COALESCE(email_verified_at, NOW()), last_login_at = NOW() WHERE id = ?',
      [r.id]
    );
    await createSession(req, res, r.id);
    res.json({ ok: true, reader: publicReader(r) });
  })
);

/* ---------------- LOGIN / LOGOUT / ME ---------------- */
router.post(
  '/login',
  readerLoginIpLimiter,
  readerLoginEmailLimiter,
  a(async (req, res) => {
    const b = req.body || {};
    const email = cleanEmail(b.email);
    const password = typeof b.password === 'string' ? b.password : '';
    const rows = email
      ? await q(
          'SELECT id, name, notif_status, password_hash, is_active, email_verified_at FROM readers WHERE email = ?',
          [email]
        )
      : [];
    const r = rows[0];
    const ok = await bcrypt.compare(password, r ? r.password_hash : dummy());
    if (!r || !ok || !r.is_active || !r.email_verified_at)
      return res.status(401).json({ error: 'Wrong email or password' });

    await q('UPDATE readers SET last_login_at = NOW() WHERE id = ?', [r.id]);
    await createSession(req, res, r.id);
    res.json({ ok: true, reader: publicReader(r) });
  })
);

router.post(
  '/logout',
  a(async (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) await q('DELETE FROM reader_sessions WHERE token_hash = ?', [sha256(token)]);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  })
);

/* Kade 401 nahi — logged-out pages console errors na dikhaun */
router.get('/me', loadReader, (req, res) => res.json({ reader: req.reader || null }));

/* ---------------- PASSWORD ---------------- */
router.post(
  '/password/forgot',
  otpIpLimiter,
  a(async (req, res) => {
    if (!mailer.status().configured) return mailNotReady(res);
    const email = cleanEmail((req.body || {}).email);
    if (!email) return res.status(400).json({ error: 'Please enter a valid email' });
    const ip = req.ip;
    res.json({ ok: true, message: FORGOT_MSG });

    background('forgot', async () => {
      const rows = await q(
        'SELECT id FROM readers WHERE email = ? AND email_verified_at IS NOT NULL AND is_active = 1',
        [email]
      );
      if (rows[0]) await issueOtp(email, 'reset', ip);
    });
  })
);

router.post(
  '/password/reset',
  a(async (req, res) => {
    const b = req.body || {};
    const email = cleanEmail(b.email);
    if (!email || !isCode(b.code)) return res.status(400).json({ error: BAD_CODE });
    /* "password" alias bhi chalda; dono hon ta new_password */
    const newPassword = b.new_password !== undefined ? b.new_password : b.password;
    /* Password pehla check — galat password te code zaya na hove */
    const pwErr = passwordError(newPassword);
    if (pwErr) return res.status(400).json({ error: pwErr });
    if (!(await consumeOtp(email, 'reset', b.code))) return res.status(400).json({ error: BAD_CODE });

    const rows = await q(
      'SELECT id, name, notif_status FROM readers WHERE email = ? AND email_verified_at IS NOT NULL AND is_active = 1',
      [email]
    );
    const r = rows[0];
    if (!r) return res.status(400).json({ error: BAD_CODE });
    const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
    /* Password badle ta saare purane sessions khatam, phir ik naya */
    await tx(async (conn) => {
      await conn.query('UPDATE readers SET password_hash = ?, last_login_at = NOW() WHERE id = ?', [hash, r.id]);
      await conn.query('DELETE FROM reader_sessions WHERE reader_id = ?', [r.id]);
      await createSession(req, res, r.id, conn);
    });
    res.json({ ok: true, reader: publicReader(r) });
  })
);

/* ---------------- ACCOUNT DELETE ---------------- */
router.post(
  '/account/delete',
  loadReader,
  requireReader(),
  a(async (req, res) => {
    const password = typeof (req.body || {}).password === 'string' ? req.body.password : '';
    const rows = await q('SELECT email, password_hash FROM readers WHERE id = ?', [req.reader.id]);
    const r = rows[0];
    if (!r || !(await bcrypt.compare(password, r.password_hash)))
      return res.status(400).json({ error: 'Wrong password' });

    /* Comments rehnde ne, par naam "Deleted reader". Sessions + push subscriptions FK CASCADE naal jaande ne. */
    await tx(async (conn) => {
      await conn.query(
        "UPDATE comments SET reader_id = NULL, author_name = 'Deleted reader' WHERE reader_id = ?",
        [req.reader.id]
      );
      await conn.query('DELETE FROM reader_otps WHERE email = ?', [r.email]);
      await conn.query('DELETE FROM readers WHERE id = ?', [req.reader.id]);
    });
    clearSessionCookie(req, res);
    res.json({ ok: true });
  })
);

/* ---------------- WEB PUSH ---------------- */
/* Sirf asli browser push services — warna server kisi bhi URL te POST karega (SSRF, e.g. cloud metadata) */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

function validEndpoint(v) {
  if (typeof v !== 'string' || v.length > 1000) return null;
  let u;
  try {
    u = new URL(v);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? v : null;
}

const isKey = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9_\-=+/]+$/.test(v);
const MAX_SUBS_PER_READER = 10;

router.post(
  '/push/subscribe',
  loadReader,
  requireReader(),
  a(async (req, res) => {
    const sub = (req.body || {}).subscription || {};
    const endpoint = validEndpoint(sub.endpoint);
    const keys = sub.keys || {};
    if (!endpoint || !isKey(keys.p256dh, 200) || !isKey(keys.auth, 100))
      return res.status(400).json({ error: 'Invalid push subscription' });

    const id = req.reader.id;
    await q(
      `INSERT INTO push_subscriptions (reader_id, endpoint_hash, endpoint, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reader_id = VALUES(reader_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh),
         auth = VALUES(auth), user_agent = VALUES(user_agent), failed_count = 0`,
      [id, sha256(endpoint), endpoint, keys.p256dh, keys.auth, String(req.get('user-agent') || '').slice(0, 200)]
    );
    /* Ik reader de bahut saare devices — sirf navein 10 rakho */
    await q(
      `DELETE FROM push_subscriptions WHERE reader_id = ? AND id NOT IN (
         SELECT id FROM (SELECT id FROM push_subscriptions WHERE reader_id = ? ORDER BY id DESC LIMIT ${MAX_SUBS_PER_READER}) keep
       )`,
      [id, id]
    );
    await q("UPDATE readers SET notif_status = 'granted', notif_updated_at = NOW() WHERE id = ?", [id]);
    res.json({ ok: true, notif_status: 'granted' });
  })
);

router.post(
  '/push/status',
  loadReader,
  requireReader(),
  a(async (req, res) => {
    const status = (req.body || {}).status;
    if (!['denied', 'unknown'].includes(status)) return res.status(400).json({ error: 'Status must be denied or unknown' });
    await q('UPDATE readers SET notif_status = ?, notif_updated_at = NOW() WHERE id = ?', [status, req.reader.id]);
    res.json({ ok: true, notif_status: status });
  })
);

router.post(
  '/push/unsubscribe',
  loadReader,
  requireReader(),
  a(async (req, res) => {
    const endpoint = (req.body || {}).endpoint;
    if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Endpoint is required' });
    await q('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND reader_id = ?', [sha256(endpoint), req.reader.id]);
    await q("UPDATE readers SET notif_status = 'unknown', notif_updated_at = NOW() WHERE id = ?", [req.reader.id]);
    res.json({ ok: true, notif_status: 'unknown' });
  })
);

module.exports = router;
