/* Reader (site visitor) sessions — completely separate from the staff JWT.
   Cookie "ctc_reader" holds a random 32-byte token; the DB stores only its SHA-256. 30 days, sliding. */
const crypto = require('crypto');
const { q } = require('../db');

const COOKIE = 'ctc_reader';
const SESSION_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookieOpts(req) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure };
}

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE, token, { ...cookieOpts(req), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE, cookieOpts(req));
}

/* If conn is given, runs inside that transaction (password reset); otherwise uses the pool */
async function createSession(req, res, readerId, conn) {
  const run = conn ? (sql, p) => conn.query(sql, p) : (sql, p) => q(sql, p);
  const token = crypto.randomBytes(32).toString('base64url');
  await run('DELETE FROM reader_sessions WHERE reader_id = ? AND expires_at < NOW()', [readerId]);
  await run(
    `INSERT INTO reader_sessions (reader_id, token_hash, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, NOW() + INTERVAL ${SESSION_DAYS} DAY, NOW(), ?, ?)`,
    [readerId, sha256(token), String(req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 200)]
  );
  setSessionCookie(req, res, token);
}

/* req.reader = {id, name, notif_status} or null. Never returns 401. */
async function loadReader(req, res, next) {
  req.reader = null;
  const token = readCookie(req, COOKIE);
  if (!token) return next();
  try {
    if (token.length > 100) {
      clearSessionCookie(req, res);
      return next();
    }
    const rows = await q(
      `SELECT s.id AS session_id, (s.last_seen_at IS NULL OR s.last_seen_at < NOW() - INTERVAL 1 HOUR) AS stale,
              r.id, r.name, r.notif_status
       FROM reader_sessions s JOIN readers r ON r.id = s.reader_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND r.is_active = 1 AND r.email_verified_at IS NOT NULL
       LIMIT 1`,
      [sha256(token)]
    );
    const r = rows[0];
    if (!r) {
      clearSessionCookie(req, res);
      return next();
    }
    req.reader = { id: r.id, name: r.name, notif_status: r.notif_status };
    req.readerSessionId = r.session_id;
    /* Sliding expiry — not on every request, once an hour */
    if (Number(r.stale)) {
      await q(
        `UPDATE reader_sessions SET last_seen_at = NOW(), expires_at = NOW() + INTERVAL ${SESSION_DAYS} DAY WHERE id = ?`,
        [r.session_id]
      );
      setSessionCookie(req, res, token);
    }
    next();
  } catch (e) {
    next(e);
  }
}

/* Use after loadReader */
const requireReader = (message = 'Please log in') => (req, res, next) =>
  req.reader ? next() : res.status(401).json({ error: message });

/* CSRF guard on every POST/PUT/PATCH/DELETE: custom header "X-CTC: 1" (cannot be sent cross-site
   without a preflight), JSON content-type, and the Origin host (if present) = request Host. */
function sameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const forbidden = () => res.status(403).json({ error: 'Forbidden' });
  if (req.get('x-ctc') !== '1') return forbidden();
  if (!/^application\/json\s*(;|$)/i.test(req.get('content-type') || '')) return forbidden();
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch (e) {
      return forbidden();
    }
    /* trust proxy is on: nginx / the Next proxy send the original host in X-Forwarded-Host */
    const allowed = [req.get('host'), ...String(req.get('x-forwarded-host') || '').split(',')]
      .map((h) => String(h || '').trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(host)) return forbidden();
  }
  next();
}

module.exports = {
  COOKIE,
  sha256,
  readCookie,
  createSession,
  clearSessionCookie,
  loadReader,
  requireReader,
  sameOrigin,
};
