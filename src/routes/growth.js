const router = require('express').Router();
const { q } = require('../db');
const { a } = require('../utils');
const { requireAuth, requirePerm } = require('../middleware/auth');

router.use(requireAuth);

/* ================= SEO ================= */

router.get(
  '/seo/overview',
  requirePerm('seo'),
  a(async (req, res) => {
    const [posts, keywords, redirects, health] = await Promise.all([
      q(`SELECT id, title, slug, seo_title, seo_description,
                CHAR_LENGTH(seo_title) AS title_len, CHAR_LENGTH(seo_description) AS desc_len
         FROM posts ORDER BY updated_at DESC LIMIT 50`),
      q('SELECT id, keyword, position, delta FROM seo_keywords ORDER BY position ASC'),
      q('SELECT id, from_path, to_path, code, hits FROM redirects ORDER BY id DESC'),
      q('SELECT svalue FROM settings WHERE skey = "seo_health"'),
    ]);
    res.json({
      meta: posts,
      keywords,
      redirects,
      health: health[0] ? JSON.parse(health[0].svalue) : {},
    });
  })
);

router.post(
  '/seo/redirects',
  requirePerm('edit-meta'),
  a(async (req, res) => {
    const { from_path, to_path, code } = req.body || {};
    if (!from_path || !to_path) return res.status(400).json({ error: 'from_path te to_path dono chahide' });
    await q('INSERT INTO redirects (from_path, to_path, code) VALUES (?, ?, ?)', [
      from_path.startsWith('/') ? from_path : `/${from_path}`,
      to_path,
      code === 302 ? 302 : 301,
    ]);
    res.json({ ok: true });
  })
);

router.delete(
  '/seo/redirects/:id',
  requirePerm('edit-meta'),
  a(async (req, res) => {
    await q('DELETE FROM redirects WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

/* ================= MARKETING ================= */

router.get(
  '/marketing/overview',
  requirePerm('marketing'),
  a(async (req, res) => {
    const [campaigns, subCount, latestSubs, promo] = await Promise.all([
      q('SELECT * FROM campaigns ORDER BY id DESC'),
      q('SELECT COUNT(*) AS n FROM subscribers'),
      q('SELECT email, created_at FROM subscribers ORDER BY created_at DESC LIMIT 5'),
      q('SELECT svalue FROM settings WHERE skey = "promo_slots"'),
    ]);
    res.json({
      campaigns,
      subscribers: { count: subCount[0].n, latest: latestSubs },
      promoSlots: promo[0] ? JSON.parse(promo[0].svalue) : [],
    });
  })
);

router.post(
  '/marketing/campaigns',
  requirePerm('utm'),
  a(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Campaign da naam chahida' });
    await q(
      `INSERT INTO campaigns (name, channel, base_url, utm_source, utm_medium, utm_campaign, status)
       VALUES (?, ?, ?, ?, ?, ?, 'live')`,
      [b.name, b.channel || '', b.base_url || '', b.utm_source || '', b.utm_medium || '', b.utm_campaign || '']
    );
    res.json({ ok: true });
  })
);

router.patch(
  '/marketing/campaigns/:id',
  requirePerm('utm'),
  a(async (req, res) => {
    const status = (req.body || {}).status === 'live' ? 'live' : 'ended';
    await q('UPDATE campaigns SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true });
  })
);

/* Demo: real mailer (SES/Mailchimp) production phase vich wire hovega */
router.post(
  '/marketing/newsletter/test',
  requirePerm('newsletter'),
  a(async (req, res) => {
    res.json({ ok: true, message: 'Test send queued (demo) — mailer production vich wire hovega' });
  })
);

module.exports = router;
