const router = require('express').Router();
const { q } = require('../db');
const { a, injectToc } = require('../utils');

/* Scheduled posts jinke time aa gaya = live */
const PUB = `(p.status = 'published' OR (p.status = 'scheduled' AND p.scheduled_at <= NOW()))`;

const POST_CARD = `
  SELECT p.id, p.title, p.dek, p.slug, p.read_minutes, p.views, p.ghost_glyph, p.glyph_script, p.art_tone,
         p.published_at, p.is_featured, c.name AS category, c.slug AS category_slug,
         b.name AS boli, u.name AS author,
         m.url_path AS image, m.alt AS image_alt
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories b ON b.id = p.boli_id
  LEFT JOIN users u ON u.id = p.author_id
  LEFT JOIN media m ON m.id = p.featured_media_id
`;

async function getSettings() {
  const rows = await q('SELECT skey, svalue FROM settings');
  const s = {};
  for (const r of rows) {
    try {
      s[r.skey] = JSON.parse(r.svalue);
    } catch (e) {
      s[r.skey] = r.svalue;
    }
  }
  return s;
}

/* ---------------- HOME: poora homepage ik call vich ---------------- */
router.get(
  '/home',
  a(async (req, res) => {
    const [settings, heroRows, latest, top10, moodsRows, picks, hubs, videos, sessions, calendar, pollRows, quizRows, trending] =
      await Promise.all([
        getSettings(),
        q(`${POST_CARD} WHERE ${PUB} AND p.is_featured = 1 ORDER BY p.published_at DESC LIMIT 1`),
        q(`${POST_CARD} WHERE ${PUB} ORDER BY p.published_at DESC LIMIT 7`),
        q(`SELECT rank_no, title, boli, link, glyph, glyph_script, tone FROM chart_items ORDER BY rank_no ASC`),
        q(`SELECT DISTINCT mood FROM watch_picks ORDER BY mood`),
        q(`SELECT title, why, link, mood, glyph, glyph_script, tone FROM watch_picks ORDER BY id`),
        q(`SELECT b.name, b.slug, COUNT(p.id) AS post_count
           FROM categories b
           LEFT JOIN posts p ON p.boli_id = b.id AND (p.status='published' OR (p.status='scheduled' AND p.scheduled_at <= NOW()))
           WHERE b.kind = 'boli' GROUP BY b.id ORDER BY b.id`),
        q(`SELECT title, kind, duration, glyph, glyph_script, tone FROM videos ORDER BY id`),
        q(`SELECT title, meta, glyph_text, tone FROM sessions ORDER BY id`),
        q(`SELECT release_date, title, boli, kind, is_tba FROM calendar_items ORDER BY is_tba ASC, release_date ASC`),
        q(`SELECT * FROM polls WHERE status = 'live' ORDER BY id DESC LIMIT 1`),
        q(`SELECT id, title, config_json, plays FROM quizzes WHERE status = 'live' ORDER BY id DESC LIMIT 1`),
        q(`${POST_CARD} WHERE ${PUB} ORDER BY p.published_at DESC LIMIT 3`),
      ]);

    /* Poll options */
    let poll = null;
    if (pollRows[0]) {
      const opts = await q('SELECT id, label, votes FROM poll_options WHERE poll_id = ? ORDER BY id', [pollRows[0].id]);
      poll = { id: pollRows[0].id, question: pollRows[0].question, options: opts };
    }

    let quiz = null;
    if (quizRows[0]) {
      quiz = { id: quizRows[0].id, title: quizRows[0].title, plays: quizRows[0].plays, ...JSON.parse(quizRows[0].config_json) };
    }

    const hero = heroRows[0] || latest[0] || null;
    const rest = latest.filter((p) => !hero || p.id !== hero.id);

    res.json({
      settings,
      trending: trending.map((t) => ({ title: t.title, slug: t.slug })),
      hero,
      top10,
      latest: { feature: rest[0] || null, side: rest.slice(1, 4), row: rest.slice(4, 6) },
      moods: moodsRows.map((m) => m.mood),
      picks,
      hubs,
      videos,
      titleHub: settings.title_hub || null,
      sessions,
      calendar,
      quiz,
      poll,
    });
  })
);

