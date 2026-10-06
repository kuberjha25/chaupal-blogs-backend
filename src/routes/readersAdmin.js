/* Staff side: readers list/activate + web push notifications (permissions "readers", "notify"). */
const router = require('express').Router();
const webpush = require('web-push');
const { q } = require('../db');
const { a, parseActive } = require('../utils');
const { requireAuth, requirePerm } = require('../middleware/auth');

router.use(requireAuth);

/* ---------------- READERS ---------------- */
router.get(
  '/readers',
  requirePerm('readers'),
  a(async (req, res) => {
    const int = (v, def) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : def;
    };
    const limit = Math.min(Math.max(int(req.query.limit, 25), 1), 100);
    const page = Math.min(Math.max(int(req.query.page, 1), 1), 100000);
    /* "q" = "search" da alias */
    const search = String(req.query.search || req.query.q || '').trim().slice(0, 120);

    let where = '1=1';
    const params = [];
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      where += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(like, like);
    }
    const [rows, [{ total }]] = await Promise.all([
      q(
        `SELECT id, name, email, is_active, notif_status, created_at, last_login_at, email_verified_at
         FROM readers WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      ),
      q(`SELECT COUNT(*) AS total FROM readers WHERE ${where}`, params),
    ]);
    res.json({
      readers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        verified: !!r.email_verified_at,
        is_active: r.is_active,
        notif_status: r.notif_status,
        created_at: r.created_at,
        last_login_at: r.last_login_at,
      })),
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      total,
    });
  })
);

/* Admin only: "readers" + "users" (users permission sirf admin kol) */
router.patch(
  '/readers/:id',
  requirePerm('readers'),
  requirePerm('users'),
  a(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Galat reader id' });
    const active = parseActive((req.body || {}).is_active);
    if (active === null) return res.status(400).json({ error: 'is_active true/false hona chahida' });
    const r = await q('UPDATE readers SET is_active = ? WHERE id = ?', [active, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Reader nahi mila' });
    /* Inactive → saare sessions khatam, turant logout */
    if (!active) await q('DELETE FROM reader_sessions WHERE reader_id = ?', [id]);
    res.json({ ok: true });
  })
);

/* ---------------- NOTIFICATIONS ---------------- */
/* Teeno env hon te web-push unhan nu valid manne (subject mailto:/https:, key format) — nahi ta null.
   Galat key naal har subscription "failed" gin hundi, isliye pehla hi rok do. */
const vapid = () => {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (e) {
    console.error(`[push] VAPID env invalid: ${e.message}`);
    return null;
  }
  return { publicKey, privateKey, subject };
};

/* "/..." (par "//host" nahi) ya SITE_URL wale origin da https/http link */
function cleanUrl(v) {
  if (typeof v !== 'string') return null;
  const url = v.trim();
  if (!url || url.length > 300) return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url;
  try {
    const site = new URL(process.env.SITE_URL || '');
    const u = new URL(url);
    return u.origin === site.origin ? url : null;
  } catch (e) {
    return null;
  }
}

const SEND_CONCURRENCY = 10;
const TTL_SECONDS = 24 * 60 * 60;

/* Ik subscription te bhejo; 404/410 = browser ne subscription khatam kar ditti → delete */
async function sendOne(sub, payload, details) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: TTL_SECONDS, vapidDetails: details }
    );
    await q('UPDATE push_subscriptions SET last_success_at = NOW() WHERE id = ?', [sub.id]);
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
      await q('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
    } else {
      await q('UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ?', [sub.id]);
    }
    return false;
  }
}

router.post(
  '/notifications',
  requirePerm('notify'),
  a(async (req, res) => {
    const keys = vapid();
    if (!keys) return res.status(503).json({ error: 'Push is not configured' });
    const b = req.body || {};
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    /* "message" = "body" da alias; dono hon ta body */
    const rawBody = b.body !== undefined ? b.body : b.message;
    const body = typeof rawBody === 'string' ? rawBody.trim() : '';
    const url = cleanUrl(b.url);
    const audience = b.audience === undefined || b.audience === null || b.audience === '' ? 'all_granted' : b.audience;
    if (!title || title.length > 65) return res.status(400).json({ error: 'Title 1 to 65 characters hona chahida' });
    if (!body || body.length > 150) return res.status(400).json({ error: 'Body 1 to 150 characters hona chahida' });
    if (!url) return res.status(400).json({ error: 'URL "/" ton shuru hove ya SITE_URL te hove' });
    if (audience !== 'all_granted') return res.status(400).json({ error: 'Audience all_granted hona chahida' });

    const subs = await q(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps JOIN readers r ON r.id = ps.reader_id
       WHERE r.notif_status = 'granted' AND r.is_active = 1 AND r.email_verified_at IS NOT NULL`
    );
    const payload = JSON.stringify({ title, body, url });
    const details = { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey };

    /* 10 workers, ik queue */
    let next = 0;
    let sent = 0;
    let failed = 0;
    const worker = async () => {
      while (next < subs.length) {
        const sub = subs[next++];
        if (await sendOne(sub, payload, details)) sent += 1;
        else failed += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, subs.length) }, worker));

    await q(
      `INSERT INTO notifications (title, body, url, created_by, audience, target_count, sent_count, failed_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, body, url, req.user.id, audience, subs.length, sent, failed]
    );
    res.json({ ok: true, target: subs.length, sent, failed });
  })
);

router.get(
  '/notifications',
  requirePerm('notify'),
  a(async (req, res) => {
    const [rows, [{ granted }]] = await Promise.all([
      q(
        `SELECT n.id, n.title, n.body, n.url, n.created_at, u.name AS created_by_name,
                n.target_count, n.sent_count, n.failed_count, n.audience, n.created_by
         FROM notifications n LEFT JOIN users u ON u.id = n.created_by
         ORDER BY n.id DESC LIMIT 50`
      ),
      /* Kinne readers tak abhi bhej sakde haan: active + granted + ghatt ton ghatt ik subscription */
      q(
        `SELECT COUNT(*) AS granted FROM readers r
         WHERE r.is_active = 1 AND r.notif_status = 'granted'
           AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.reader_id = r.id)`
      ),
    ]);
    res.json({ notifications: rows, granted });
  })
);

module.exports = router;
