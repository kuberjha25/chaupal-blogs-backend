const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { a } = require('../utils');
const { requireAuth, requirePerm, isOwnOnly, PERMS } = require('../middleware/auth');

router.use(requireAuth);

/* ---------------- DASHBOARD ---------------- */
router.get(
  '/stats',
  requirePerm('dashboard'),
  a(async (req, res) => {
    const ownWhere = isOwnOnly(req) ? 'WHERE author_id = ?' : '';
    const ownParams = isOwnOnly(req) ? [req.user.id] : [];

    const [totals, byStatus, week, subs, recent, seoMissing, liveCampaign] = await Promise.all([
      q(`SELECT COALESCE(SUM(views),0) AS views, COUNT(*) AS posts FROM posts ${ownWhere}`, ownParams),
      q(`SELECT status, COUNT(*) AS n FROM posts ${ownWhere} GROUP BY status`, ownParams),
      q('SELECT day_label, views FROM daily_stats ORDER BY id'),
      q('SELECT COUNT(*) AS n FROM subscribers'),
      q(
        `SELECT p.id, p.title, p.status, p.updated_at FROM posts p ${ownWhere.replace('author_id', 'p.author_id')}
         ORDER BY p.updated_at DESC LIMIT 4`,
        ownParams
      ),
      q(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND (seo_description = '' OR seo_description IS NULL)`),
      q(`SELECT name, clicks FROM campaigns WHERE status = 'live' ORDER BY id DESC LIMIT 1`),
    ]);

    const pending = await q(
      `SELECT COUNT(*) AS n FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.status = 'pending' ${isOwnOnly(req) ? 'AND p.author_id = ?' : ''}`,
      ownParams
    );

    const statusMap = {};
    byStatus.forEach((r) => (statusMap[r.status] = r.n));

    res.json({
      views: totals[0].views,
      posts: totals[0].posts,
      byStatus: statusMap,
      week,
      subscribers: subs[0].n,
      avgRead: '3:42',
      recent,
      seoMissing: seoMissing[0].n,
      pendingComments: pending[0].n,
      liveCampaign: liveCampaign[0] || null,
      ownOnly: isOwnOnly(req),
    });
  })
);

/* ---------------- USERS (admin only) ---------------- */
router.get(
  '/users',
  requirePerm('users'),
  a(async (req, res) => {
    const rows = await q('SELECT id, name, email, role, last_active, created_at FROM users ORDER BY id');
    res.json({ users: rows, matrix: PERMS });
  })
);

router.post(
  '/users',
  requirePerm('users'),
  a(async (req, res) => {
    const { name, email, role, password } = req.body || {};
    if (!name || !email || !PERMS[role]) return res.status(400).json({ error: 'Name, email te valid role chahida' });
    const hash = bcrypt.hashSync(password || 'Chaupal@123', 10);
    await q('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)', [
      name, email.toLowerCase().trim(), role, hash,
    ]);
    res.json({ ok: true, tempPassword: password ? undefined : 'Chaupal@123' });
  })
);

router.patch(
  '/users/:id',
  requirePerm('users'),
  a(async (req, res) => {
    const { role } = req.body || {};
    if (!PERMS[role]) return res.status(400).json({ error: 'Valid role chahida' });
    await q('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ ok: true });
  })
);

router.delete(
  '/users/:id',
  requirePerm('users'),
  a(async (req, res) => {
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Apne aap nu delete nahi kar sakde' });
    await q('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

/* ---------------- SETTINGS ---------------- */
router.get(
  '/settings',
  requirePerm('settings'),
  a(async (req, res) => {
    const rows = await q('SELECT skey, svalue FROM settings');
    const out = {};
    rows.forEach((r) => {
      try {
        out[r.skey] = JSON.parse(r.svalue);
      } catch (e) {
        out[r.skey] = r.svalue;
      }
    });
    res.json({ settings: out });
  })
);

router.put(
  '/settings',
  requirePerm('settings'),
  a(async (req, res) => {
    const entries = Object.entries(req.body || {});
    for (const [k, v] of entries) {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      await q(
        'INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
        [k, val]
      );
    }
    res.json({ ok: true });
  })
);

module.exports = router;
