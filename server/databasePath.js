const path = require('path');

/**
 * SQLite file on Render’s persistent disk (same directory as uploaded site photos).
 * Set `DATABASE_PATH` in the Render dashboard to this path so the DB survives redeploys.
 */
const RENDER_DISK_DATABASE_FILE =
  '/opt/render/project/src/server/public/uploads/119hs.db';

function resolveDatabasePath() {
  const env = process.env.DATABASE_PATH;
  if (env != null && String(env).trim()) {
    const raw = String(env).trim();
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  if (process.env.RENDER === 'true') {
    return RENDER_DISK_DATABASE_FILE;
  }
  return path.resolve(process.cwd(), 'data', '119hs.db');
}

module.exports = {
  resolveDatabasePath,
  RENDER_DISK_DATABASE_FILE,
};
