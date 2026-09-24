const router = require('express').Router();
const { q } = require('../db');
const { a, slugify, cleanBody } = require('../utils');
const { requireAuth, requirePerm, isOwnOnly } = require('../middleware/auth');

router.use(requireAuth, requirePerm('posts,edit-content,edit-meta'));

async function uniqueSlug(base, ignoreId) {
  let s = slugify(base);
  let n = 1;
  /* jab tak same slug milta rahe, suffix badhao */
  while (true) {
    const rows = await q('SELECT id FROM posts WHERE slug = ? AND id != ? LIMIT 1', [s, ignoreId || 0]);
    if (!rows.length) return s;
    n += 1;
    s = `${slugify(base)}-${n}`;
  }
}

/* ---------------- LIST ---------------- */
router.get(
  '/',
  a(async (req, res) => {
    const params = [];
    let where = '1=1';
    if (req.query.status && req.query.status !== 'all') {
      where += ' AND p.status = ?';
      params.push(req.query.status);
    }
    if (isOwnOnly(req)) {
      where += ' AND p.author_id = ?';
      params.push(req.user.id);
    }
    const rows = await q(
      `SELECT p.id, p.title, p.slug, p.status, p.views, p.updated_at, p.published_at, p.scheduled_at,
              p.author_id, c.name AS category, b.name AS boli, u.name AS author
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories b ON b.id = p.boli_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE ${where}
       ORDER BY p.updated_at DESC`,
      params
    );
    res.json({ posts: rows, ownOnly: isOwnOnly(req) });
  })
);

/* ---------------- SINGLE (editor load) ---------------- */
router.get(
  '/:id',
  a(async (req, res) => {
    const rows = await q(
      `SELECT p.*, m.url_path AS featured_path FROM posts p
       LEFT JOIN media m ON m.id = p.featured_media_id WHERE p.id = ?`,
      [req.params.id]
    );
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'Post nahi mila' });
    if (isOwnOnly(req) && post.author_id !== req.user.id)
      return res.status(403).json({ error: 'Eh post tuhada nahi hai' });
    const tags = await q(
      'SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?',
      [post.id]
    );
    res.json({ post: { ...post, tags: tags.map((t) => t.name).join(', ') } });
  })
);

