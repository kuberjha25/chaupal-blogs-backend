-- Chaupal Te Charcha — MySQL schema
-- seed.js ise run karda hai (database create + tables). Manually bhi chala sakde ho.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','author','seo','marketing') NOT NULL DEFAULT 'author',
  last_active DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  kind ENUM('boli','category') NOT NULL DEFAULT 'category'
);

CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(180) NOT NULL,
  original_name VARCHAR(180) NULL,
  url_path VARCHAR(220) NOT NULL,
  mime VARCHAR(40) DEFAULT 'image/webp',
  width INT NULL,
  height INT NULL,
  size_bytes INT NULL,
  alt VARCHAR(200) DEFAULT '',
  uploaded_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  dek VARCHAR(400) DEFAULT '',
  slug VARCHAR(120) NOT NULL UNIQUE,
  body_html LONGTEXT,
  boli_id INT NULL,
  category_id INT NULL,
  author_id INT NULL,
  featured_media_id INT NULL,
  status ENUM('draft','review','scheduled','published') DEFAULT 'draft',
  published_at DATETIME NULL,
  scheduled_at DATETIME NULL,
  views INT DEFAULT 0,
  read_minutes TINYINT DEFAULT 5,
  is_featured TINYINT(1) DEFAULT 0,
  ghost_glyph VARCHAR(8) DEFAULT 'ਚ',
  glyph_script ENUM('gurmukhi','devanagari','display') DEFAULT 'gurmukhi',
  art_tone TINYINT DEFAULT 1,
  seo_title VARCHAR(160) DEFAULT '',
  seo_description VARCHAR(300) DEFAULT '',
  focus_keyword VARCHAR(120) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_slug (slug),
  CONSTRAINT fk_posts_boli FOREIGN KEY (boli_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_media FOREIGN KEY (featured_media_id) REFERENCES media(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  CONSTRAINT fk_pt_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  author_name VARCHAR(80) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('pending','approved','spam') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_c_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  status ENUM('live','ended') DEFAULT 'live',
  plays INT DEFAULT 0,
  config_json LONGTEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS polls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question VARCHAR(220) NOT NULL,
  status ENUM('live','ended') DEFAULT 'live',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS poll_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  poll_id INT NOT NULL,
  label VARCHAR(80) NOT NULL,
  votes INT DEFAULT 0,
  CONSTRAINT fk_po_poll FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  source VARCHAR(40) DEFAULT 'site',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  channel VARCHAR(120) DEFAULT '',
  base_url VARCHAR(300) DEFAULT '',
  utm_source VARCHAR(80) DEFAULT '',
  utm_medium VARCHAR(80) DEFAULT '',
  utm_campaign VARCHAR(120) DEFAULT '',
  clicks INT DEFAULT 0,
  signups INT DEFAULT 0,
  status ENUM('live','ended') DEFAULT 'live',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS redirects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_path VARCHAR(300) NOT NULL UNIQUE,
  to_path VARCHAR(300) NOT NULL,
  code SMALLINT DEFAULT 301,
  hits INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS seo_keywords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  keyword VARCHAR(160) NOT NULL,
  position INT DEFAULT 0,
  delta INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rank_no TINYINT NOT NULL,
  title VARCHAR(120) NOT NULL,
  boli VARCHAR(40) NOT NULL,
  link VARCHAR(300) DEFAULT '',
  glyph VARCHAR(8) DEFAULT 'ਚ',
  glyph_script ENUM('gurmukhi','devanagari','display') DEFAULT 'gurmukhi',
  tone TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS watch_picks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  why VARCHAR(240) NOT NULL,
  link VARCHAR(300) NOT NULL,
  mood VARCHAR(40) NOT NULL,
  glyph VARCHAR(8) DEFAULT 'ਚ',
  glyph_script ENUM('gurmukhi','devanagari','display') DEFAULT 'gurmukhi',
  tone TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  kind VARCHAR(60) NOT NULL,
  duration VARCHAR(10) DEFAULT '',
  glyph VARCHAR(8) DEFAULT 'ਚ',
  glyph_script ENUM('gurmukhi','devanagari','display') DEFAULT 'gurmukhi',
  tone TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  meta VARCHAR(120) NOT NULL,
  glyph_text VARCHAR(40) NOT NULL,
  tone TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS calendar_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  release_date DATE NULL,
  title VARCHAR(120) NOT NULL,
  boli VARCHAR(40) DEFAULT '',
  kind VARCHAR(60) DEFAULT '',
  is_tba TINYINT(1) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  day_label VARCHAR(10) NOT NULL,
  views INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(60) PRIMARY KEY,
  svalue LONGTEXT
);
