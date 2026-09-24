const router = require('express').Router();
const { q } = require('../db');
const { a } = require('../utils');
const { requireAuth, requirePerm, isOwnOnly } = require('../middleware/auth');

router.use(requireAuth);

/* ---------------- TAXONOMY (editor dropdowns) ---------------- */
router.get(
  '/taxonomy',
  requirePerm('edit-content,edit-meta'),
  a(async (req, res) => {
    const cats = await q('SELECT id, name, slug, kind FROM categories ORDER BY kind, id');
    res.json({
      bolis: cats.filter((c) => c.kind === 'boli'),
      categories: cats.filter((c) => c.kind === 'category'),
    });
  })
);

/* ---------------- QUIZZES ---------------- */
router.get(
  '/quizzes',
  requirePerm('playful'),
  a(async (req, res) => {
    const rows = await q('SELECT id, title, status, plays, updated_at FROM quizzes ORDER BY id DESC');
    res.json({ quizzes: rows });
  })
);

router.patch(
  '/quizzes/:id',
  requirePerm('edit-content,utm'),
  a(async (req, res) => {
    const status = (req.body || {}).status === 'live' ? 'live' : 'ended';
    await q('UPDATE quizzes SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, status });
  })
);

/* ---------------- POLLS ---------------- */
router.get(
  '/polls',
  requirePerm('playful'),
  a(async (req, res) => {
    const polls = await q('SELECT * FROM polls ORDER BY id DESC');
    const opts = await q('SELECT * FROM poll_options ORDER BY id');
    res.json({
      polls: polls.map((p) => ({ ...p, options: opts.filter((o) => o.poll_id === p.id) })),
    });
  })
);

router.patch(
  '/polls/:id',
  requirePerm('edit-content,utm'),
  a(async (req, res) => {
    const status = (req.body || {}).status === 'live' ? 'live' : 'ended';
    await q('UPDATE polls SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, status });
  })
);

/* ---------------- COMMENTS MODERATION ---------------- */
router.get(
  '/comments',
  requirePerm('approve'),
  a(async (req, res) => {
    const params = [];
    let where = '1=1';
    if (isOwnOnly(req)) {
      where += ' AND p.author_id = ?';
      params.push(req.user.id);
    }
    const rows = await q(
      `SELECT c.id, c.author_name, c.body, c.status, c.created_at, p.title AS post_title, p.slug AS post_slug
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE ${where}
       ORDER BY c.created_at DESC LIMIT 100`,
      params
    );
    res.json({ comments: rows, ownOnly: isOwnOnly(req) });
  })
);

router.patch(
  '/comments/:id',
  requirePerm('approve'),
  a(async (req, res) => {
    const status = ['approved', 'spam', 'pending'].includes((req.body || {}).status)
      ? req.body.status
      : 'pending';
    if (isOwnOnly(req)) {
      const own = await q(
        `SELECT c.id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND p.author_id = ?`,
        [req.params.id, req.user.id]
      );
      if (!own[0]) return res.status(403).json({ error: 'Eh comment tuhade post te nahi hai' });
    }
    await q('UPDATE comments SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, status });
  })
);

module.exports = router;
