const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { q, tx } = require('../db');
const { a, EMAIL_RE, parseActive } = require('../utils');
const { requireAuth, requirePerm, isOwnOnly, PERMS, ROLES } = require('../middleware/auth');

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
/* 10+ characters, at least one letter and one digit.
   bcrypt silently truncates after 72 bytes, hence the upper limit too. */
function passwordError(pw) {
  if (typeof pw !== 'string' || !pw) return 'Password is required';
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return 'Password must be at least 10 characters with at least one letter and one digit';
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'Password cannot be longer than 72 bytes';
  return null;
}

function cleanName(v) {
  const name = typeof v === 'string' ? v.trim() : '';
  return name && name.length <= 80 ? name : null;
}

/* Lock all active admins (always in the same order) — so two concurrent demotions can't both pass */
async function lockActiveAdmins(conn) {
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id FOR UPDATE"
  );
  return rows.map((r) => r.id);
}

router.get(
  '/users',
  requirePerm('users'),
  a(async (req, res) => {
    const rows = await q('SELECT id, name, email, role, is_active, last_active, created_at FROM users ORDER BY id');
    res.json({ users: rows, matrix: PERMS });
  })
);

router.post(
  '/users',
  requirePerm('users'),
  a(async (req, res) => {
    const b = req.body || {};
    const name = cleanName(b.name);
    const email = typeof b.email === 'string' ? b.email.toLowerCase().trim() : '';
    if (!name) return res.status(400).json({ error: 'Name is required (max 80 characters)' });
    if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: 'A valid email is required' });
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: `Role must be one of ${ROLES.join(', ')}` });
    const pwErr = passwordError(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const dup = await q('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (dup[0]) return res.status(409).json({ error: 'A user with this email already exists' });

    const hash = await bcrypt.hash(b.password, 10);
    try {
      const r = await q('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)', [
        name, email, b.role, hash,
      ]);
      res.json({ ok: true, id: r.insertId });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A user with this email already exists' });
      throw e;
    }
  })
);

/* name, role, is_active, password — only what is sent changes. PATCH is for the old frontend (role only). */
const updateUser = a(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
  const b = req.body || {};
  const set = {};

  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: 'Name is required (max 80 characters)' });
    set.name = name;
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: `Role must be one of ${ROLES.join(', ')}` });
    set.role = b.role;
  }
  if (b.is_active !== undefined) {
    const v = parseActive(b.is_active);
    if (v === null) return res.status(400).json({ error: 'is_active must be true/false' });
    set.is_active = v;
  }
  if (b.password !== undefined) {
    const pwErr = passwordError(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    set.password_hash = await bcrypt.hash(b.password, 10);
  }
  const cols = Object.keys(set);
  if (!cols.length) return res.status(400).json({ error: 'Nothing was sent to update' });

  const demotes = (set.role !== undefined && set.role !== 'admin') || set.is_active === 0;
  if (id === req.user.id && demotes)
    return res.status(400).json({ error: 'An admin cannot demote or deactivate themselves' });

  const result = await tx(async (conn) => {
    const admins = await lockActiveAdmins(conn);
    const [rows] = await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) return { status: 404, error: 'User not found' };
    if (demotes && admins.includes(id) && admins.length <= 1)
      return { status: 400, error: 'The last active admin cannot be demoted or deactivated' };
    await conn.query(`UPDATE users SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [
      ...cols.map((c) => set[c]),
      id,
    ]);
    return null;
  });
  if (result) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

router.put('/users/:id', requirePerm('users'), updateUser);
router.patch('/users/:id', requirePerm('users'), updateUser);

router.delete(
  '/users/:id',
  requirePerm('users'),
  a(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id)
      return res.status(400).json({ error: 'You cannot delete yourself' });
    const blocked = await tx(async (conn) => {
      const admins = await lockActiveAdmins(conn);
      if (admins.includes(id) && admins.length <= 1) return true;
      await conn.query('DELETE FROM users WHERE id = ?', [id]);
      return false;
    });
    if (blocked) return res.status(400).json({ error: 'The last active admin cannot be deleted' });
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
