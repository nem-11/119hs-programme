const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function resolveDatabasePath() {
  const raw = process.env.DATABASE_PATH || path.join('data', '119hs.db');
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

const DB_PATH = resolveDatabasePath();

async function main() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error('Database not found:', DB_PATH);
    process.exit(1);
  }
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

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

  function tableExists(name) {
    const s = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    );
    s.bind([name]);
    const ok = s.step();
    s.free();
    return ok;
  }

  for (const t of tablesToClear) {
    if (!tableExists(t)) {
      console.log(`- skipped (not found): ${t}`);
      continue;
    }
    db.run(`DELETE FROM ${t}`);
    console.log(`- cleared: ${t}`);
  }

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log('Programme reset complete.');
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});

