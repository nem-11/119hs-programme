const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { dateKeysBetween, bboxFromGeom } = require('./programmeSync');
const schedule = require('./programmeSchedule');
const { resolveDatabasePath } = require('./databasePath');
const { DEFAULT_PROGRAMME_TEMPLATES } = require('./defaultTemplates');

const GW_NAMES = [
  'Pile Mat',
  'Piling',
  'Crop Piles',
  'Cure',
  'Form Pile Cap',
  'Cage Pile Cap',
  'Pour Pile Cap',
  'Blinding',
  'Drainage',
  'Insulation',
  'Waterproofing',
  'Reinforcement - Shuttering',
  'Pour',
  'Verts',
  'Podium Pour',
];
const INT_NAMES = [
  'Riser Stitching',
  'Corridor Ceiling Stitch',
  'Modular Ceiling Stitch',
  'Modular Floor Stitch',
  'Form Door Aperture',
  'Corridor Floor Stitch',
  'Stair Core Stitching',
  'MEP Riser',
  'MEP Corridor',
  'Ceiling Install',
  'Install Ceiling Panels',
  'Modular Linear Stitch',
  'Install Fire Doors',
  'Paint',
  'Commission',
];

/** Starter activity names for the project_programme drawing tab (more can be added in Templates). */
const PROJECT_PROGRAMME_NAMES = [
  'Programme milestone',
  'Design / approval gate',
  'Procurement / long lead',
  'External / enabling works',
  'Handover / commissioning block',
];

let db;

function save() {
  if (db) fs.writeFileSync(resolveDatabasePath(), Buffer.from(db.export()));
}
/** Single statement without persisting — use inside batched ops, then call save() once. */
function runNoSave(sql, p) {
  db.run(sql, p);
}
function run(sql, p) {
  db.run(sql, p);
  save();
}
function get(sql, p) {
  const s = db.prepare(sql);
  if (p) s.bind(p);
  if (s.step()) {
    const r = s.getAsObject();
    s.free();
    return r;
  }
  s.free();
  return null;
}
function all(sql, p) {
  const s = db.prepare(sql);
  if (p) s.bind(p);
  const r = [];
  while (s.step()) r.push(s.getAsObject());
  s.free();
  return r;
}

function expandScheduleForItem(pi) {
  if (!pi) return;
  const z = get(
    'SELECT z.*, d.tab FROM zones z JOIN drawings d ON d.id=z.drawing_id WHERE z.id=?',
    [pi.zone_id]
  );
  const a = get('SELECT name FROM activities WHERE id=?', [pi.activity_id]);
  if (!z || !a) return;
  const dates = dateKeysBetween(pi.start_date, pi.end_date);
  dates.forEach((dk) => {
    try {
      run(
        'INSERT OR IGNORE INTO schedule (tab,date,tower,zone_name,activity) VALUES (?,?,?,?,?)',
        [z.tab, dk, z.tower, z.name, a.name]
      );
    } catch (_) {}
  });
}

function shrinkScheduleForItem(pi, opts) {
  if (!pi) return;
  const deferSave = opts && opts.deferSave;
  if (!String(pi.start_date || '').trim() || !String(pi.end_date || '').trim()) return;
  const z = get(
    'SELECT z.*, d.tab FROM zones z JOIN drawings d ON d.id=z.drawing_id WHERE z.id=?',
    [pi.zone_id]
  );
  const a = get('SELECT name FROM activities WHERE id=?', [pi.activity_id]);
  if (!z || !a) return;
  const tabVal = z.tab != null ? String(z.tab) : '';
  const dates = dateKeysBetween(pi.start_date, pi.end_date);
  const sql =
    'DELETE FROM schedule WHERE tab=? AND date=? AND tower=? AND zone_name=? AND activity=?';
  dates.forEach((dk) => {
    const params = [tabVal, dk, z.tower, z.name, a.name];
    if (deferSave) runNoSave(sql, params);
    else run(sql, params);
  });
}

function seedActivities() {
  const cnt = get('SELECT COUNT(*) as c FROM activities');
  if (cnt && Number(cnt.c) > 0) return;
  GW_NAMES.forEach((name) => {
    try {
      run('INSERT OR IGNORE INTO activities (name,type) VALUES (?,?)', [name, 'groundworks']);
    } catch (_) {}
  });
  INT_NAMES.forEach((name) => {
    try {
      run('INSERT OR IGNORE INTO activities (name,type) VALUES (?,?)', [name, 'internals']);
    } catch (_) {}
  });
}

/** Ensures project-programme activity types exist even when GW/INT seed already ran. */
function seedProjectProgrammeActivities() {
  PROJECT_PROGRAMME_NAMES.forEach((name) => {
    try {
      run('INSERT OR IGNORE INTO activities (name,type) VALUES (?,?)', [name, 'project_programme']);
    } catch (_) {}
  });
}

function roleGetsProjectProgrammeTab(role) {
  return (
    role === 'admin' ||
    role === 'site_editor' ||
    role === 'editor' ||
    role === 'gw_subbie' ||
    role === 'int_subbie'
  );
}

/** Add project_programme tab only for roles that should manage milestones (admin/site). */
function migrateUserTabsProjectProgramme() {
  const users = all('SELECT id, tabs, role FROM users');
  const tab = 'project_programme';
  const sortKey = (x) => ({ groundworks: 0, internals: 1, project_programme: 2 }[x] ?? 99);
  for (const u of users) {
    if (!roleGetsProjectProgrammeTab(u.role)) continue;
    let t = [];
    try {
      t = JSON.parse(u.tabs || '[]');
    } catch (_) {}
    if (!Array.isArray(t)) t = [];
    if (t.includes(tab)) continue;
    t.push(tab);
    t.sort((a, b) => sortKey(a) - sortKey(b) || String(a).localeCompare(String(b)));
    run('UPDATE users SET tabs=? WHERE id=?', [JSON.stringify(t), u.id]);
  }
  save();
}

/** Sync role + tabs for standard programme accounts from defaultUsers.js (live RBAC matrix). */
function migrateDefaultUserRoles() {
  const { DEFAULT_BOOTSTRAP_USERS } = require('./defaultUsers');
  const byUser = new Map(DEFAULT_BOOTSTRAP_USERS.map((u) => [u.username, u]));
  const rows = all('SELECT id, username FROM users');
  for (const row of rows) {
    const spec = byUser.get(row.username);
    if (!spec) continue;
    run('UPDATE users SET role=?, tabs=? WHERE id=?', [
      spec.role,
      JSON.stringify(spec.tabs),
      row.id,
    ]);
  }
  save();
}

function migrateZoneActivitiesTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS zone_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      duration_days INTEGER NOT NULL DEFAULT 1,
      start_date TEXT,
      FOREIGN KEY (zone_id) REFERENCES zones(id),
      FOREIGN KEY (activity_id) REFERENCES activities(id)
    )
  `);
  save();
  try {
    db.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_activities_zone_activity ON zone_activities(zone_id, activity_id)'
    );
    save();
  } catch (_) {}
  const legacy = all('SELECT id, activity_id FROM zones WHERE activity_id IS NOT NULL');
  legacy.forEach((z) => {
    const dup = get('SELECT id FROM zone_activities WHERE zone_id=? AND activity_id=?', [
      z.id,
      z.activity_id,
    ]);
    if (!dup) {
      run(
        'INSERT INTO zone_activities (zone_id, activity_id, sequence_order, duration_days, start_date) VALUES (?,?,?,?,?)',
        [z.id, z.activity_id, 0, 1, null]
      );
    }
  });
  save();
}

function attachActivitiesToZones(zoneRows) {
  if (!zoneRows.length) return zoneRows;
  const ids = zoneRows.map((z) => z.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = all(
    `SELECT za.id AS za_id, za.zone_id, za.activity_id, za.sequence_order, za.duration_days, za.start_date, a.name AS activity_name
     FROM zone_activities za
     JOIN activities a ON a.id = za.activity_id
     WHERE za.zone_id IN (${placeholders})
     ORDER BY za.zone_id, za.sequence_order ASC, za.id ASC`,
    ids
  );
  const byZone = {};
  rows.forEach((r) => {
    if (!byZone[r.zone_id]) byZone[r.zone_id] = [];
    byZone[r.zone_id].push({
      id: r.za_id,
      activity_id: r.activity_id,
      name: r.activity_name,
      sequence_order: r.sequence_order,
      duration_days: r.duration_days,
      start_date: r.start_date,
    });
  });
  return zoneRows.map((z) => ({
    ...z,
    activities: byZone[z.id] || [],
  }));
}

/**
 * Older production boots only inserted `admin`. Add site / DBs / IKEW / board if they are missing (idempotent).
 * Does not change existing passwords or overwrite admin.
 */
function ensureStandardProgrammeUsers() {
  const { DEFAULT_BOOTSTRAP_USERS } = require('./defaultUsers');
  for (const row of DEFAULT_BOOTSTRAP_USERS) {
    if (row.username === 'admin' || !row.passwordPlain) continue;
    const existing = get('SELECT id FROM users WHERE username=?', [row.username]);
    if (existing) continue;
    try {
      run('INSERT INTO users (username,password_hash,name,role,tabs) VALUES (?,?,?,?,?)', [
        row.username,
        bcrypt.hashSync(row.passwordPlain, 10),
        row.name,
        row.role,
        JSON.stringify(row.tabs),
      ]);
      console.log('[119HS] Added missing programme user:', row.username);
    } catch (e) {
      console.error('[119HS] Could not add user', row.username, e.message);
    }
  }
}

/** First boot on an empty database: all standard programme users + starter templates (no demo schedule). */
function bootstrapEmptyDatabase() {
  const cnt = get('SELECT COUNT(*) as c FROM users');
  if (cnt && Number(cnt.c) > 0) return;

  const isProd = process.env.NODE_ENV === 'production';
  const fromEnv = process.env.SEED_ADMIN_PASSWORD && String(process.env.SEED_ADMIN_PASSWORD).trim();
  let adminPw = fromEnv;
  if (!adminPw) {
    if (isProd) {
      console.error(
        '[119HS] Empty database: set SEED_ADMIN_PASSWORD in the environment for the first admin user, then restart. No default password is used in production.'
      );
      process.exit(1);
    }
    adminPw = '119hs';
    console.log('[119HS] Bootstrap (dev only): admin password 119hs; creating standard programme users.');
  } else if (isProd) {
    console.log('[119HS] Bootstrap: creating admin + standard programme users (site, DBs, IKEW, board).');
  } else {
    console.log('[119HS] Bootstrap: admin from SEED_ADMIN_PASSWORD; creating standard programme users.');
  }

  const { DEFAULT_BOOTSTRAP_USERS } = require('./defaultUsers');

  try {
    for (const row of DEFAULT_BOOTSTRAP_USERS) {
      const plain = row.username === 'admin' ? adminPw : row.passwordPlain;
      if (!plain) {
        console.error('[119HS] Bootstrap: skipped user with no password:', row.username);
        continue;
      }
      run('INSERT INTO users (username,password_hash,name,role,tabs) VALUES (?,?,?,?,?)', [
        row.username,
        bcrypt.hashSync(plain, 10),
        row.name,
        row.role,
        JSON.stringify(row.tabs),
      ]);
    }
  } catch (e) {
    console.error('[119HS] Bootstrap users failed:', e.message);
    return;
  }

  const tplCnt = get('SELECT COUNT(*) as c FROM templates');
  if (tplCnt && Number(tplCnt.c) > 0) return;

  try {
    for (const t of DEFAULT_PROGRAMME_TEMPLATES) {
      run('INSERT INTO templates (name,tab,tower,zone_name,sequence,durations) VALUES (?,?,?,?,?,?)', [
        t.name,
        t.tab,
        t.tower,
        t.zone_name,
        JSON.stringify(t.sequence),
        JSON.stringify(t.durations),
      ]);
    }
    if (!isProd) {
      console.log('[119HS] Bootstrap: added', DEFAULT_PROGRAMME_TEMPLATES.length, 'programme templates.');
    }
  } catch (e) {
    console.error('[119HS] Bootstrap templates failed:', e.message);
  }
}

/** Re-insert GW Standard / INT Floor if missing (e.g. DB wiped templates but users remained). */
function ensureDefaultTemplates() {
  for (const t of DEFAULT_PROGRAMME_TEMPLATES) {
    const row = get('SELECT id FROM templates WHERE name=? AND tab=?', [t.name, t.tab]);
    if (row) continue;
    try {
      run('INSERT INTO templates (name,tab,tower,zone_name,sequence,durations) VALUES (?,?,?,?,?,?)', [
        t.name,
        t.tab,
        t.tower,
        t.zone_name,
        JSON.stringify(t.sequence),
        JSON.stringify(t.durations),
      ]);
      console.log('[119HS] Restored default template:', t.name, `(${t.tab})`);
    } catch (e) {
      console.error('[119HS] ensureDefaultTemplates:', t.name, e.message);
    }
  }
}

function migrateZonesGeometry() {
  const rows = all(
    "SELECT * FROM zones WHERE geometry IS NULL OR geometry = '' OR geometry = 'null'"
  );
  const now = new Date().toISOString();
  rows.forEach((z) => {
    const geom = JSON.stringify({ kind: 'rect', x: z.x, y: z.y, w: z.w, h: z.h });
    let aid = z.activity_id != null ? z.activity_id : null;
    if (aid == null && z.linked_activity) {
      const a = get('SELECT id FROM activities WHERE name=?', [z.linked_activity]);
      if (a) aid = a.id;
    }
    run(
      'UPDATE zones SET geometry=?, activity_id=COALESCE(activity_id,?), created_at=COALESCE(created_at,?), updated_at=? WHERE id=?',
      [geom, aid, now, now, z.id]
    );
  });
}

async function getDb() {
  if (db) return db;
  const sqlDbPath = resolveDatabasePath();
  const dir = path.dirname(sqlDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const SQL = await initSqlJs();
  if (fs.existsSync(sqlDbPath)) {
    db = new SQL.Database(fs.readFileSync(sqlDbPath));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', tabs TEXT NOT NULL DEFAULT '["groundworks"]');
    CREATE TABLE IF NOT EXISTS drawings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tab TEXT NOT NULL DEFAULT 'groundworks', floor TEXT NOT NULL DEFAULT 'ground', image_data TEXT NOT NULL, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS zones (id INTEGER PRIMARY KEY AUTOINCREMENT, drawing_id INTEGER NOT NULL, name TEXT NOT NULL, tower TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, tab TEXT NOT NULL, date TEXT NOT NULL, tower TEXT NOT NULL, zone_name TEXT NOT NULL, activity TEXT NOT NULL, UNIQUE(tab, date, tower, zone_name, activity));
    CREATE TABLE IF NOT EXISTS completions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, key TEXT NOT NULL, completed_by TEXT NOT NULL, completed_at TEXT NOT NULL, UNIQUE(date, key));
    CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned');
    CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tab TEXT NOT NULL, tower TEXT NOT NULL, zone_name TEXT NOT NULL, sequence TEXT NOT NULL, durations TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL DEFAULT 'groundworks');
    CREATE TABLE IF NOT EXISTS programme_items (id INTEGER PRIMARY KEY AUTOINCREMENT, zone_id INTEGER NOT NULL, activity_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', notes TEXT DEFAULT '');
  `);
  try {
    db.run('ALTER TABLE zones ADD COLUMN linked_activity TEXT');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE drawings ADD COLUMN file_url TEXT');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE zones ADD COLUMN geometry TEXT');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE zones ADD COLUMN activity_id INTEGER');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE zones ADD COLUMN created_at TEXT');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE zones ADD COLUMN updated_at TEXT');
    save();
  } catch (_) {}

  seedActivities();
  seedProjectProgrammeActivities();
  migrateZonesGeometry();
  migrateZoneActivitiesTable();
  migrateZoneProgrammeMeta();
  migrateProgrammeCommandLog();
  migrateMilestonesCompletionPct();
  migrateMilestonesProgrammeItemId();
  bootstrapEmptyDatabase();
  ensureStandardProgrammeUsers();
  ensureDefaultTemplates();
  migrateDefaultUserRoles();
  migrateUserTabsProjectProgramme();
  save();
  return db;
}

