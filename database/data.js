/* Seed data — two parts:
   - essentialData: PROD-safe. Creates admin user (from env), language/category taxonomy,
     site settings, and legacy WordPress /category/ 301s. No dummy content.
   - dummyData: for UAT/dev. Adds demo users, posts, quiz, poll, rails, campaigns.
   Both are used by bootstrap.js (auto at server boot) and seed.js (CLI). */

const bcrypt = require('bcryptjs');

/* ---------------- Rich bodies (dummy posts) ---------------- */
const bhaiSahabBody = `
<p>[Intro — spoiler-free, do-tin lines vich series da hook. Eh template body hai; studio editor ton isi post nu edit karke real copy paao.]</p>
<h2>01 · The story so far</h2>
<p>[Premise — the world, the conflict, the hook. <b>Bold</b>, <i>italic</i>, <span style="color:#8C5E00">colors</span> te <span style="background-color:#FFF3C4">highlight</span> — editor de saare styles article te aise hi render hunde ne.]</p>
<blockquote>&#8220;Vadde twists TV te nahi, Chaupal te khulde ne.&#8221;</blockquote>
<h2>02 · The cast guide</h2>
<ul><li><b>[Lead actor]</b> as [Character] — ik line intro</li><li><b>[Lead actress]</b> as [Character] — ik line intro</li><li><b>[Supporting cast]</b> — ik line</li></ul>
<h2>03 · Episode-by-episode</h2>
<table class="t-gold"><thead><tr><th>#</th><th>Episode</th><th>Tease</th><th>Runtime</th></tr></thead><tbody>
<tr><td>1</td><td>[Title]</td><td>[One-line tease]</td><td>32 min</td></tr>
<tr><td>2</td><td>[Title]</td><td>[One-line tease]</td><td>29 min</td></tr>
<tr><td>3</td><td>[Title]</td><td>[One-line tease]</td><td>31 min</td></tr>
<tr><td>4</td><td>[Title]</td><td>[One-line tease]</td><td>30 min</td></tr>
<tr><td>5</td><td>[Title]</td><td>[Finale tease]</td><td>36 min</td></tr>
</tbody></table>
<h2>04 · Why it matters</h2>
<p>[Bigger picture — Chaupal Originals slate vich eh kithe baithda hai, te readers nu poll val invite karo.]</p>
<h2>05 · Watch it on Chaupal</h2>
<p>All 5 episodes · Streaming from Oct 2 · Only on <a href="https://www.chaupal.com" target="_blank" rel="noopener">Chaupal</a>.</p>`;

const shortBody = (h) => `
<p>[Intro paragraph — ${h}. Editor ton edit karke real copy paao.]</p>
<h2>01 · The setup</h2>
<p>[Body copy placeholder — headings, lists, tables, images sab editor supported hai.]</p>
<h2>02 · The verdict</h2>
<p>[Closing take + watch CTA.]</p>`;

const quizConfig = {
  questions: [
    { key: 'mood', label: 'Pehla sawaal: aaj da mood ki hai?', options: [
      { v: 'comedy', label: 'Full comedy' }, { v: 'drama', label: 'Rona-dhona drama' },
      { v: 'thrill', label: 'Thrill chahida' }, { v: 'family', label: 'Family night' }] },
    { key: 'boli', label: 'Kis boli da mann hai?', options: [
      { v: 'Punjabi', label: 'ਪੰਜਾਬੀ Punjabi' }, { v: 'Haryanvi', label: 'हरियाणवी Haryanvi' },
      { v: 'Bhojpuri', label: 'भोजपुरी Bhojpuri' }, { v: 'Koi vi', label: 'Koi vi chalegi' }] },
    { key: 'time', label: 'Kinna time hai tuhade kol?', options: [
      { v: 'Ik film', label: 'Ik film — 2 ghante' }, { v: 'Full binge', label: 'Full binge — poori raat' }] },
  ],
  results: {
    comedy: { title: 'Carry on Jatta 3', why: 'Comedy raat sorted — chaos, confusion te classic Jatta energy.', link: 'https://www.chaupal.com/movie/carry-on-jatta-3', glyph: 'ਕ', script: 'gurmukhi', tone: 2 },
    drama: { title: 'Jind Mahi', why: 'Rona-dhona te pyaar — a soft, heartfelt watch.', link: 'https://www.chaupal.com/movie/jind-mahi', glyph: 'ਜ', script: 'gurmukhi', tone: 6 },
    thrill: { title: 'Gangland', why: 'Gritty action, high stakes — thrill poora milega.', link: 'https://www.chaupal.com/movie/gangland', glyph: 'ਗ', script: 'gurmukhi', tone: 3 },
    family: { title: 'Bahu Kale Ki', why: 'Poora parivaar, ik screen — full desi family drama.', link: 'https://www.chaupal.com/tvshow/bahu-kale-ki-6d70a007-1da7-4352-b973-4b1dd2b746fa', glyph: 'ब', script: 'devanagari', tone: 4 },
  },
};

