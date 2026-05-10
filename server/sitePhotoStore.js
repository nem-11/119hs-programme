/**
 * Site login hero image stored under server/public/uploads/.
 * On Render, mount persistent disk at …/server/public/uploads (same folder as DATABASE_PATH / 119hs.db).
 * For CDN-only hosting, replace POST /api/admin/site-photo + this module with S3 (or similar).
 */
const fs = require('fs');
const path = require('path');

const META_NAME = 'site-photo.meta.json';

function getUploadsDir() {
  return path.join(__dirname, 'public', 'uploads');
}

function ensureUploadsDir() {
  const dir = getUploadsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function metaPath() {
  return path.join(getUploadsDir(), META_NAME);
}

function readMeta() {
  try {
    const p = metaPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function getSitePhotoStatus() {
  ensureUploadsDir();
  const meta = readMeta();
  if (!meta || !meta.url || !meta.updated_at) {
    return { url: null, updated_at: null };
  }
  const basename = path.basename(meta.url);
  const filePath = path.join(getUploadsDir(), basename);
  if (!fs.existsSync(filePath)) {
    return { url: null, updated_at: null };
  }
  return { url: meta.url, updated_at: meta.updated_at };
}

function saveSitePhoto(buffer, mimetype) {
  ensureUploadsDir();
  const dir = getUploadsDir();
  const ext = mimetype === 'image/png' ? '.png' : '.jpg';
  const filename = `site-photo${ext}`;
  const url = `/uploads/${filename}`;

  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f === META_NAME || !f.startsWith('site-photo.')) continue;
      if (f !== filename) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  } catch (_) {}

  fs.writeFileSync(path.join(dir, filename), buffer);
  const updated_at = new Date().toISOString();
  fs.writeFileSync(metaPath(), JSON.stringify({ url, updated_at }));
  return { url, updated_at };
}

module.exports = {
  ensureUploadsDir,
  getUploadsDir,
  getSitePhotoStatus,
  saveSitePhoto,
};