/* ---------------- ARTICLE ---------------- */
router.get(
  '/posts/:slug',
  a(async (req, res) => {
    const rows = await q(
      `SELECT p.*, c.name AS category, c.slug AS category_slug, b.name AS boli, u.name AS author,
              m.url_path AS image, m.alt AS image_alt
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories b ON b.id = p.boli_id
       LEFT JOIN users u ON u.id = p.author_id
       LEFT JOIN media m ON m.id = p.featured_media_id
       WHERE p.slug = ? AND (p.status = 'published' OR (p.status = 'scheduled' AND p.scheduled_at <= NOW()))
       LIMIT 1`,
      [req.params.slug]
    );
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'Post nahi mila' });

    q('UPDATE posts SET views = views + 1 WHERE id = ?', [post.id]).catch(() => {});

    const { html, toc } = injectToc(post.body_html);
    const tags = await q(
      'SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?',
      [post.id]
    );
    const related = await q(
      `${POST_CARD} WHERE ${PUB} AND p.id != ? ORDER BY (p.boli_id = ?) DESC, p.published_at DESC LIMIT 3`,
      [post.id, post.boli_id]
    );
    const latestList = await q(
      `${POST_CARD} WHERE ${PUB} ORDER BY p.published_at DESC LIMIT 4`
    );

    delete post.body_html;
    res.json({
      post: { ...post, body: html, tags: tags.map((t) => t.name) },
      toc,
      related,
      latest: latestList,
      settings: await getSettings(),
    });
  })
);

/* ---------------- POLL VOTE ---------------- */
router.post(
  '/polls/:id/vote',
  a(async (req, res) => {
    const { optionId } = req.body || {};
    const opt = await q('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?', [optionId, req.params.id]);
    if (!opt[0]) return res.status(400).json({ error: 'Galat option' });
    await q('UPDATE poll_options SET votes = votes + 1 WHERE id = ?', [optionId]);
    const options = await q('SELECT id, label, votes FROM poll_options WHERE poll_id = ? ORDER BY id', [req.params.id]);
    res.json({ options });
  })
);

/* ---------------- QUIZ PLAY COUNT ---------------- */
router.post(
  '/quizzes/:id/play',
  a(async (req, res) => {
    await q('UPDATE quizzes SET plays = plays + 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

/* ---------------- NEWSLETTER ---------------- */
router.post(
  '/newsletter',
  a(async (req, res) => {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Sahi email likho' });
    await q('INSERT IGNORE INTO subscribers (email, source) VALUES (?, ?)', [email, 'site']);
    res.json({ ok: true });
  })
);

/* ---------------- COMMENT SUBMIT (moderation queue vich jaanda) ---------------- */
router.post(
  '/posts/:slug/comments',
  a(async (req, res) => {
    const { name, body } = req.body || {};
    if (!name || !body) return res.status(400).json({ error: 'Naam te comment dono chahide' });
    const rows = await q('SELECT id FROM posts WHERE slug = ?', [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ error: 'Post nahi mila' });
    await q('INSERT INTO comments (post_id, author_name, body, status) VALUES (?, ?, ?, "pending")', [
      rows[0].id,
      String(name).slice(0, 80),
      String(body).slice(0, 2000),
    ]);
    res.json({ ok: true, message: 'Comment review queue vich chala gaya' });
  })
);

/* ---------------- SITEMAP DATA (frontend /sitemap.xml ise use karda) ---------------- */
router.get(
  '/sitemap',
  a(async (req, res) => {
    const posts = await q(
      `SELECT slug, updated_at FROM posts p WHERE ${PUB} ORDER BY published_at DESC`
    );
    res.json({ posts });
  })
);

/* ---------------- OLD URL REDIRECTS (WordPress rankings preserve) ---------------- */
router.get(
  '/redirect',
  a(async (req, res) => {
    const p = String(req.query.path || '');
    const rows = await q('SELECT to_path, code FROM redirects WHERE from_path = ? LIMIT 1', [p]);
    if (!rows[0]) return res.json({ found: false });
    q('UPDATE redirects SET hits = hits + 1 WHERE from_path = ?', [p]).catch(() => {});
    res.json({ found: true, to: rows[0].to_path, code: rows[0].code });
  })
);

module.exports = router;