function migrateZoneProgrammeMeta() {
  try {
    db.run('ALTER TABLE zones ADD COLUMN source_template_id INTEGER');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE zones ADD COLUMN programme_stage_idx INTEGER');
    save();
  } catch (_) {}
  try {
    db.run('ALTER TABLE zones ADD COLUMN programme_anchor_date TEXT');
    save();
  } catch (_) {}
}

function migrateProgrammeCommandLog() {
  db.run(`
    CREATE TABLE IF NOT EXISTS programme_command_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      username TEXT NOT NULL,
      command_text TEXT NOT NULL,
      parsed_action TEXT,
      phase TEXT NOT NULL,
      error_message TEXT
    )
  `);
  save();
}

function migrateMilestonesCompletionPct() {
  try {
    db.run('ALTER TABLE milestones ADD COLUMN completion_pct INTEGER NOT NULL DEFAULT 0');
    save();
  } catch (_) {}
}

function migrateMilestonesProgrammeItemId() {
  try {
    db.run('ALTER TABLE milestones ADD COLUMN programme_item_id INTEGER');
    save();
  } catch (_) {}
}

/** Matches Update screen completion keys (pfx|activity). */
function completionKeyFromParts(tower, zoneName, activity) {
  const tw = String(tower || '').trim();
  const zn = String(zoneName || '').trim();
  const act = String(activity || '').trim();
  const pfx = zn === '_default' ? tw : `${tw}|${zn}`;
  return `${pfx}|${act}`;
}

/** Share of scheduled day-slots for this programme item that have a completion tick. */
function computeLiveCompletionFromProgrammeItem(piId, compMap) {
  const pi = get(
    `SELECT pi.start_date, pi.end_date, z.name AS zone_name, z.tower, d.tab AS drawing_tab, a.name AS activity_name
     FROM programme_items pi
     JOIN zones z ON z.id = pi.zone_id
     JOIN drawings d ON d.id = z.drawing_id
     JOIN activities a ON a.id = pi.activity_id
     WHERE pi.id = ?`,
    [piId]
  );
  if (!pi) return null;
  const key = completionKeyFromParts(pi.tower, pi.zone_name, pi.activity_name);
  const rows = all(
    `SELECT date FROM schedule WHERE tab=? AND tower=? AND zone_name=? AND activity=? AND date >= ? AND date <= ? ORDER BY date`,
    [
      pi.drawing_tab,
      pi.tower,
      pi.zone_name,
      pi.activity_name,
      pi.start_date,
      pi.end_date,
    ]
  );
  if (!rows.length) return { pct: 0, done: 0, total: 0 };
  let done = 0;
  for (const r of rows) {
    if (compMap[r.date] && compMap[r.date][key]) done++;
  }
  const total = rows.length;
  const pct = Math.round((done / total) * 100);
  return { pct, done, total };
}

function enrichMilestoneRow(m, compMap) {
  const stored = Math.max(0, Math.min(100, Math.round(Number(m.completion_pct) || 0)));
  let completion_pct = stored;
  let tracks_live = false;
  let live_ticks_done = 0;
  let live_ticks_total = 0;
  const pid =
    m.programme_item_id != null && m.programme_item_id !== ''
      ? Number(m.programme_item_id)
      : null;
  if (pid != null && Number.isFinite(pid)) {
    const live = computeLiveCompletionFromProgrammeItem(pid, compMap);
    if (live) {
      tracks_live = true;
      live_ticks_done = live.done;
      live_ticks_total = live.total;
      completion_pct = live.total > 0 ? live.pct : 0;
    }
  }
  return {
    ...m,
    completion_pct,
    completion_pct_manual: stored,
    tracks_live,
    ...(tracks_live ? { live_ticks_done, live_ticks_total } : {}),
  };
}

