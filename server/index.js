const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const db = require('./db');
const perm = require('./userPermissions');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

let SECRET = process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim();
if (!SECRET) {
  if (isProd) {
    console.error('JWT_SECRET is required in production. Set it in the environment (see .env.example).');
    process.exit(1);
  }
  SECRET = '119hs-dev-only-change-me';
}

const frontendOrigins = String(process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...frontendOrigins,
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProd) return callback(null, true);
      return callback(null, false);
    },
  })
);
app.use(express.json({ limit: '50mb' }));

const multer = require('multer');
const sitePhotoStore = require('./sitePhotoStore');
sitePhotoStore.ensureUploadsDir();
app.use('/uploads', express.static(sitePhotoStore.getUploadsDir()));

const uploadSitePhotoMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG and PNG are allowed'));
  },
});

const clientBuild = path.join(__dirname, '../client/build');
if (fs.existsSync(path.join(clientBuild, 'index.html'))) {
  app.use(express.static(clientBuild));
}

function auth(req, res, next) {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(t, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
function programmeEditor(req, res, next) {
  if (!perm.canEditProgrammeAndZones(req.user.role)) {
    return res.status(403).json({ error: 'Editor access required' });
  }
  next();
}
function completionWriter(req, res, next) {
  if (!perm.canTickCompletions(req.user.role)) {
    return res.status(403).json({ error: 'Not permitted to record completions' });
  }
  next();
}
function scheduleTabReader(req, res, next) {
  const tab = req.params.tab;
  if (perm.isAdminRole(req.user.role)) return next();
  const tabs = req.user.tabs || [];
  if (!tabs.includes(tab)) {
    return res.status(403).json({ error: 'Schedule tab not permitted' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.getUser(username);
  if (!u) return res.status(401).json({ error: 'Invalid' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign(
    { id: u.id, username: u.username, name: u.name, role: u.role, tabs: JSON.parse(u.tabs) },
    SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    user: { id: u.id, username: u.username, name: u.name, role: u.role, tabs: JSON.parse(u.tabs) },
  });
});

app.get('/api/site-photo', (req, res) => {
  res.json(sitePhotoStore.getSitePhotoStatus());
});

app.post('/api/admin/site-photo', auth, admin, (req, res, next) => {
  uploadSitePhotoMw.single('photo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large (max 5MB)' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'photo file required (JPG or PNG, max 5MB)' });
  }
  if (!['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Only JPG and PNG are allowed' });
  }
  try {
    const out = sitePhotoStore.saveSitePhoto(req.file.buffer, req.file.mimetype);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Save failed' });
  }
});

app.get('/api/schedule/:tab', auth, scheduleTabReader, (req, res) =>
  res.json(db.getSchedule(req.params.tab))
);
app.put('/api/schedule/:tab/:date', auth, admin, (req, res) => {
  db.setScheduleDay(req.params.tab, req.params.date, req.body.data);
  res.json({ ok: true });
});
app.post('/api/schedule/activity', auth, admin, (req, res) => {
  const { tab, date, tower, zone_name, activity } = req.body;
  db.addScheduleActivity(tab, date, tower, zone_name, activity);
  res.json({ ok: true });
});
app.delete('/api/schedule/activity', auth, admin, (req, res) => {
  const { tab, date, tower, zone_name, activity } = req.body;
  db.removeScheduleActivity(tab, date, tower, zone_name, activity);
  res.json({ ok: true });
});
app.get('/api/completions', auth, (req, res) => {
  const raw = db.getCompletions();
  res.json(perm.filterCompletionsForUser(db, req.user, raw));
});
app.post('/api/completions', auth, completionWriter, (req, res) => {
  const { date, key, by } = req.body || {};
  if (!date || key == null || String(key).trim() === '') {
    return res.status(400).json({ error: 'date and key required' });
  }
  const ks = String(key);
  if (!perm.completionKeyAllowedForUser(db, req.user, date, ks)) {
    return res.status(403).json({ error: 'Completion not permitted for this scope' });
  }
  const e = db.getCompletion(date, ks);
  if (e) {
    db.deleteCompletion(date, ks);
    res.json({ action: 'removed' });
  } else {
    db.addCompletion(date, ks, by);
    res.json({ action: 'added' });
  }
});
app.get('/api/milestones', auth, (req, res) => res.json(db.getMilestonesEnriched()));
app.post('/api/milestones', auth, admin, (req, res) => {
  const { date, label, status, completion_pct, programme_item_id } = req.body || {};
  if (!date || !String(date).trim() || !label || !String(label).trim()) {
    return res.status(400).json({ error: 'date and label required' });
  }
  const pct = Math.max(0, Math.min(100, Math.round(Number(completion_pct) || 0)));
  const pid =
    programme_item_id != null && programme_item_id !== '' ? Number(programme_item_id) : null;
  const id = db.addMilestone(
    String(date).trim(),
    String(label).trim(),
    status || 'planned',
    pct,
    Number.isFinite(pid) ? pid : null
  );
  res.json({ ok: true, id });
});
app.patch('/api/milestones/:id', auth, admin, (req, res) => {
  const ok = db.updateMilestone(Number(req.params.id), req.body || {});
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.delete('/api/milestones/:id', auth, admin, (req, res) => {
  db.deleteMilestone(Number(req.params.id));
  res.json({ ok: true });
});
app.get('/api/users', auth, admin, (req, res) =>
  res.json(db.getUsers().map((u) => ({ ...u, password_hash: undefined })))
);
app.post('/api/users', auth, admin, (req, res) => {
  const bcrypt = require('bcryptjs');
  const { username, password, name, role, tabs } = req.body;
  db.addUser(username, bcrypt.hashSync(password, 10), name, role, JSON.stringify(tabs));
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth, admin, (req, res) => {
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});
app.get('/api/drawings', auth, (req, res) =>
  res.json(perm.filterDrawingsForUser(req.user, db.getDrawings()))
);
app.get('/api/drawings/:id', auth, (req, res) => {
  const d = db.getDrawing(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const chk = perm.assertDrawingTabAllowed(db, req.user, req.params.id);
  if (!chk.ok) return res.status(403).json({ error: 'Drawing not permitted' });
  res.json(d);
});
app.get('/api/activities', auth, (req, res) =>
  res.json(perm.filterActivitiesForUser(req.user, db.getActivities()))
);
app.post('/api/activities', auth, admin, (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });
  const out = db.addActivity(name, type);
  if (out?.error === 'duplicate') return res.status(409).json({ error: 'Activity already exists' });
  if (out?.error) return res.status(400).json(out);
  res.json({ ok: true, id: out.id });
});
app.put('/api/activities/:id', auth, admin, (req, res) => {
  const out = db.renameActivity(req.params.id, req.body?.name);
  if (out?.error === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (out?.error === 'duplicate') return res.status(409).json({ error: 'Activity already exists' });
  if (out?.error === 'name_required') return res.status(400).json({ error: 'name required' });
  if (out?.error) return res.status(400).json({ error: String(out.error) });
  res.json({ ok: true });
});
app.delete('/api/activities/:id', auth, admin, (req, res) => {
  const out = db.deleteActivity(req.params.id);
  if (out?.error === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (out?.error === 'in_use_programme') return res.status(409).json({ error: 'Activity is used in programme items' });
  if (out?.error === 'in_use_zones') return res.status(409).json({ error: 'Activity is linked to zone activities' });
  if (out?.error === 'in_use_templates') return res.status(409).json({ error: 'Activity is used by at least one template' });
  if (out?.error) return res.status(400).json({ error: String(out.error) });
  res.json({ ok: true });
});
app.post('/api/drawings', auth, programmeEditor, (req, res) => {
  const { name, tab, floor, image_data, width, height, file_url } = req.body;
  if (!perm.isAdminRole(req.user.role)) {
    const tabs = req.user.tabs || [];
    if (!tabs.includes(tab)) return res.status(403).json({ error: 'Drawing tab not permitted' });
  }
  const r = db.addDrawing(name, tab, floor, image_data, width || 0, height || 0, file_url || null);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.delete('/api/drawings/:id', auth, admin, (req, res) => {
  db.deleteDrawing(req.params.id);
  res.json({ ok: true });
});
app.get('/api/zones', auth, (req, res) =>
  res.json(perm.filterZonesAllForUser(db, req.user, db.getAllZones()))
);
app.post('/api/zones/:zoneId/activities', auth, programmeEditor, (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const zchk = perm.assertZoneTabAllowed(db, req.user, zoneId);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  const { activity_id, sequence_order, duration_days, start_date } = req.body || {};
  if (activity_id == null) return res.status(400).json({ error: 'activity_id required' });
  const r = db.addZoneActivity(zoneId, activity_id, { sequence_order, duration_days, start_date });
  if (!r) return res.status(404).json({ error: 'Zone not found' });
  if (r.error === 'duplicate') return res.status(409).json({ error: 'Activity already linked' });
  res.json({ ok: true });
});
app.delete('/api/zones/:zoneId/activities/:activityId', auth, programmeEditor, (req, res) => {
  const zchk = perm.assertZoneTabAllowed(db, req.user, req.params.zoneId);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  db.deleteZoneActivity(Number(req.params.zoneId), Number(req.params.activityId));
  res.json({ ok: true });
});
app.put('/api/zones/:zoneId/activities', auth, programmeEditor, (req, res) => {
  const zchk = perm.assertZoneTabAllowed(db, req.user, req.params.zoneId);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  const ok = db.setZoneActivities(Number(req.params.zoneId), req.body.activities || []);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.get('/api/zones/:did', auth, (req, res) => {
  const chk = perm.assertDrawingTabAllowed(db, req.user, req.params.did);
  if (!chk.ok) return res.status(403).json({ error: 'Drawing not permitted' });
  res.json(db.getZones(req.params.did));
});
app.post('/api/zones', auth, programmeEditor, (req, res) => {
  const { drawing_id, name, tower, geometry, activity_id, x, y, w, h, activities } = req.body;
  const dchk = perm.assertDrawingTabAllowed(db, req.user, drawing_id);
  if (!dchk.ok) return res.status(403).json({ error: 'Drawing not permitted' });
  let geom = geometry;
  if (!geom && x != null && y != null && w != null && h != null) geom = { kind: 'rect', x, y, w, h };
  if (!geom) return res.status(400).json({ error: 'geometry required' });
  const r = db.addZone(drawing_id, name, tower, geom, activity_id ?? null);
  const zid = r.lastInsertRowid;
  if (Array.isArray(activities) && activities.length) {
    db.setZoneActivities(zid, activities);
  } else if (activity_id != null) {
    db.setZoneActivities(zid, [{ activity_id: Number(activity_id), sequence_order: 0, duration_days: 1 }]);
  }
  res.json({ ok: true, id: zid });
});
app.put('/api/zones/:id', auth, programmeEditor, (req, res) => {
  const zchk = perm.assertZoneTabAllowed(db, req.user, req.params.id);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  const ok = db.updateZone(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.delete('/api/zones/:id', auth, programmeEditor, (req, res) => {
  const zchk = perm.assertZoneTabAllowed(db, req.user, req.params.id);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  db.deleteZone(req.params.id);
  res.json({ ok: true });
});
app.post('/api/zones/:zoneId/schedule-from-target', auth, admin, (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const { anchor_activity_id, anchor_date, template_id } = req.body || {};
  if (anchor_activity_id == null || anchor_activity_id === '' || !String(anchor_date || '').trim()) {
    return res.status(400).json({ error: 'anchor_activity_id and anchor_date required' });
  }
  const out = db.scheduleFromTargetDate(zoneId, anchor_activity_id, anchor_date, template_id);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});
app.get('/api/plan/programme', auth, (req, res) => {
  const wantFull = req.query.full === '1' && perm.isAdminRole(req.user.role);
  const tabs = wantFull ? null : req.user.tabs && req.user.tabs.length ? req.user.tabs : ['groundworks', 'internals'];
  res.json(db.getPlanProgrammeRows(tabs));
});
app.get('/api/programme-items/drawing/:did', auth, (req, res) => {
  const chk = perm.assertDrawingTabAllowed(db, req.user, req.params.did);
  if (!chk.ok) return res.status(403).json({ error: 'Drawing not permitted' });
  res.json(db.getProgrammeItemsByDrawing(req.params.did));
});
app.get('/api/programme-items/zone/:zid', auth, (req, res) => {
  const chk = perm.assertZoneTabAllowed(db, req.user, req.params.zid);
  if (!chk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  res.json(db.getProgrammeItemsByZone(req.params.zid));
});
app.post('/api/programme-items', auth, programmeEditor, (req, res) => {
  const { zone_id, activity_id, start_date, end_date, status, notes } = req.body;
  if (!zone_id || !activity_id || !start_date || !end_date) return res.status(400).json({ error: 'Missing fields' });
  const zchk = perm.assertZoneTabAllowed(db, req.user, zone_id);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  const r = db.addProgrammeItem(zone_id, activity_id, start_date, end_date, status, notes);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/programme-items/:id', auth, programmeEditor, (req, res) => {
  const old = db.getProgrammeItemById(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const oldChk = perm.assertZoneTabAllowed(db, req.user, old.zone_id);
  if (!oldChk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  const patch = req.body || {};
  const nextZoneId = patch.zone_id != null ? patch.zone_id : old.zone_id;
  const nextChk = perm.assertZoneTabAllowed(db, req.user, nextZoneId);
  if (!nextChk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  const ok = db.updateProgrammeItem(req.params.id, patch);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.delete('/api/programme-items/:id', auth, programmeEditor, (req, res) => {
  const old = db.getProgrammeItemById(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const zchk = perm.assertZoneTabAllowed(db, req.user, old.zone_id);
  if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
  db.deleteProgrammeItem(req.params.id);
  res.json({ ok: true });
});
app.get('/api/templates', auth, (req, res) =>
  res.json(perm.filterTemplatesForUser(req.user, db.getTemplates()))
);
app.post('/api/templates', auth, admin, (req, res) => {
  const { name, tab, tower, zone_name, sequence, durations } = req.body;
  const r = db.addTemplate(name, tab, tower, zone_name, JSON.stringify(sequence), JSON.stringify(durations));
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/templates/:id', auth, admin, (req, res) => {
  const ok = db.updateTemplate(Number(req.params.id), req.body || {});
  if (!ok) return res.status(404).json({ error: 'Not found' });
  const synced = db.syncProgrammesForTemplate(Number(req.params.id));
  res.json({ ok: true, synced });
});
app.delete('/api/templates/:id', auth, admin, (req, res) => {
  db.deleteTemplate(req.params.id);
  res.json({ ok: true });
});
app.post('/api/templates/apply', auth, admin, (req, res) => {
  const { tab, tower, zone_name, sequence, durations, startDate } = req.body;
  db.applyTemplate(tab, tower, zone_name, JSON.stringify(sequence), JSON.stringify(durations), startDate);
  res.json({ ok: true });
});
app.post('/api/admin/reset-programme-data', auth, admin, (req, res) => {
  const out = db.resetProgrammeData();
  res.json({ ok: true, ...out });
});
app.put('/api/plan/admin/zone/:zoneId/items', auth, admin, (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const out = db.replaceZoneProgrammeItems(zoneId, rows);
  if (out.error) return res.status(400).json(out);
  res.json({ ok: true });
});
app.post('/api/plan/admin/restore-zone', auth, admin, (req, res) => {
  const out = db.restoreZoneSnapshot(req.body?.snapshot);
  if (out.error) return res.status(400).json(out);
  res.json({ ok: true });
});
app.delete('/api/plan/admin/zone/:zoneId', auth, admin, (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const z = db.getZoneById(zoneId);
  if (!z) return res.status(404).json({ error: 'Zone not found' });
  const zoneWithActs = (db.getAllZones() || []).find((x) => Number(x.id) === zoneId);
  const snapshot = {
    zone: z,
    zone_activities: Array.isArray(zoneWithActs?.activities) ? zoneWithActs.activities : [],
    programme_items: db.getProgrammeItemsByZone(zoneId),
  };
  db.deleteZone(zoneId);
  res.json({ ok: true, snapshot });
});

const spaIndex = path.join(clientBuild, 'index.html');
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.path.startsWith('/uploads')) return next();
  if (!fs.existsSync(spaIndex)) return res.status(503).send('Client build not found. Run npm run build in client/.');
  res.sendFile(spaIndex);
});

db.init()
  .then(() => {
    const programmeCommandService = require('./programmeCommandService');
    app.post('/api/admin/programme-command/preview', auth, admin, async (req, res) => {
      try {
        const command = String(req.body?.command || '').trim();
        if (!command) return res.status(400).json({ error: 'command required' });
        const username = req.user?.username || req.user?.name || 'admin';
        const out = await programmeCommandService.previewCommand(command, username);
        res.json(out);
      } catch (e) {
        res.status(500).json({ ok: false, unknown: true, message: e.message });
      }
    });
    app.post('/api/admin/programme-command/apply', auth, admin, (req, res) => {
      try {
        const command = String(req.body?.command || '').trim();
        const action = req.body?.action;
        if (!command || action == null || typeof action !== 'object') {
          return res.status(400).json({ error: 'command and action required' });
        }
        const username = req.user?.username || req.user?.name || 'admin';
        const out = programmeCommandService.applyAction(action, username, command);
        if (!out.ok) return res.status(400).json(out);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    app.listen(PORT, () => {
      console.log(`119HS server listening (${NODE_ENV})`);
    });
  })
  .catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });
