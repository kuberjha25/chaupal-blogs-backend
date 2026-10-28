/* One-off, idempotent: adds the old WordPress /category/<slug> categories to an EXISTING database and drops the
   old "/category/x → /#latest" redirects (those URLs are real pages now). Safe to re-run; never deletes posts/categories.
   Usage: node database/migrate-categories.js */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { LEGACY_CATEGORIES } = require('./data');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'chaupal_charcha',
  });
  let added = 0;
  for (const [name, slug] of LEGACY_CATEGORIES) {
    const [r] = await conn.query(`INSERT IGNORE INTO categories (name, slug, kind) VALUES (?, ?, 'category')`, [name, slug]);
    added += r.affectedRows;
  }
  const paths = LEGACY_CATEGORIES.flatMap(([, slug]) => [`/category/${slug}`, `/category/${slug}/`]);
  const [d] = await conn.query(`DELETE FROM redirects WHERE from_path IN (?) AND to_path LIKE '/#%'`, [paths]);
  console.log(`categories added: ${added}, old anchor redirects removed: ${d.affectedRows}`);
  await conn.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
