/* New-post announcer: every minute, finds posts that just went live (published now, or a scheduled time that has passed)
   and sends ONE web push + ONE email to everyone. posts.notified_at makes sure a post is announced only once, and the
   claim below is atomic so two server processes can't both send it.
   Email goes to newsletter subscribers + verified readers, minus anyone in mail_optouts, with an unsubscribe link. */
const crypto = require('crypto');
const { q } = require('./db');
const mailer = require('./mailer');
const push = require('./push');
const { jwtSecret } = require('./middleware/auth');

const SITE = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TICK_MS = 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000; /* a post that went live longer ago than this is marked, not announced */
const MAIL_CONCURRENCY = 2; /* matches the pooled SMTP transport */
const MAIL_PAUSE_MS = Number(process.env.NOTIFY_MAIL_PAUSE_MS || 400); /* ≈ 5 mails/second */

const PUB = `(p.status = 'published' OR (p.status = 'scheduled' AND p.scheduled_at <= NOW()))`;

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Unsubscribe token = HMAC of the address — nothing to store, can't be guessed for someone else's email */
const unsubKey = () => process.env.UNSUBSCRIBE_SECRET || jwtSecret() || 'dev-secret';
const unsubToken = (email) => crypto.createHmac('sha256', unsubKey()).update(`unsub:${String(email).toLowerCase()}`).digest('hex').slice(0, 32);
const validUnsubToken = (email, token) => {
  const want = Buffer.from(unsubToken(email));
  const got = Buffer.from(String(token || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

function buildMail(post, email) {
  const url = `${SITE()}/article/${post.slug}`;
  const t = encodeURIComponent(unsubToken(email));
  const e = encodeURIComponent(email);
  const page = `${SITE()}/unsubscribe?e=${e}&t=${t}`;
  const oneClick = `${SITE()}/api/public/unsubscribe?e=${e}&t=${t}`;
  const img = post.image ? (post.image.startsWith('http') ? post.image : `${SITE()}${post.image}`) : null;
  const dek = post.dek || '';

  const html =
    `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#222;line-height:1.5">` +
    `<p style="font-size:12px;letter-spacing:2px;color:#8C5E00;font-weight:bold;margin:0 0 12px">NEW ON CHAUPAL TE CHARCHA</p>` +
    (img ? `<a href="${esc(url)}"><img src="${esc(img)}" alt="" width="560" style="width:100%;height:auto;border-radius:10px;display:block;margin:0 0 16px"></a>` : '') +
    `<h1 style="font-size:24px;line-height:1.2;margin:0 0 10px"><a href="${esc(url)}" style="color:#222;text-decoration:none">${esc(post.title)}</a></h1>` +
    (dek ? `<p style="font-size:16px;color:#444;margin:0 0 18px">${esc(dek)}</p>` : '') +
    `<p style="margin:0 0 28px"><a href="${esc(url)}" style="background:#F2B01E;color:#171204;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;display:inline-block">Read story →</a></p>` +
    `<hr style="border:0;border-top:1px solid #ddd;margin:0 0 14px">` +
    `<p style="font-size:12px;color:#777;margin:0">You are getting this because you signed up at Chaupal Te Charcha. ` +
    `<a href="${esc(page)}" style="color:#777">Unsubscribe</a></p></div>`;
  const text = `NEW ON CHAUPAL TE CHARCHA\n\n${post.title}\n${dek ? `${dek}\n` : ''}\nRead story: ${url}\n\n--\nYou are getting this because you signed up at Chaupal Te Charcha.\nUnsubscribe: ${page}\n`;
  return {
    to: email,
    subject: post.title,
    text,
    html,
    headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

async function recipients() {
  const rows = await q(
    `SELECT LOWER(email) AS email FROM subscribers
     UNION
     SELECT LOWER(email) FROM readers WHERE is_active = 1 AND email_verified_at IS NOT NULL`
  );
  const out = await q('SELECT email FROM mail_optouts');
  const blocked = new Set(out.map((r) => r.email.toLowerCase()));
  return rows.map((r) => r.email).filter((e) => e && !blocked.has(e));
}

/* One email queue for the whole process: a long send never blocks the next minute's check */
const mailQueue = [];
let mailRunning = false;
async function drainMail() {
  if (mailRunning) return;
  mailRunning = true;
  try {
    while (mailQueue.length) {
      const batch = mailQueue.splice(0, MAIL_CONCURRENCY);
      await Promise.all(batch.map((m) => mailer.sendMail(m).catch((e) => { if (!e || !e.logged) console.error(`[notify] mail failed: ${mailer.safeDetail(e)}`); })));
      await sleep(MAIL_PAUSE_MS);
    }
  } finally {
    mailRunning = false;
  }
}

async function announce(post) {
  const url = `/article/${post.slug}`;
  const title = clip(post.title, 65);
  const body = clip(post.dek || 'New story on Chaupal Te Charcha', 150);

  /* Push */
  try {
    const r = await push.sendToAll({ title, body, url });
    if (r) {
      await q(
        `INSERT INTO notifications (title, body, url, created_by, audience, target_count, sent_count, failed_count)
         VALUES (?, ?, ?, NULL, 'all_granted', ?, ?, ?)`,
        [title, body, url, r.target, r.sent, r.failed]
      );
      console.log(`[notify] push "${post.slug}": ${r.sent}/${r.target} sent`);
    } else console.warn('[notify] push skipped: VAPID not configured');
  } catch (e) {
    console.error(`[notify] push failed: ${e.message}`);
  }

  /* Email */
  try {
    if (!mailer.status().configured) return console.warn('[notify] email skipped: mail is not configured');
    const list = await recipients();
    list.forEach((email) => mailQueue.push(buildMail(post, email)));
    console.log(`[notify] email "${post.slug}": ${list.length} queued`);
    drainMail();
  } catch (e) {
    console.error(`[notify] email failed: ${e.message}`);
  }
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const posts = await q(
      `SELECT p.id, p.title, p.dek, p.slug, COALESCE(p.published_at, p.scheduled_at) AS live_at, m.url_path AS image
       FROM posts p LEFT JOIN media m ON m.id = p.featured_media_id
       WHERE ${PUB} AND p.notified_at IS NULL
       ORDER BY live_at ASC LIMIT 5`
    );
    for (const post of posts) {
      /* Claim first — only the process that flips NULL → now() announces it. updated_at is kept (it feeds sitemap lastmod) */
      const r = await q('UPDATE posts SET notified_at = NOW(), updated_at = updated_at WHERE id = ? AND notified_at IS NULL', [post.id]);
      if (!r.affectedRows) continue;
      if (Date.now() - new Date(post.live_at).getTime() > MAX_AGE_MS) {
        console.log(`[notify] "${post.slug}" went live long ago — marked, not announced`);
        continue;
      }
      await announce(post);
    }
  } catch (e) {
    console.error(`[notify] check failed: ${e.message}`);
  } finally {
    busy = false;
  }
}

function start() {
  if (String(process.env.NOTIFY_ON_PUBLISH || '').toLowerCase() === 'off') return console.log('→ New-post notifications: off (NOTIFY_ON_PUBLISH=off)');
  console.log('→ New-post notifications: on (push + email, checked every minute)');
  setTimeout(tick, 15 * 1000);
  setInterval(tick, TICK_MS);
}

module.exports = { start, tick, unsubToken, validUnsubToken };
