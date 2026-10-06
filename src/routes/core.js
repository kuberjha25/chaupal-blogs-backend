const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, q } = require('../db');
const { a } = require('../utils');
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* 10+ characters, ghatt ton ghatt ik letter te ik digit.
   bcrypt 72 bytes ton baad chup-chaap kat dinda hai, isliye upar di limit bhi. */
function passwordError(pw) {
  if (typeof pw !== 'string' || !pw) return 'Password chahida';
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return 'Password ghatt ton ghatt 10 characters da, ik letter te ik digit naal hona chahida';
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'Password 72 bytes ton lamba nahi ho sakda';
  return null;
}

function cleanName(v) {
  const name = typeof v === 'string' ? v.trim() : '';
  return name && name.length <= 80 ? name : null;
}

function parseActive(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  return null;
}

/* Saare active admins lock (hamesha ik hi order) — do concurrent demotions dono pass na ho jaan */
async function lockActiveAdmins(conn) {
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id FOR UPDATE"
  );
  return rows.map((r) => r.id);
}

async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
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
    if (!name) return res.status(400).json({ error: 'Name chahida (max 80 characters)' });
    if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: 'Sahi email chahida' });
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: `Role ${ROLES.join(', ')} vichon ik hona chahida` });
    const pwErr = passwordError(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const dup = await q('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (dup[0]) return res.status(409).json({ error: 'Is email naal user pehla ton hai' });

    const hash = await bcrypt.hash(b.password, 10);
    try {
      const r = await q('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)', [
        name, email, b.role, hash,
      ]);
      res.json({ ok: true, id: r.insertId });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Is email naal user pehla ton hai' });
      throw e;
    }
  })
);

/* name, role, is_active, password — jo bheja ohi badlega. PATCH purane frontend (sirf role) layi. */
const updateUser = a(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Galat user id' });
  const b = req.body || {};
  const set = {};

  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) return res.status(400).json({ error: 'Name chahida (max 80 characters)' });
    set.name = name;
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return res.status(400).json({ error: `Role ${ROLES.join(', ')} vichon ik hona chahida` });
    set.role = b.role;
  }
  if (b.is_active !== undefined) {
    const v = parseActive(b.is_active);
    if (v === null) return res.status(400).json({ error: 'is_active true/false hona chahida' });
    set.is_active = v;
  }
  if (b.password !== undefined) {
    const pwErr = passwordError(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    set.password_hash = await bcrypt.hash(b.password, 10);
  }
  const cols = Object.keys(set);
  if (!cols.length) return res.status(400).json({ error: 'Update karan layi kuchh nahi bheja' });

  const demotes = (set.role !== undefined && set.role !== 'admin') || set.is_active === 0;
  if (id === req.user.id && demotes)
    return res.status(400).json({ error: 'Admin apne aap nu demote ya deactivate nahi kar sakda' });

  const result = await inTransaction(async (conn) => {
    const admins = await lockActiveAdmins(conn);
    const [rows] = await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) return { status: 404, error: 'User nahi mila' };
    if (demotes && admins.includes(id) && admins.length <= 1)
      return { status: 400, error: 'Aakhri active admin nu demote ya deactivate nahi kar sakde' };
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
      return res.status(400).json({ error: 'Apne aap nu delete nahi kar sakde' });
    const blocked = await inTransaction(async (conn) => {
      const admins = await lockActiveAdmins(conn);
      if (admins.includes(id) && admins.length <= 1) return true;
      await conn.query('DELETE FROM users WHERE id = ?', [id]);
      return false;
    });
    if (blocked) return res.status(400).json({ error: 'Aakhri active admin nu delete nahi kar sakde' });
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