/* ================================================================
  ESSENTIAL — runs in production too (first boot, once)
  ================================================================ */
async function essentialData(conn, opts = {}) {
  const adminName = opts.adminName || process.env.ADMIN_NAME || 'Ujjwal M.';
  const adminEmail = opts.adminEmail || process.env.ADMIN_EMAIL || 'admin@chaupal.com';
  const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || 'Chaupal@123';

  await conn.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`,
    [adminName, adminEmail, bcrypt.hashSync(adminPassword, 10)]
  );

  await conn.query(`INSERT INTO categories (name, slug, kind) VALUES
    ('Punjabi', 'punjabi', 'boli'), ('Haryanvi', 'haryanvi', 'boli'), ('Bhojpuri', 'bhojpuri', 'boli'),
    ('Chaupal Originals', 'chaupal-originals', 'category'), ('Reviews', 'reviews', 'category'),
    ('Top 10', 'top-10', 'category'), ('News', 'news', 'category'), ('Charcha Sessions', 'charcha-sessions', 'category')`);

  /* Old live blog.chaupal.com /category/ URLs — real 301s; required in production */
  await conn.query(`INSERT INTO redirects (from_path, to_path, code, hits) VALUES
    ('/category/trending', '/#latest', 301, 0),
    ('/category/movie', '/#latest', 301, 0),
    ('/category/web-series', '/#latest', 301, 0),
    ('/category/artist', '/#latest', 301, 0),
    ('/category/binge-watch', '/#watch', 301, 0),
    ('/category/chaupal-originals', '/#latest', 301, 0),
    ('/category/chaupal-exclusives', '/#latest', 301, 0),
    ('/category/throwback', '/#latest', 301, 0),
    ('/category/trivia', '/#play', 301, 0),
    ('/category/press-release', '/#latest', 301, 0)`);

  const settings = {
    site_title: 'Chaupal Te Charcha',
    tagline: 'Stories, trailers te charcha from the world of Chaupal',
    /* Live blog.chaupal.com (Yoast) ton — SEO continuity; Studio > Settings ton editable */
    seo_home_title: 'Chaupal - Trending Punjabi Movies and Series Updates',
    seo_home_description: 'Chaupal provides the latest entertainment updates & insights on popular movies and trends across Punjabi, Haryanvi & Bhojpuri cinema.',
    twitter_handle: '@chaupaltv',
    gurmukhi_label: 'ਚੌਪਾਲ ਤੇ ਚਰਚਾ',
    socials: [
      { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/chaupal_app/' },
      { key: 'x', label: 'X', url: 'https://x.com/ChaupalApp' },
      { key: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/c/ChaupalOTT' },
      { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/ChaupalOTT/' },
    ],
    ecosystem: [
      { label: 'SHOP', url: 'https://chaupalshop.com' },
      { label: 'GAMES', url: 'https://games.chaupal.tv' },
      { label: 'HELP', url: 'https://help.chaupal.tv/portal/en/kb' },
    ],
    footer: {
      devices: 'Android · iOS · Android TV · Apple TV · Fire TV · Samsung · LG',
      blurb: 'Stories, trailers te charcha from the world of Chaupal — Punjabi, Haryanvi and Bhojpuri entertainment, ik jagah te. Editorial desk, Chandigarh.',
      legal: [
        { label: 'Privacy policy', url: 'https://www.chaupal.com/support/privacy-policy' },
        { label: 'Terms', url: 'https://www.chaupal.com/support/terms' },
        { label: 'Cookies', url: 'https://www.chaupal.com/support/cookie-policy' },
        { label: 'Grievance', url: 'https://about.chaupal.tv/grievance/' },
      ],
      copyright: '© 2026 Chaupal · Bosna Digital Entertainment Pvt. Ltd. All rights reserved.',
    },
    watch_url: 'https://www.chaupal.com',
    title_hub: {
      kicker: 'TITLE HUB',
      title: 'EVERYTHING: SARPANCHI',
      blurb: 'Pind, power te politics — news, trailer, cast guide and every Charcha story on the Chaupal Original, ik hi jagah te.',
      glyph: 'ਸ', script: 'gurmukhi', tone: 2,
      watch_link: 'https://www.chaupal.com/tvshow/sarpanchi-2024-1cdbd88b-69b7-4803-8cb5-7824f0a013c5',
      article_slug: 'sarpanchi-2024-trailer-breakdown',
    },
    promo_slots: [
      { name: 'Hero takeover · Bhai Sahab', status: 'OCT 2' },
      { name: 'Ticker slot #2', status: 'OPEN' },
      { name: 'Quiz card · Play section', status: 'LIVE' },
    ],
    seo_health: [
      { label: 'sitemap.xml', status: 'OK · AUTO' },
      { label: 'robots.txt', status: 'OK · AUTO' },
      { label: 'Redirects (old WordPress URLs)', status: 'ACTIVE' },
      { label: 'Core Web Vitals · mobile', status: 'GOOD' },
    ],
  };
  for (const [k, v] of Object.entries(settings)) {
    await conn.query('INSERT INTO settings (skey, svalue) VALUES (?, ?)', [
      k, typeof v === 'string' ? v : JSON.stringify(v),
    ]);
  }
}

/* ================================================================
  DUMMY — only for dev/UAT (SEED_MODE=demo). Never run in production.
  ================================================================ */
async function dummyData(conn, opts = {}) {
  const siteUrl = opts.siteUrl || process.env.SITE_URL || 'http://localhost:3000';
  const hash = bcrypt.hashSync('Chaupal@123', 10);

  /* Demo team (admin already created in essential — id 1) */
  await conn.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES
     ('Charcha Desk', 'desk@chaupal.com', ?, 'author'),
     ('Simran K.', 'seo@chaupal.com', ?, 'seo'),
     ('Manav S.', 'marketing@chaupal.com', ?, 'marketing')`,
    [hash, hash, hash]
  );

    /* Language IDs: 1=Punjabi, 2=Haryanvi, 3=Bhojpuri
      Category IDs: 4=Originals, 5=Reviews, 6=Top10, 7=News, 8=Sessions
      User IDs: 1=admin, 2=desk(author), 3=seo, 4=marketing */
  const posts = [
    ['Bhai Sahab: cast, story te all 5 episodes', 'The new Chaupal Original lands this Friday. Yahan hai everything to know before you press play — sab kuchh, ik jagah te.', 'bhai-sahab-web-series-episode-guide', bhaiSahabBody, 1, 4, 2, 'published', 'DATE_SUB(NOW(), INTERVAL 4 HOUR)', 18204, 6, 1, 'ਭ', 'gurmukhi', 1, 'Bhai Sahab web series: cast, story, all 5 episodes', 'The new Chaupal Original lands Oct 2. Cast, kahani te episode guide — everything to know before you press play.', 'bhai sahab web series'],
    ['Carry On Jatta 4 review: does the chaos still land?', 'The franchise is back — par ki comedy ajj vi oni hi fresh hai? Full spoiler-light review.', 'carry-on-jatta-4-review', shortBody('CoJ4 review'), 1, 5, 3, 'published', 'DATE_SUB(NOW(), INTERVAL 10 DAY)', 9812, 5, 0, 'ਕ', 'gurmukhi', 2, 'Carry On Jatta 4 review — Chaupal Te Charcha', 'Carry On Jatta 4 da full review: performances, comedy, te ki eh watch banadi hai.', 'carry on jatta 4 review'],
    ['Kachhadhari: unveiling the dark mysteries of the hit series', 'Haryanvi thriller di duniya — clues, theories te wo sab jo tusi miss kita.', 'kachhadhari-dark-mysteries', shortBody('Kachhadhari explainer'), 2, 7, 2, 'review', 'NULL', 0, 7, 0, 'क', 'devanagari', 4, 'Kachhadhari: dark mysteries explained', '', 'kachhadhari series'],
    ['Top 10 Sonam Bajwa movies: from debut to stardom', 'Debut ton lai ke ajj tak — Sonam Bajwa diyan best filman, ranked.', 'top-10-sonam-bajwa-movies', shortBody('Sonam Bajwa Top 10'), 1, 6, 4, 'scheduled', 'NULL', 0, 8, 0, 'TOP 10', 'display', 5, 'Top 10 Sonam Bajwa movies ranked', 'Sonam Bajwa diyan 10 best filman — debut ton stardom tak, full ranked list.', 'sonam bajwa movies'],
    ['Packup: the reality behind the limelight', 'Bhojpuri industry de camere de pichhe di kahani.', 'packup-reality-behind-limelight', shortBody('Packup feature'), 3, 7, 3, 'draft', 'NULL', 0, 6, 0, 'प', 'devanagari', 6, 'Packup: reality behind the limelight', '', 'packup bhojpuri'],
    ['Sarpanchi 2024: pind, power te the trailer breakdown', 'Chaupal Original da trailer frame-by-frame — politics, pind te power play.', 'sarpanchi-2024-trailer-breakdown', shortBody('Sarpanchi trailer breakdown'), 1, 4, 2, 'published', 'DATE_SUB(NOW(), INTERVAL 20 DAY)', 6120, 5, 0, 'ਸ', 'gurmukhi', 2, 'Sarpanchi 2024 trailer breakdown', 'Sarpanchi 2024 de trailer da full breakdown — story hints, cast te release info.', 'sarpanchi 2024'],
  ];
  for (const p of posts) {
    await conn.query(
      `INSERT INTO posts (title, dek, slug, body_html, boli_id, category_id, author_id, status, published_at,
        scheduled_at, views, read_minutes, is_featured, ghost_glyph, glyph_script, art_tone,
        seo_title, seo_description, focus_keyword)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${p[8]}, ${p[7] === 'scheduled' ? 'DATE_ADD(NOW(), INTERVAL 2 DAY)' : 'NULL'}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[9], p[10], p[11], p[12], p[13], p[14], p[15], p[16], p[17]]
    );
  }

  await conn.query(`INSERT INTO tags (name, slug) VALUES
    ('Bhai Sahab', 'bhai-sahab'), ('Chaupal Originals', 'chaupal-originals-tag'),
    ('Web Series', 'web-series'), ('Episode Guides', 'episode-guides'), ('Reviews', 'reviews-tag')`);
  await conn.query(`INSERT INTO post_tags (post_id, tag_id) VALUES (1,1),(1,2),(1,3),(1,4),(2,5),(6,2)`);

  await conn.query(`INSERT INTO comments (post_id, author_name, body, status, created_at) VALUES
    (1, 'Harpreet S.', 'Bhai Sahab da trailer hi kamaal si — Friday da wait nahi ho reha!', 'pending', DATE_SUB(NOW(), INTERVAL 2 HOUR)),
    (3, 'Rakesh D.', 'Kachhadhari season 2 kab aa reha? Koi news?', 'pending', DATE_SUB(NOW(), INTERVAL 5 HOUR)),
    (2, 'Unknown', 'Best deals on watches!! click here www[dot]spam', 'spam', DATE_SUB(NOW(), INTERVAL 1 DAY)),
    (6, 'Jasleen', 'Trailer breakdown vadhia si, cast guide vi banao!', 'approved', DATE_SUB(NOW(), INTERVAL 3 DAY))`);

  await conn.query('INSERT INTO quizzes (title, status, plays, config_json) VALUES (?, "live", 2140, ?)', [
    'Build your perfect Chaupal night', JSON.stringify(quizConfig),
  ]);

  const pr = await conn.query('INSERT INTO polls (question, status) VALUES (?, "live")', [
    'Is hafte da sab ton vadda binge kis boli da hoga?',
  ]);
  const pollId = pr[0].insertId;
  await conn.query('INSERT INTO poll_options (poll_id, label, votes) VALUES (?, "Punjabi", 471), (?, "Haryanvi", 187), (?, "Bhojpuri", 154)', [pollId, pollId, pollId]);

  await conn.query(`INSERT INTO subscribers (email, source, created_at) VALUES
    ('reader1@example.com', 'site', DATE_SUB(NOW(), INTERVAL 12 DAY)),
    ('reader2@example.com', 'site', DATE_SUB(NOW(), INTERVAL 6 DAY)),
    ('reader3@example.com', 'campaign', DATE_SUB(NOW(), INTERVAL 2 DAY)),
    ('reader4@example.com', 'site', DATE_SUB(NOW(), INTERVAL 8 HOUR))`);

  await conn.query(
    `INSERT INTO campaigns (name, channel, base_url, utm_source, utm_medium, utm_campaign, clicks, signups, status) VALUES
    ('bhai-sahab-launch', 'Instagram + Meta Ads', ?, 'instagram', 'social', 'bhai-sahab-launch', 1240, 212, 'live'),
    ('coj4-review-push', 'X + WhatsApp', ?, 'x', 'social', 'coj4-review', 486, 64, 'live'),
    ('chitthi-signup-sept', 'YouTube community', ?, 'youtube', 'community', 'chitthi-sept', 902, 318, 'ended')`,
    [`${siteUrl}/article/bhai-sahab-web-series-episode-guide`, `${siteUrl}/article/carry-on-jatta-4-review`, siteUrl]
  );

  /* Dummy article redirects (targets demo slugs — therefore not included in prod essential) */
  await conn.query(`INSERT INTO redirects (from_path, to_path, code, hits) VALUES
    ('/2025/10/bhai-sahab-web-series', '/article/bhai-sahab-web-series-episode-guide', 301, 0),
    ('/carry-on-jatta-4-review-2', '/article/carry-on-jatta-4-review', 301, 0)`);

  await conn.query(`INSERT INTO seo_keywords (keyword, position, delta) VALUES
    ('bhai sahab web series', 3, 9), ('carry on jatta 4 review', 5, 2),
    ('punjabi web series 2026', 11, 4), ('sonam bajwa movies', 14, -1)`);

  await conn.query(`INSERT INTO chart_items (rank_no, title, boli, link, glyph, glyph_script, tone) VALUES
    (1, 'Nikka Zaildar 4', 'PUNJABI · FILM', 'https://www.chaupal.com/movie/nikka-zaildar-4', 'ਨ', 'gurmukhi', 1),
    (2, 'Daakkhana', 'HARYANVI · SERIES', 'https://www.chaupal.com', 'द', 'devanagari', 4),
    (3, '84 Toh Baad', 'PUNJABI · SERIES', 'https://www.chaupal.com/tvshow/84-toh-baad', '84', 'display', 3),
    (4, 'Lanka Mein Danka', 'BHOJPURI · SERIES', 'https://www.chaupal.com', 'ल', 'devanagari', 6),
    (5, 'Shaunki Sardar', 'PUNJABI · FILM', 'https://www.chaupal.com', 'ਸ਼', 'gurmukhi', 2)`);

  await conn.query(`INSERT INTO watch_picks (title, why, link, mood, glyph, glyph_script, tone) VALUES
    ('Carry on Jatta 3', 'Full-family comedy — chaos, confusion te classic Jatta energy.', 'https://www.chaupal.com/movie/carry-on-jatta-3', 'Desi laughs', 'ਕ', 'gurmukhi', 2),
    ('Gangland', 'Gritty action for the thrill-chahida raat.', 'https://www.chaupal.com/movie/gangland', 'Thrill chahida', 'ਗ', 'gurmukhi', 3),
    ('Jind Mahi', 'Soft romance for a slow, pyaar-bhari evening.', 'https://www.chaupal.com/movie/jind-mahi', 'Rom-com raat', 'ਜ', 'gurmukhi', 6),
    ('Bahu Kale Ki', 'Haryanvi family drama with full desi tadka.', 'https://www.chaupal.com/tvshow/bahu-kale-ki-6d70a007-1da7-4352-b973-4b1dd2b746fa', 'Family drama', 'ब', 'devanagari', 4)`);

  await conn.query(`INSERT INTO videos (title, kind, duration, glyph, glyph_script, tone) VALUES
    ('Bhai Sahab — official trailer', 'CHAUPAL ORIGINAL · TRAILER', '2:31', 'ਭ', 'gurmukhi', 1),
    ('Kachhadhari — first look', 'HARYANVI · FIRST LOOK', '1:47', 'क', 'devanagari', 4),
    ('Sarpanchi 2024 — trailer', 'CHAUPAL ORIGINAL · TRAILER', '2:05', 'ਸ', 'gurmukhi', 2)`);

  await conn.query(`INSERT INTO sessions (title, meta, glyph_text, tone) VALUES
    ('Sur te saaz: the music that carries Punjabi cinema', 'INTERVIEW · 8 MIN READ', 'SUR TE SAAZ', 1),
    ('Set diary: 24 hours on a Chaupal Original', 'BEHIND THE SCENES · PHOTOS', 'SET DIARY', 2),
    ('Frame by frame: shooting the pind for the big screen', 'CRAFT · 6 MIN READ', 'FRAME BY FRAME', 3)`);

  await conn.query(`INSERT INTO calendar_items (release_date, title, boli, kind, is_tba) VALUES
    ('2026-10-02', 'BHAI SAHAB', 'pb', 'CHAUPAL ORIGINAL · SERIES', 0),
    ('2026-10-09', '[NEW TITLE]', 'hv', 'HARYANVI · SERIES', 0),
    ('2026-10-16', '[NEW TITLE]', 'bj', 'BHOJPURI · FILM', 0),
    ('2026-10-23', '[NEW TITLE]', 'pb', 'PUNJABI · FILM', 0),
    (NULL, 'Announcement soon', '', 'Follow Charcha for the reveal', 1)`);

  await conn.query(`INSERT INTO daily_stats (day_label, views) VALUES
    ('Mon', 4200), ('Tue', 5600), ('Wed', 4800), ('Thu', 6400), ('Fri', 10000), ('Sat', 8800), ('Sun', 7200)`);
}

module.exports = { essentialData, dummyData };
