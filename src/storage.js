/* Image storage service.
   ABHI: local folder (backend/uploads) — har image sharp se WebP me convert ho ke save hoti hai.
   BAAD ME (S3): sirf is file ke andar save/remove ko S3 putObject/deleteObject se badalna hai.
   Baaki poora app storage.save() / storage.remove() hi use karta hai. */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { slugify } = require('./utils');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* buffer (koi bhi image format) → webp file. Returns saved file info. */
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