module.exports = {
  init: getDb,
  resolveDatabasePath,
  getUser: (u) => get('SELECT * FROM users WHERE username=?', [u]),
  getUsers: () => all('SELECT * FROM users ORDER BY id'),
  addUser: (u, h, n, r, t) => {
    try {
      run('INSERT OR REPLACE INTO users (username,password_hash,name,role,tabs) VALUES (?,?,?,?,?)', [
        u,
        h,
        n,
        r,
        t,
      ]);
    } catch (e) {}
  },
  deleteUser: (id) => run('DELETE FROM users WHERE id=? AND username!="admin"', [id]),
  getDrawings: () => all('SELECT id,name,tab,floor,width,height,file_url FROM drawings'),
  getDrawing: (id) => get('SELECT * FROM drawings WHERE id=?', [id]),
  addDrawing: (n, t, f, d, w, h, fileUrl) => {
    run('INSERT INTO drawings (name,tab,floor,image_data,width,height,file_url) VALUES (?,?,?,?,?,?,?)', [
      n,
      t,
      f,
      d,
      w || 0,
      h || 0,
      fileUrl || null,
    ]);
    return { lastInsertRowid: get('SELECT last_insert_rowid() as id').id };
  },
  updateDrawingFileUrl: (id, fileUrl) => {
    run('UPDATE drawings SET file_url=? WHERE id=?', [fileUrl || null, id]);
  },
  deleteDrawing: (id) => {
    const zs = all('SELECT id FROM zones WHERE drawing_id=?', [id]);
    zs.forEach((z) => {
      const pis = all('SELECT * FROM programme_items WHERE zone_id=?', [z.id]);
      pis.forEach((pi) => shrinkScheduleForItem(pi, { deferSave: true }));
      runNoSave('DELETE FROM programme_items WHERE zone_id=?', [z.id]);
      runNoSave('DELETE FROM zone_activities WHERE zone_id=?', [z.id]);
    });
    runNoSave('DELETE FROM zones WHERE drawing_id=?', [id]);
    runNoSave('DELETE FROM drawings WHERE id=?', [id]);
    save();
  },
  getZones: (did) =>
    attachActivitiesToZones(all('SELECT * FROM zones WHERE drawing_id=? ORDER BY id', [did])),
  getAllZones: () =>
    attachActivitiesToZones(
      all('SELECT z.*, d.tab, d.floor FROM zones z JOIN drawings d ON z.drawing_id=d.id')
    ),
  getZoneById: (id) => get('SELECT * FROM zones WHERE id=?', [id]),
  /** Zone id + drawing tab (RBAC checks). */
  getZoneDrawingTab: (id) =>
    get(
      'SELECT z.id, d.tab FROM zones z JOIN drawings d ON d.id = z.drawing_id WHERE z.id = ?',
      [id]
    ),
  getZoneIdsWithProgrammeItems: () =>
    all('SELECT DISTINCT zone_id FROM programme_items').map((r) => Number(r.zone_id)),
  logProgrammeCommand: ({ username, command_text, parsed_action, phase, error_message }) => {
    run(
      'INSERT INTO programme_command_log (created_at, username, command_text, parsed_action, phase, error_message) VALUES (?,?,?,?,?,?)',
      [
        new Date().toISOString(),
        String(username || 'unknown'),
        String(command_text || ''),
        parsed_action != null ? String(parsed_action) : null,
        String(phase || 'unknown'),
        error_message != null ? String(error_message) : null,
      ]
    );
  },
  resetProgrammeData: () => {
    /** Keeps `activities` (catalog + template names), `drawings`, `templates`, `users`. Clears scheduled/site programme state. */
    const tablesToClear = [
      'programme_items',
      'schedule',
      'completions',
      'zone_activities',
      'zones',
      'milestones',
      'programme_command_log',
      'command_log',
      'look_ahead',
      'slip_notifications',
    ];
    const cleared = [];
    const skipped = [];
    for (const t of tablesToClear) {
      const exists = get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [t]
      );
      if (!exists) {
        skipped.push(t);
        continue;
      }
      run(`DELETE FROM ${t}`);
      cleared.push(t);
    }
    save();
    return { cleared, skipped };
  },
  addZone: (did, name, tower, geometry, activityId) => {
    let g = geometry;
    if (typeof g === 'string') {
      try {
        g = JSON.parse(g);
      } catch (_) {
        g = { kind: 'rect', x: 0, y: 0, w: 0, h: 0 };
      }
    }
    const bb = bboxFromGeom(g);
    const now = new Date().toISOString();
    const gj = JSON.stringify(g);
    run(
      'INSERT INTO zones (drawing_id,name,tower,x,y,w,h,geometry,activity_id,linked_activity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [did, name, tower, bb.x, bb.y, bb.w, bb.h, gj, activityId ?? null, null, now, now]
    );
    return { lastInsertRowid: get('SELECT last_insert_rowid() as id').id };
  },
  updateZone: (id, patch) => {
    const cur = get('SELECT * FROM zones WHERE id=?', [id]);
    if (!cur) return false;
    const name = patch.name != null ? patch.name : cur.name;
    const tower = patch.tower != null ? patch.tower : cur.tower;
    let g;
    if (patch.geometry != null) {
      g =
        typeof patch.geometry === 'string'
          ? JSON.parse(patch.geometry)
          : patch.geometry;
    } else {
      try {
        g = cur.geometry ? JSON.parse(cur.geometry) : null;
      } catch (_) {
        g = null;
      }
      if (!g || !g.kind)
        g = {
          kind: 'rect',
          x: Number(cur.x) || 0,
          y: Number(cur.y) || 0,
          w: Number(cur.w) || 0,
          h: Number(cur.h) || 0,
        };
    }
    const aid = patch.activity_id !== undefined ? patch.activity_id : cur.activity_id;
    const stid =
      patch.source_template_id !== undefined ? patch.source_template_id : cur.source_template_id;
    const stIdx =
      patch.programme_stage_idx !== undefined ? patch.programme_stage_idx : cur.programme_stage_idx;
    const anchor =
      patch.programme_anchor_date !== undefined
        ? patch.programme_anchor_date
        : cur.programme_anchor_date;
    const bb = bboxFromGeom(g);
    const now = new Date().toISOString();
    const oldTower = String(cur.tower || '');
    const oldName = String(cur.name || '');
    const newTower = String(tower || '');
    const newName = String(name || '');
    if (
      (patch.name != null && newName !== oldName) ||
      (patch.tower != null && newTower !== oldTower)
    ) {
      const dr = get('SELECT tab FROM drawings WHERE id=?', [cur.drawing_id]);
      const tabStr = dr && dr.tab != null ? String(dr.tab) : '';
      if (tabStr) {
        run(
          'UPDATE schedule SET tower=?, zone_name=? WHERE tab=? AND tower=? AND zone_name=?',
          [newTower, newName, tabStr, oldTower, oldName]
        );
      }
    }
    run(
      'UPDATE zones SET name=?, tower=?, x=?, y=?, w=?, h=?, geometry=?, activity_id=?, source_template_id=?, programme_stage_idx=?, programme_anchor_date=?, updated_at=? WHERE id=?',
      [
        name,
        tower,
        bb.x,
        bb.y,
        bb.w,
        bb.h,
        JSON.stringify(g),
        aid ?? null,
        stid != null ? stid : null,
        stIdx != null ? stIdx : null,
        anchor != null ? anchor : null,
        now,
        id,
      ]
    );
    return true;
  },
  deleteZone: (id) => {
    const nid = Number(id);
    if (!Number.isFinite(nid)) return;
    const pis = all('SELECT * FROM programme_items WHERE zone_id=?', [nid]);
    pis.forEach((pi) => shrinkScheduleForItem(pi, { deferSave: true }));
    runNoSave('DELETE FROM programme_items WHERE zone_id=?', [nid]);
    runNoSave('DELETE FROM zone_activities WHERE zone_id=?', [nid]);
    runNoSave('DELETE FROM zones WHERE id=?', [nid]);
    save();
  },
  setZoneActivities: (zoneId, items) => {
    const z = get('SELECT id FROM zones WHERE id=?', [zoneId]);
    if (!z) return false;
    run('DELETE FROM zone_activities WHERE zone_id=?', [zoneId]);
    (items || []).forEach((it, idx) => {
      const sid = it.activity_id != null ? Number(it.activity_id) : null;
      if (!sid) return;
      const ord = it.sequence_order != null ? Number(it.sequence_order) : idx;
      const dur = it.duration_days != null ? Number(it.duration_days) : 1;
      run(
        'INSERT INTO zone_activities (zone_id, activity_id, sequence_order, duration_days, start_date) VALUES (?,?,?,?,?)',
        [zoneId, sid, ord, Number.isFinite(dur) && dur > 0 ? dur : 1, it.start_date || null]
      );
    });
    save();
    return true;
  },
  addZoneActivity: (zoneId, activityId, opts) => {
    const z = get('SELECT id FROM zones WHERE id=?', [zoneId]);
    if (!z) return null;
    const aid = Number(activityId);
    const dup = get('SELECT id FROM zone_activities WHERE zone_id=? AND activity_id=?', [zoneId, aid]);
    if (dup) return { error: 'duplicate' };
    const maxRow = get(
      'SELECT COALESCE(MAX(sequence_order), -1) AS m FROM zone_activities WHERE zone_id=?',
      [zoneId]
    );
    const ord =
      opts && opts.sequence_order != null ? Number(opts.sequence_order) : Number(maxRow.m) + 1;
    const dur =
      opts && opts.duration_days != null ? Number(opts.duration_days) : 1;
    run(
      'INSERT INTO zone_activities (zone_id, activity_id, sequence_order, duration_days, start_date) VALUES (?,?,?,?,?)',
      [zoneId, aid, ord, Number.isFinite(dur) && dur > 0 ? dur : 1, (opts && opts.start_date) || null]
    );
    save();
    return { ok: true };
  },
  deleteZoneActivity: (zoneId, activityId) => {
    run('DELETE FROM zone_activities WHERE zone_id=? AND activity_id=?', [
      zoneId,
      Number(activityId),
    ]);
    save();
    return true;
  },
  getActivities: () => all('SELECT * FROM activities ORDER BY type, name'),
  getActivitiesByType: (type) => all('SELECT * FROM activities WHERE type=? ORDER BY name', [type]),
  addActivity: (name, type) => {
    const n = String(name || '').trim();
    const t = String(type || '').trim();
    if (!n || !t) return { error: 'name and type required' };
    const dup = get('SELECT id FROM activities WHERE lower(name)=lower(?)', [n]);
    if (dup) return { error: 'duplicate' };
    run('INSERT INTO activities (name,type) VALUES (?,?)', [n, t]);
    return { id: get('SELECT last_insert_rowid() as id').id };
  },
  renameActivity: (id, name) => {
    const aid = Number(id);
    const cur = get('SELECT * FROM activities WHERE id=?', [aid]);
    if (!cur) return { error: 'not_found' };
    const next = String(name || '').trim();
    if (!next) return { error: 'name_required' };
    const dup = get('SELECT id FROM activities WHERE lower(name)=lower(?) AND id<>?', [next, aid]);
    if (dup) return { error: 'duplicate' };
    run('UPDATE activities SET name=? WHERE id=?', [next, aid]);
    run('UPDATE schedule SET activity=? WHERE activity=?', [next, cur.name]);
    const templates = all('SELECT id, sequence FROM templates');
    for (const t of templates) {
      let seq = [];
      try { seq = JSON.parse(t.sequence || '[]'); } catch (_) {}
      if (!Array.isArray(seq) || !seq.length) continue;
      let changed = false;
      const nextSeq = seq.map((s) => {
        if (String(s).toLowerCase() === String(cur.name).toLowerCase()) {
          changed = true;
          return next;
        }
        return s;
      });
      if (changed) run('UPDATE templates SET sequence=? WHERE id=?', [JSON.stringify(nextSeq), t.id]);
    }
    save();
    return { ok: true };
  },
  deleteActivity: (id) => {
    const aid = Number(id);
    const cur = get('SELECT * FROM activities WHERE id=?', [aid]);
    if (!cur) return { error: 'not_found' };
    const useProgramme = get('SELECT COUNT(*) c FROM programme_items WHERE activity_id=?', [aid]);
    if (Number(useProgramme?.c || 0) > 0) return { error: 'in_use_programme' };
    const useZones = get('SELECT COUNT(*) c FROM zone_activities WHERE activity_id=?', [aid]);
    if (Number(useZones?.c || 0) > 0) return { error: 'in_use_zones' };
    const templates = all('SELECT id, sequence FROM templates');
    for (const t of templates) {
      let seq = [];
      try { seq = JSON.parse(t.sequence || '[]'); } catch (_) {}
      if (Array.isArray(seq) && seq.some((s) => String(s).toLowerCase() === String(cur.name).toLowerCase())) {
        return { error: 'in_use_templates' };
      }
    }
    run('DELETE FROM schedule WHERE activity=?', [cur.name]);
    run('DELETE FROM activities WHERE id=?', [aid]);
    save();
    return { ok: true };
  },
  getSchedule: (tab) => {
    const rows = all('SELECT date,tower,zone_name,activity FROM schedule WHERE tab=? ORDER BY date', [
      tab,
    ]);
    const r = {};
    rows.forEach((row) => {
      if (!r[row.date]) r[row.date] = {};
      if (!r[row.date][row.tower]) r[row.date][row.tower] = {};
      if (!r[row.date][row.tower][row.zone_name]) r[row.date][row.tower][row.zone_name] = [];
      r[row.date][row.tower][row.zone_name].push(row.activity);
    });
    return r;
  },
  addScheduleActivity: (tab, date, tw, zn, act) => {
    try {
      run('INSERT OR IGNORE INTO schedule (tab,date,tower,zone_name,activity) VALUES (?,?,?,?,?)', [
        tab,
        date,
        tw,
        zn,
        act,
      ]);
    } catch (e) {}
  },
  removeScheduleActivity: (tab, date, tw, zn, act) =>
    run('DELETE FROM schedule WHERE tab=? AND date=? AND tower=? AND zone_name=? AND activity=?', [
      tab,
      date,
      tw,
      zn,
      act,
    ]),
  setScheduleDay: (tab, date, data) => {
    run('DELETE FROM schedule WHERE tab=? AND date=?', [tab, date]);
    Object.entries(data).forEach(([tower, zones]) => {
      if (Array.isArray(zones))
        zones.forEach((act) => {
          try {
            run('INSERT INTO schedule (tab,date,tower,zone_name,activity) VALUES (?,?,?,?,?)', [
              tab,
              date,
              tower,
              '_default',
              act,
            ]);
          } catch (e) {}
        });
      else
        Object.entries(zones).forEach(([zone, acts]) =>
          acts.forEach((act) => {
            try {
              run('INSERT INTO schedule (tab,date,tower,zone_name,activity) VALUES (?,?,?,?,?)', [
                tab,
                date,
                tower,
                zone,
                act,
              ]);
            } catch (e) {}
          })
        );
    });
  },
  getCompletions: () => {
    const rows = all('SELECT * FROM completions ORDER BY date');
    const r = {};
    rows.forEach((row) => {
      if (!r[row.date]) r[row.date] = {};
      r[row.date][row.key] = { by: row.completed_by, at: row.completed_at };
    });
    return r;
  },
  getCompletion: (d, k) => get('SELECT * FROM completions WHERE date=? AND key=?', [d, k]),
  addCompletion: (d, k, by) => {
    const now = new Date();
    run('INSERT INTO completions (date,key,completed_by,completed_at) VALUES (?,?,?,?)', [
      d,
      k,
      by,
      now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'),
    ]);
  },
  deleteCompletion: (d, k) => run('DELETE FROM completions WHERE date=? AND key=?', [d, k]),
  getMilestones: () => all('SELECT * FROM milestones ORDER BY date'),
  /** Milestones with completion_pct reflecting live Update ticks when linked to programme_items.id */
  getMilestonesEnriched: () => {
    const milestones = all('SELECT * FROM milestones ORDER BY date');
    const completionsRows = all('SELECT date, key FROM completions');
    const compMap = {};
    completionsRows.forEach((r) => {
      if (!compMap[r.date]) compMap[r.date] = {};
      compMap[r.date][r.key] = true;
    });
    return milestones.map((m) => enrichMilestoneRow(m, compMap));
  },
  addMilestone: (d, l, s, pct, programmeItemId) => {
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    let pid = null;
    if (programmeItemId != null && programmeItemId !== '') {
      const n = Number(programmeItemId);
      if (Number.isFinite(n)) pid = n;
    }
    run('INSERT INTO milestones (date,label,status,completion_pct,programme_item_id) VALUES (?,?,?,?,?)', [
      d,
      l,
      s || 'planned',
      p,
      pid,
    ]);
    return get('SELECT last_insert_rowid() AS id').id;
  },
  updateMilestone: (id, patch) => {
    const row = get('SELECT * FROM milestones WHERE id=?', [id]);
    if (!row) return false;
    const date = patch.date != null ? patch.date : row.date;
    const label = patch.label != null ? patch.label : row.label;
    const status = patch.status != null ? patch.status : row.status;
    let programmeItemId =
      row.programme_item_id != null && row.programme_item_id !== ''
        ? Number(row.programme_item_id)
        : null;
    if (!Number.isFinite(programmeItemId)) programmeItemId = null;
    if (patch.programme_item_id !== undefined) {
      if (patch.programme_item_id === null || patch.programme_item_id === '') programmeItemId = null;
      else {
        const n = Number(patch.programme_item_id);
        programmeItemId = Number.isFinite(n) ? n : programmeItemId;
      }
    }
    let completionPct =
      row.completion_pct != null && row.completion_pct !== '' ? Number(row.completion_pct) : 0;
    if (!Number.isFinite(completionPct)) completionPct = 0;
    if (patch.completion_pct != null && programmeItemId == null) {
      completionPct = Math.max(0, Math.min(100, Math.round(Number(patch.completion_pct))));
    }
    run(
      'UPDATE milestones SET date=?, label=?, status=?, completion_pct=?, programme_item_id=? WHERE id=?',
      [date, label, status, completionPct, programmeItemId, id]
    );
    return true;
  },
  deleteMilestone: (id) => run('DELETE FROM milestones WHERE id=?', [id]),
  /** One row per unique template content (avoids duplicate list entries if the same template was inserted twice). */
  getTemplates: () =>
    all(
      `SELECT t.*
       FROM templates t
       INNER JOIN (
         SELECT MIN(id) AS keep_id
         FROM templates
         GROUP BY name, tab, tower, zone_name, sequence, durations
       ) u ON t.id = u.keep_id
       ORDER BY t.id`
    ),
  addTemplate: (n, tab, tw, zn, seq, dur) => {
    run('INSERT INTO templates (name,tab,tower,zone_name,sequence,durations) VALUES (?,?,?,?,?,?)', [
      n,
      tab,
      tw,
      zn,
      seq,
      dur,
    ]);
    return { lastInsertRowid: get('SELECT last_insert_rowid() as id').id };
  },
  getTemplateById: (id) => get('SELECT * FROM templates WHERE id=?', [id]),
  updateTemplate: (id, patch) => {
    const cur = get('SELECT * FROM templates WHERE id=?', [id]);
    if (!cur) return false;
    const name = patch.name != null ? patch.name : cur.name;
    const tab = patch.tab != null ? patch.tab : cur.tab;
    const tower = patch.tower != null ? patch.tower : cur.tower;
    const zone_name = patch.zone_name != null ? patch.zone_name : cur.zone_name;
    let seq = cur.sequence;
    let dur = cur.durations;
    if (patch.sequence != null)
      seq = typeof patch.sequence === 'string' ? patch.sequence : JSON.stringify(patch.sequence);
    if (patch.durations != null)
      dur = typeof patch.durations === 'string' ? patch.durations : JSON.stringify(patch.durations);
    run('UPDATE templates SET name=?, tab=?, tower=?, zone_name=?, sequence=?, durations=? WHERE id=?', [
      name,
      tab,
      tower,
      zone_name,
      seq,
      dur,
      id,
    ]);
    return true;
  },
  deleteTemplate: (id) => {
    run('UPDATE zones SET source_template_id=NULL WHERE source_template_id=?', [id]);
    run('DELETE FROM templates WHERE id=?', [id]);
  },
  /** Rebuild planned/active programme rows from updated template for zones linked via source_template_id. */
  syncProgrammesForTemplate: (templateId) => {
    const tpl = get('SELECT * FROM templates WHERE id=?', [templateId]);
    if (!tpl) return { zones: 0, items: 0 };
    let seq = [];
    let dur = [];
    try {
      seq = JSON.parse(tpl.sequence || '[]');
    } catch (_) {}
    try {
      dur = JSON.parse(tpl.durations || '[]');
    } catch (_) {}
    if (!Array.isArray(seq) || seq.length === 0) return { zones: 0, items: 0 };

    const actRows = all('SELECT id, name FROM activities');
    const activityLookup = schedule.buildActivityLookup(actRows);

    const linked = all('SELECT * FROM zones WHERE source_template_id=?', [templateId]);
    let itemsInserted = 0;

    for (const z of linked) {
      const items = all(
        'SELECT * FROM programme_items WHERE zone_id=? ORDER BY start_date',
        [z.id]
      );
      const doneItems = items.filter((i) => i.status === 'done');

      for (const it of items) {
        if (it.status === 'done') continue;
        const old = get('SELECT * FROM programme_items WHERE id=?', [it.id]);
        if (old) shrinkScheduleForItem(old);
        run('DELETE FROM programme_items WHERE id=?', [it.id]);
      }

      let k =
        z.programme_stage_idx != null && z.programme_stage_idx !== ''
          ? Number(z.programme_stage_idx)
          : 0;
      let anchor =
        z.programme_anchor_date && String(z.programme_anchor_date).trim()
          ? String(z.programme_anchor_date).trim()
          : schedule.todayKey();

      if (doneItems.length > 0) {
        let lastIdx = -1;
        let lastEnd = null;
        for (let ti = 0; ti < seq.length; ti++) {
          const aid = schedule.resolveActivityId(activityLookup, seq[ti]);
          if (aid == null) continue;
          const di = doneItems.find((d) => Number(d.activity_id) === Number(aid));
          if (di && ti > lastIdx) {
            lastIdx = ti;
            lastEnd = di.end_date;
          }
        }
        if (lastIdx >= 0 && lastEnd) {
          k = lastIdx + 1;
          anchor = schedule.nextWorkingDayAfter(lastEnd);
        }
      }

      if (k >= seq.length) continue;

      const rows = schedule.buildRowsFromTemplate({
        sequence: seq,
        durations: dur,
        startStageIndex: k,
        startDateKey: anchor,
        activityLookup,
      });

      const toInsert =
        doneItems.length > 0 ? rows.filter((r) => r && r.idx >= k) : rows.filter(Boolean);

      for (const row of toInsert) {
        if (!row.activity_id) continue;
        run(
          'INSERT INTO programme_items (zone_id,activity_id,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?)',
          [z.id, row.activity_id, row.start_date, row.end_date, row.status || 'planned', '']
        );
        const nid = get('SELECT last_insert_rowid() as id').id;
        const pi = get('SELECT * FROM programme_items WHERE id=?', [nid]);
        expandScheduleForItem(pi);
        itemsInserted++;
      }
    }

    save();
    return { zones: linked.length, items: itemsInserted };
  },
  applyTemplate: (tab, tw, zn, seq, dur, start) => {
    const acts = JSON.parse(seq),
      durs = JSON.parse(dur);
    let d = new Date(start + 'T00:00:00');
    acts.forEach((act, i) => {
      const units = Math.max(1, Math.round((Number(durs[i]) || 1) * 2));
      let halfStep = 0;
      for (let x = 0; x < units; x++) {
        while (d.getDay() === 0) d.setDate(d.getDate() + 1);
        const dk =
          d.getFullYear() +
          '-' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getDate()).padStart(2, '0');
        try {
          run('INSERT OR IGNORE INTO schedule (tab,date,tower,zone_name,activity) VALUES (?,?,?,?,?)', [
            tab,
            dk,
            tw,
            zn,
            act,
          ]);
        } catch (e) {}
        halfStep++;
        if (halfStep === 2) {
          halfStep = 0;
          d.setDate(d.getDate() + 1);
        }
      }
      if (halfStep === 1) d.setDate(d.getDate() + 1);
      while (d.getDay() === 0) d.setDate(d.getDate() + 1);
    });
  },
  /** All programme rows with zone + drawing tab for PLAN view and exports. Pass tabs (drawing_tab values) or null for no filter. */
  getPlanProgrammeRows: (tabs) => {
    const base = `SELECT pi.id, pi.zone_id, pi.activity_id, pi.start_date, pi.end_date, pi.status, pi.notes,
              z.name AS zone_name, z.tower, z.drawing_id,
              d.tab AS drawing_tab, d.name AS drawing_name,
              a.name AS activity_name, a.type AS activity_type
       FROM programme_items pi
       JOIN zones z ON z.id = pi.zone_id
       JOIN drawings d ON d.id = z.drawing_id
       JOIN activities a ON a.id = pi.activity_id`;
    const order = ` ORDER BY d.tab, z.tower, z.name, pi.start_date`;
    if (tabs && tabs.length)
      return all(`${base} WHERE d.tab IN (${tabs.map(() => '?').join(',')})${order}`, tabs);
    return all(base + order);
  },
  getProgrammeItemsByDrawing: (drawingId) =>
    all(
      `SELECT pi.*, z.name AS zone_name, z.tower, z.drawing_id, a.name AS activity_name, a.type AS activity_type
       FROM programme_items pi
       JOIN zones z ON z.id = pi.zone_id
       JOIN activities a ON a.id = pi.activity_id
       WHERE z.drawing_id = ?
       ORDER BY pi.start_date, z.name`,
      [drawingId]
    ),
  getProgrammeItemsByZone: (zoneId) =>
    all(
      `SELECT pi.*, a.name AS activity_name, a.type AS activity_type
       FROM programme_items pi
       JOIN activities a ON a.id = pi.activity_id
       WHERE pi.zone_id = ?
       ORDER BY pi.start_date`,
      [zoneId]
    ),
  getProgrammeItemById: (id) => get('SELECT * FROM programme_items WHERE id=?', [id]),
  addProgrammeItem: (zone_id, activity_id, start_date, end_date, status, notes) => {
    run(
      'INSERT INTO programme_items (zone_id,activity_id,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?)',
      [zone_id, activity_id, start_date, end_date, status || 'planned', notes || '']
    );
    const id = get('SELECT last_insert_rowid() as id').id;
    const pi = get('SELECT * FROM programme_items WHERE id=?', [id]);
    expandScheduleForItem(pi);
    return { lastInsertRowid: id };
  },
  updateProgrammeItem: (id, patch) => {
    const old = get('SELECT * FROM programme_items WHERE id=?', [id]);
    if (!old) return null;
    shrinkScheduleForItem(old);
    const zone_id = patch.zone_id != null ? patch.zone_id : old.zone_id;
    const activity_id = patch.activity_id != null ? patch.activity_id : old.activity_id;
    const start_date = patch.start_date != null ? patch.start_date : old.start_date;
    const end_date = patch.end_date != null ? patch.end_date : old.end_date;
    const status = patch.status != null ? patch.status : old.status;
    const notes = patch.notes !== undefined ? patch.notes : old.notes;
    run(
      'UPDATE programme_items SET zone_id=?, activity_id=?, start_date=?, end_date=?, status=?, notes=? WHERE id=?',
      [zone_id, activity_id, start_date, end_date, status, notes || '', id]
    );
    const neu = get('SELECT * FROM programme_items WHERE id=?', [id]);
    expandScheduleForItem(neu);
    return true;
  },
  deleteProgrammeItem: (id) => {
    const old = get('SELECT * FROM programme_items WHERE id=?', [id]);
    if (old) shrinkScheduleForItem(old);
    run('DELETE FROM programme_items WHERE id=?', [id]);
  },
  replaceZoneProgrammeItems: (zoneId, rows) => {
    const zid = Number(zoneId);
    const zone = get('SELECT * FROM zones WHERE id=?', [zid]);
    if (!zone) return { error: 'Zone not found' };
    const old = all('SELECT * FROM programme_items WHERE zone_id=?', [zid]);
    old.forEach((it) => {
      shrinkScheduleForItem(it);
      run('DELETE FROM programme_items WHERE id=?', [it.id]);
    });
    for (const r of rows || []) {
      run(
        'INSERT INTO programme_items (zone_id,activity_id,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?)',
        [
          zid,
          Number(r.activity_id),
          String(r.start_date),
          String(r.end_date),
          r.status || 'planned',
          r.notes || '',
        ]
      );
      const nid = get('SELECT last_insert_rowid() as id').id;
      const pi = get('SELECT * FROM programme_items WHERE id=?', [nid]);
      expandScheduleForItem(pi);
    }
    save();
    return { ok: true };
  },
  restoreZoneSnapshot: (snapshot) => {
    if (!snapshot || !snapshot.zone) return { error: 'Invalid snapshot' };
    const z = snapshot.zone;
    const zid = Number(z.id);
    const exists = get('SELECT id FROM zones WHERE id=?', [zid]);
    if (exists) return { error: 'Zone id already exists' };
    run(
      'INSERT INTO zones (id,drawing_id,name,tower,x,y,w,h,geometry,activity_id,linked_activity,created_at,updated_at,source_template_id,programme_stage_idx,programme_anchor_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        zid,
        Number(z.drawing_id),
        z.name,
        z.tower,
        Number(z.x) || 0,
        Number(z.y) || 0,
        Number(z.w) || 0,
        Number(z.h) || 0,
        z.geometry || null,
        z.activity_id != null ? Number(z.activity_id) : null,
        z.linked_activity || null,
        z.created_at || new Date().toISOString(),
        new Date().toISOString(),
        z.source_template_id != null ? Number(z.source_template_id) : null,
        z.programme_stage_idx != null ? Number(z.programme_stage_idx) : null,
        z.programme_anchor_date || null,
      ]
    );
    const acts = Array.isArray(snapshot.zone_activities) ? snapshot.zone_activities : [];
    for (const a of acts) {
      run(
        'INSERT INTO zone_activities (zone_id, activity_id, sequence_order, duration_days, start_date) VALUES (?,?,?,?,?)',
        [
          zid,
          Number(a.activity_id),
          Number(a.sequence_order) || 0,
          Number(a.duration_days) || 1,
          a.start_date || null,
        ]
      );
    }
    const items = Array.isArray(snapshot.programme_items) ? snapshot.programme_items : [];
    for (const it of items) {
      run(
        'INSERT INTO programme_items (zone_id,activity_id,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?)',
        [
          zid,
          Number(it.activity_id),
          String(it.start_date),
          String(it.end_date),
          it.status || 'planned',
          it.notes || '',
        ]
      );
      const nid = get('SELECT last_insert_rowid() as id').id;
      const pi = get('SELECT * FROM programme_items WHERE id=?', [nid]);
      expandScheduleForItem(pi);
    }
    save();
    return { ok: true };
  },
  /**
   * Replace zone programme from template, anchoring one activity's finish date (weekday).
   * @param {number|null|undefined} templateIdOpt — defaults to zone.source_template_id
   */
  scheduleFromTargetDate: (zoneId, anchorActivityId, anchorDateKey, templateIdOpt) => {
    const zid = Number(zoneId);
    const zone = get('SELECT * FROM zones WHERE id=?', [zid]);
    if (!zone) return { error: 'Zone not found' };

    const tid =
      templateIdOpt != null && templateIdOpt !== ''
        ? Number(templateIdOpt)
        : zone.source_template_id != null
          ? Number(zone.source_template_id)
          : null;
    if (!tid) {
      return {
        error: 'No template — select a template on Programme or link this zone to a saved template.',
      };
    }

    const tpl = get('SELECT * FROM templates WHERE id=?', [tid]);
    if (!tpl) return { error: 'Template not found' };

    let seq = [];
    let dur = [];
    try {
      seq = JSON.parse(tpl.sequence || '[]');
    } catch (_) {}
    try {
      dur = JSON.parse(tpl.durations || '[]');
    } catch (_) {}
    if (!Array.isArray(seq) || seq.length === 0) return { error: 'Template has no sequence' };

    const actRows = all('SELECT id, name FROM activities');
    const activityLookup = schedule.buildActivityLookup(actRows);

    const wantId = Number(anchorActivityId);
    let k = -1;
    for (let i = 0; i < seq.length; i++) {
      const aid = schedule.resolveActivityId(activityLookup, seq[i]);
      if (aid != null && Number(aid) === wantId) {
        k = i;
        break;
      }
    }
    if (k < 0) return { error: 'Selected activity is not in this template sequence' };

    const rows = schedule.buildRowsFromTargetEndDate({
      sequence: seq,
      durations: dur,
      anchorIndex: k,
      anchorEndDateKey: String(anchorDateKey || '').trim(),
      activityLookup,
    });
    if (!rows.length) return { error: 'Could not compute schedule — check anchor date' };
    if (rows.some((r) => !r.activity_id)) {
      return { error: 'Unknown activity name in template — add matching activities in the database' };
    }

    const existing = all('SELECT * FROM programme_items WHERE zone_id=?', [zid]);
    for (const it of existing) {
      shrinkScheduleForItem(it);
      run('DELETE FROM programme_items WHERE id=?', [it.id]);
    }

    for (const row of rows) {
      run(
        'INSERT INTO programme_items (zone_id,activity_id,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?)',
        [zid, row.activity_id, row.start_date, row.end_date, row.status || 'planned', row.notes || '']
      );
      const nid = get('SELECT last_insert_rowid() as id').id;
      const pi = get('SELECT * FROM programme_items WHERE id=?', [nid]);
      expandScheduleForItem(pi);
    }

    const now = new Date().toISOString();
    run(
      'UPDATE zones SET source_template_id=?, programme_stage_idx=?, programme_anchor_date=?, updated_at=? WHERE id=?',
      [tid, k, rows[k].start_date, now, zid]
    );
    save();

    const activities = rows.map((r) => ({
      idx: r.idx,
      activity_id: r.activity_id,
      activity_name: r.activity_name,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
    }));

    return {
      activities,
      zone_start: rows[0].start_date,
      zone_finish: rows[rows.length - 1].end_date,
    };
  },
  /** Full regenerate from template stage 0. Fails if zone has any programme row with status done. */
  resetZoneProgrammeToTemplateStart: (zoneId, startDateKey) => {
    const zid = Number(zoneId);
    const zone = get('SELECT * FROM zones WHERE id=?', [zid]);
    if (!zone) return { error: 'Zone not found' };
    const tid = zone.source_template_id != null ? Number(zone.source_template_id) : null;
    if (!tid) return { error: 'Zone has no linked template — set template on Programme first.' };
    const tpl = get('SELECT * FROM templates WHERE id=?', [tid]);
    if (!tpl) return { error: 'Template not found' };

    let seq = [];
    let dur = [];
    try {
      seq = JSON.parse(tpl.sequence || '[]');
    } catch (_) {}
    try {
      dur = JSON.parse(tpl.durations || '[]');
    } catch (_) {}
    if (!Array.isArray(seq) || seq.length === 0) return { error: 'Template has no sequence' };

    const existing = all('SELECT * FROM programme_items WHERE zone_id=?', [zid]);
    const done = existing.filter((i) => String(i.status || '').toLowerCase() === 'done');
    if (done.length) {
      return {
        error: `Zone has ${done.length} completed programme row(s). Clear completions first, or use shift / activity commands.`,
      };
    }

    const actRows = all('SELECT id, name FROM activities');
    const activityLookup = schedule.buildActivityLookup(actRows);

    const rows = schedule
      .buildRowsFromTemplate({
        sequence: seq,
        durations: dur,
        startStageIndex: 0,
        startDateKey: String(startDateKey || '').trim(),
        activityLookup,
      })
      .filter(Boolean);
    if (!rows.length) return { error: 'Could not build programme from that start date' };
    if (rows.some((r) => !r.activity_id)) {
      return { error: 'Unknown activity name in template — fix activities list' };
    }

    for (const it of existing) {
      shrinkScheduleForItem(it);
      run('DELETE FROM programme_items WHERE id=?', [it.id]);
    }

    for (const row of rows) {
      run(
        'INSERT INTO programme_items (zone_id,activity_id,start_date,end_date,status,notes) VALUES (?,?,?,?,?,?)',
        [zid, row.activity_id, row.start_date, row.end_date, row.status || 'planned', row.notes || '']
      );
      const nid = get('SELECT last_insert_rowid() as id').id;
      const pi = get('SELECT * FROM programme_items WHERE id=?', [nid]);
      expandScheduleForItem(pi);
    }

    const now = new Date().toISOString();
    run(
      'UPDATE zones SET source_template_id=?, programme_stage_idx=?, programme_anchor_date=?, updated_at=? WHERE id=?',
      [tid, 0, rows[0].start_date, now, zid]
    );
    save();

    return {
      activities: rows.map((r) => ({
        activity_name: r.activity_name,
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
      })),
      zone_start: rows[0].start_date,
      zone_finish: rows[rows.length - 1].end_date,
    };
  },
};
