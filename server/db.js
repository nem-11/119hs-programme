const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { dateKeysBetween, bboxFromGeom } = require('./programmeSync');

const DB_PATH = path.join(__dirname, '119hs.db');
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

let db;

function save() {
  if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
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

function shrinkScheduleForItem(pi) {
  if (!pi) return;
  const z = get(
    'SELECT z.*, d.tab FROM zones z JOIN drawings d ON d.id=z.drawing_id WHERE z.id=?',
    [pi.zone_id]
  );
  const a = get('SELECT name FROM activities WHERE id=?', [pi.activity_id]);
  if (!z || !a) return;
  const dates = dateKeysBetween(pi.start_date, pi.end_date);
  dates.forEach((dk) => {
    run(
      'DELETE FROM schedule WHERE tab=? AND date=? AND tower=? AND zone_name=? AND activity=?',
      [z.tab, dk, z.tower, z.name, a.name]
    );
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
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
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
  migrateZonesGeometry();
  save();
  return db;
}

module.exports = {
  init: getDb,
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
      pis.forEach((pi) => shrinkScheduleForItem(pi));
      run('DELETE FROM programme_items WHERE zone_id=?', [z.id]);
    });
    run('DELETE FROM zones WHERE drawing_id=?', [id]);
    run('DELETE FROM drawings WHERE id=?', [id]);
  },
  getZones: (did) => all('SELECT * FROM zones WHERE drawing_id=? ORDER BY id', [did]),
  getAllZones: () =>
    all('SELECT z.*, d.tab, d.floor FROM zones z JOIN drawings d ON z.drawing_id=d.id'),
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
    const bb = bboxFromGeom(g);
    const now = new Date().toISOString();
    run(
      'UPDATE zones SET name=?, tower=?, x=?, y=?, w=?, h=?, geometry=?, activity_id=?, updated_at=? WHERE id=?',
      [name, tower, bb.x, bb.y, bb.w, bb.h, JSON.stringify(g), aid ?? null, now, id]
    );
    return true;
  },
  deleteZone: (id) => {
    const pis = all('SELECT * FROM programme_items WHERE zone_id=?', [id]);
    pis.forEach((pi) => shrinkScheduleForItem(pi));
    run('DELETE FROM programme_items WHERE zone_id=?', [id]);
    run('DELETE FROM zones WHERE id=?', [id]);
  },
  getActivities: () => all('SELECT * FROM activities ORDER BY type, name'),
  getActivitiesByType: (type) => all('SELECT * FROM activities WHERE type=? ORDER BY name', [type]),
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
  addMilestone: (d, l, s) => run('INSERT INTO milestones (date,label,status) VALUES (?,?,?)', [d, l, s]),
  getTemplates: () => all('SELECT * FROM templates ORDER BY id'),
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
  deleteTemplate: (id) => run('DELETE FROM templates WHERE id=?', [id]),
  applyTemplate: (tab, tw, zn, seq, dur, start) => {
    const acts = JSON.parse(seq),
      durs = JSON.parse(dur);
    let d = new Date(start + 'T00:00:00');
    acts.forEach((act, i) => {
      for (let x = 0; x < (durs[i] || 1); x++) {
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
        d.setDate(d.getDate() + 1);
      }
      while (d.getDay() === 0) d.setDate(d.getDate() + 1);
    });
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
};