async function saveTags(postId, tagsCsv) {
  await q('DELETE FROM post_tags WHERE post_id = ?', [postId]);
  const names = String(tagsCsv || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const name of names) {
    await q('INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)', [name, slugify(name)]);
    const t = await q('SELECT id FROM tags WHERE slug = ?', [slugify(name)]);
    if (t[0]) await q('INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, t[0].id]);
  }
}

function pickStatus(req, wanted) {
  const can = req.user.permissions;
  if ((wanted === 'published' || wanted === 'scheduled') && !can.includes('publish')) {
    /* Publisher publish nahi kar sakda — review vich jaanda hai */
    return 'review';
  }
  return ['draft', 'review', 'scheduled', 'published'].includes(wanted) ? wanted : 'draft';
}

/* ---------------- CREATE ---------------- */
router.post(
  '/',
  requirePerm('edit-content'),
  a(async (req, res) => {
    const b = req.body || {};
    const status = pickStatus(req, b.status);
    const slug = await uniqueSlug(b.slug || b.title || 'post');
    const r = await q(
      `INSERT INTO posts
        (title, dek, slug, body_html, boli_id, category_id, author_id, status,
         published_at, scheduled_at, seo_title, seo_description, focus_keyword,
         featured_media_id, ghost_glyph, glyph_script, art_tone, read_minutes, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title || 'Untitled', b.dek || '', slug, cleanBody(b.body_html),
        b.boli_id || null, b.category_id || null, req.user.id, status,
        status === 'published' ? new Date() : null,
        status === 'scheduled' ? b.scheduled_at || null : null,
        b.seo_title || '', b.seo_description || '', b.focus_keyword || '',
        b.featured_media_id || null, b.ghost_glyph || 'ਚ', b.glyph_script || 'gurmukhi',
        b.art_tone || 1, b.read_minutes || 5, b.is_featured ? 1 : 0,
      ]
    );
    await saveTags(r.insertId, b.tags);
    res.json({ ok: true, id: r.insertId, slug, status });
  })
);

/* ---------------- UPDATE ---------------- */
router.put(
  '/:id',
  requirePerm('edit-content,edit-meta'),
  a(async (req, res) => {
    const rows = await q('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'Post nahi mila' });
    if (isOwnOnly(req) && post.author_id !== req.user.id)
      return res.status(403).json({ error: 'Eh post tuhada nahi hai' });

    const b = req.body || {};
    const canContent = req.user.permissions.includes('edit-content');
    const canMeta = req.user.permissions.includes('edit-meta');

    const next = { ...post };
    if (canContent) {
      next.title = b.title ?? post.title;
      next.dek = b.dek ?? post.dek;
      next.body_html = b.body_html != null ? cleanBody(b.body_html) : post.body_html;
      next.boli_id = b.boli_id ?? post.boli_id;
      next.category_id = b.category_id ?? post.category_id;
      next.featured_media_id = b.featured_media_id ?? post.featured_media_id;
      next.ghost_glyph = b.ghost_glyph ?? post.ghost_glyph;
      next.glyph_script = b.glyph_script ?? post.glyph_script;
      next.art_tone = b.art_tone ?? post.art_tone;
      next.read_minutes = b.read_minutes ?? post.read_minutes;
      next.is_featured = b.is_featured != null ? (b.is_featured ? 1 : 0) : post.is_featured;
      if (b.status) {
        next.status = pickStatus(req, b.status);
        if (next.status === 'published' && !post.published_at) next.published_at = new Date();
        next.scheduled_at = next.status === 'scheduled' ? b.scheduled_at || post.scheduled_at : post.scheduled_at;
      }
      if (b.slug && b.slug !== post.slug) next.slug = await uniqueSlug(b.slug, post.id);
    }
    if (canMeta) {
      next.seo_title = b.seo_title ?? post.seo_title;
      next.seo_description = b.seo_description ?? post.seo_description;
      next.focus_keyword = b.focus_keyword ?? post.focus_keyword;
      if (b.slug && b.slug !== post.slug) next.slug = await uniqueSlug(b.slug, post.id);
    }

    await q(
      `UPDATE posts SET title=?, dek=?, slug=?, body_html=?, boli_id=?, category_id=?, status=?,
        published_at=?, scheduled_at=?, seo_title=?, seo_description=?, focus_keyword=?,
        featured_media_id=?, ghost_glyph=?, glyph_script=?, art_tone=?, read_minutes=?, is_featured=?
       WHERE id=?`,
      [
        next.title, next.dek, next.slug, next.body_html, next.boli_id, next.category_id, next.status,
        next.published_at, next.scheduled_at, next.seo_title, next.seo_description, next.focus_keyword,
        next.featured_media_id, next.ghost_glyph, next.glyph_script, next.art_tone, next.read_minutes,
        next.is_featured, post.id,
      ]
    );
    if (canContent && b.tags != null) await saveTags(post.id, b.tags);
    res.json({ ok: true, slug: next.slug, status: next.status });
  })
);

/* ---------------- QUICK STATUS (publish from list) ---------------- */
router.patch(
  '/:id/status',
  requirePerm('publish'),
  a(async (req, res) => {
    const status = pickStatus(req, (req.body || {}).status);
    await q(
      'UPDATE posts SET status = ?, published_at = IF(? = "published" AND published_at IS NULL, NOW(), published_at) WHERE id = ?',
      [status, status, req.params.id]
    );
    res.json({ ok: true, status });
  })
);

/* ---------------- DELETE (admin only) ---------------- */
router.delete(
  '/:id',
  requirePerm('delete'),
  a(async (req, res) => {
    await q('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
