/* Image storage service.
   NOW: local folder (backend/uploads) — every image is converted to WebP with sharp and saved.
   LATER (S3): only save/remove inside this file need to change to S3 putObject/deleteObject.
   The rest of the app only uses storage.save() / storage.remove(). */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { slugify } = require('./utils');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* buffer (any image format) → webp file. Returns saved file info. */
async function save(buffer, originalName) {
  const base = slugify(path.parse(originalName || 'image').name).slice(0, 50) || 'image';
  const filename = `${Date.now()}-${base}.webp`;

  const webp = await sharp(buffer)
    .rotate() // EXIF orientation fix
    .resize({ width: 2000, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const meta = await sharp(webp).metadata();
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), webp);

  return {
    filename,
    urlPath: `/uploads/${filename}`,
    width: meta.width || null,
    height: meta.height || null,
    sizeBytes: webp.length,
  };
}

async function remove(filename) {
  try {
    await fs.promises.unlink(path.join(UPLOAD_DIR, filename));
  } catch (e) {
    /* file already gone — ignore */
  }
}

module.exports = { save, remove, UPLOAD_DIR };
