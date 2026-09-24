const router = require('express').Router();
const multer = require('multer');
const { q } = require('../db');
const { a } = require('../utils');
const storage = require('../storage');
const { requireAuth, requirePerm } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Sirf image files upload ho sakdiyan'));
  },
});

router.use(requireAuth, requirePerm('media,edit-content'));

router.get(
  '/',
  a(async (req, res) => {
    const rows = await q(
      `SELECT m.*, u.name AS uploaded_by_name FROM media m
       LEFT JOIN users u ON u.id = m.uploaded_by
       ORDER BY m.created_at DESC LIMIT 200`
    );
    res.json({ media: rows });
  })
);

/* Koi bhi image aaye — JPG/PNG/GIF — save hamesha WebP hi hovega */
router.post(
  '/',
  upload.single('file'),
  a(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File nahi mili (field name: file)' });
    const saved = await storage.save(req.file.buffer, req.file.originalname);
    const r = await q(
      `INSERT INTO media (filename, original_name, url_path, mime, width, height, size_bytes, alt, uploaded_by)
       VALUES (?, ?, ?, 'image/webp', ?, ?, ?, ?, ?)`,
      [
        saved.filename, req.file.originalname, saved.urlPath,
        saved.width, saved.height, saved.sizeBytes,
        (req.body && req.body.alt) || '', req.user.id,
      ]
    );
    const rows = await q('SELECT * FROM media WHERE id = ?', [r.insertId]);
    res.json({ ok: true, media: rows[0] });
  })
);

router.delete(
  '/:id',
  requirePerm('delete'),
  a(async (req, res) => {
    const rows = await q('SELECT filename FROM media WHERE id = ?', [req.params.id]);
    if (rows[0]) await storage.remove(rows[0].filename);
    await q('UPDATE posts SET featured_media_id = NULL WHERE featured_media_id = ?', [req.params.id]);
    await q('DELETE FROM media WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
