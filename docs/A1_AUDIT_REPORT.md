# A1 — Data layer read-only audit report

**Generated:** 2026-05-12  
**Scope:** Read-only diagnostic. No database or source files were modified for this audit (this markdown file was added as the deliverable only).  
**Reference:** `docs/SOURCE_OF_TRUTH.md` — especially §3 (activity as atomic unit), §3.6 pipeline, and §4.1 (“Deletes are complete…”).

---

## 1. SQLite database path (from server config)

Resolution order is implemented in `server/databasePath.js`:

1. If `process.env.DATABASE_PATH` is set and non-empty → use that path (absolute, or resolved relative to `process.cwd()`).
2. Else if `process.env.RENDER === 'true'` → fixed Render disk path: `/opt/render/project/src/server/public/uploads/119hs.db`.
3. Else → `path.resolve(process.cwd(), 'data', '119hs.db')`.

**Database file used for the queries below:**  
`/Users/nemanjalazarevic/Desktop/119hs-programme/data/119hs.db`  
(i.e. default local path with no `DATABASE_PATH` override in the audit shell.)

---

## 2. Schema notes (vs audit prompt wording)

| Prompt term | Actual schema |
|-------------|----------------|
| “Activities whose `zone_id` does not exist” | The **`activities`** table is the **global catalogue** (`id`, `name`, `type`) — there is **no `zone_id`** on `activities`. Zone linkage is in **`zone_activities`** (`zone_id`, `activity_id`) and dated work is in **`programme_items`** (`zone_id`, `activity_id`). |
| “Progress / tick records … `activity_id`” | **`completions`** stores **`date`**, **`key`** (string like `tower\|zone\|activity`), **`completed_by`**, **`completed_at`** — **no `activity_id` column**. Orphan analysis used the same key parsing rules as `parseCompletionKeyParts` in `server/db.js` and checked the parsed **activity name** against **`activities.name`**. |
| “Clash records” | There is **no `clashes` table** in SQLite. Clashes are computed **client-side** on the Plan page (`detectClash` in `client/src/PlanPage.js`). |

---

## 3. SQL query results (local `data/119hs.db` at audit time)

Commands were run read-only via `sqlite3` (no writes). Additional read-only analysis used `sql.js` in Node to open a **memory copy** of the file (no persistence).

| Metric | Value |
|--------|------:|
| Total count of **`activities`** (catalogue) | **35** |
| Total count of **`zones`** | **0** |
| **`zone_activities`** rows whose **`zone_id`** is missing from **`zones`** | **0** |
| **`zone_activities`** rows whose **`activity_id`** is missing from **`activities`** | **0** |
| **`programme_items`** rows whose **`zone_id`** is missing from **`zones`** | **0** |
| **`programme_items`** rows whose **`activity_id`** is missing from **`activities`** | **0** |
| **`programme_items`** with **`status`** = `done` (case-insensitive trim) | **0** |
| Total **`completions`** | **0** |
| Total **`schedule`** | **0** |

**Orphan completions (heuristic):** rows in **`completions`** where the parsed activity segment of **`key`** does not match any **`activities.name`** (case-insensitive): **0**  
(JSON diagnostic: `completionsOrphanByCatalogName: 0`, `sampleKeys: []`.)

**Orphan clash rows:** **N/A** — no clash table; see §5.

**Distinct zone names (tower + pour/area `name`) — all zones:**

*(Query: `SELECT DISTINCT tower, name FROM zones ORDER BY tower, name;` — empty result set because `zones` count is 0 on this DB.)*

---

## 4. Alignment with `SOURCE_OF_TRUTH.md` (observation only)

- **§4.1 — “Deleting a zone deletes all its activities, progress, and clash records.”**  
  Implemented **`deleteZone`** (quoted below) removes **`programme_items`** and **`zone_activities`** for the zone, shrinks **`schedule`** via `shrinkScheduleForItem` per programme row, then deletes the **`zones`** row. It does **not** run `DELETE FROM completions WHERE …`. Historical **Update ticks** in **`completions`** keyed by tower/zone/activity could therefore **outlive** a deleted zone if they exist in a richer database. This audit’s sample DB had **zero** completions, so the issue did not surface in counts.

- **Clashes:** Not persisted; no orphan clash rows possible at the DB layer.

---

## 5. Clash detector (current code)

**Location:** `client/src/PlanPage.js` — in-memory detection over plan programme rows returned from the API.

```565:583:client/src/PlanPage.js
  function detectClash(allRows) {
    const by = new Map();
    for (const r of allRows || []) {
      for (const dk of calendarDaysBetween(r.start_date, r.end_date)) {
        if (isSundayOrBankHolidayKey(dk)) continue;
        const key = `${dk}__${r.activity_name}`;
        if (!by.has(key)) by.set(key, []);
        by.get(key).push(r);
      }
    }
    for (const [key, arr] of by.entries()) {
      const zoneIds = [...new Set(arr.map((x) => Number(x.zone_id)))];
      if (zoneIds.length >= 2) {
        const [day, activity] = key.split('__');
        return { key, day, activity, rows: arr.slice(0, 2) };
      }
    }
    return null;
  }
```

---

## 6. DELETE zone — HTTP routes (`server/index.js`)

**Programme editor route:**

```334:344:server/index.js
app.delete('/api/zones/:id', auth, programmeEditor, (req, res) => {
  try {
    const zchk = perm.assertZoneTabAllowed(db, req.user, req.params.id);
    if (!zchk.ok) return res.status(403).json({ error: 'Zone not permitted' });
    db.deleteZone(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[119HS] DELETE /api/zones/:id', e);
    res.status(500).json({ error: e.message || 'Zone delete failed' });
  }
});
```

**Admin Plan route** (returns a snapshot before delete):

```442:454:server/index.js
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
```

**Persistence implementation** (`db.deleteZone`):

```897:906:server/db.js
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
```

---

## 7. “Apply template to zone” — backend routes

Two different flows exist:

### 7a. Anchor template schedule to a zone (programme rows)

**Route:** `POST /api/zones/:zoneId/schedule-from-target` — calls `db.scheduleFromTargetDate`.

```345:354:server/index.js
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
```

### 7b. Legacy “apply template” into **`schedule`** table (tab/tower/zone_name strings)

**Route:** `POST /api/templates/apply` — calls `db.applyTemplate`.

```417:421:server/index.js
app.post('/api/templates/apply', auth, admin, (req, res) => {
  const { tab, tower, zone_name, sequence, durations, startDate } = req.body;
  db.applyTemplate(tab, tower, zone_name, JSON.stringify(sequence), JSON.stringify(durations), startDate);
  res.json({ ok: true });
});
```

Implementation of **`applyTemplate`** (for reference; lives in `server/db.js`, not `index.js`):

```1334:1367:server/db.js
  applyTemplate: (tab, tw, zn, seq, dur, start) => {
    const acts = JSON.parse(seq),
      durs = JSON.parse(dur);
    let d = new Date(start + 'T00:00:00');
    acts.forEach((act, i) => {
      const units = Math.max(1, Math.round((Number(durs[i]) || 1) * 2));
      let halfStep = 0;
      for (let x = 0; x < units; x++) {
        while (pw.isNonWorkingPlanDayKey(pw.dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
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
      while (pw.isNonWorkingPlanDayKey(pw.dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
    });
  },
```

---

## 8. Re-run instructions (read-only)

```bash
export DATABASE_PATH="/path/to/119hs.db"   # optional; else uses server default
DB="${DATABASE_PATH:-$(node -e "console.log(require('./server/databasePath').resolveDatabasePath())")}"

sqlite3 "$DB" "SELECT COUNT(*) FROM activities;"
sqlite3 "$DB" "SELECT COUNT(*) FROM zones;"
sqlite3 "$DB" "SELECT COUNT(*) FROM zone_activities za WHERE NOT EXISTS (SELECT 1 FROM zones z WHERE z.id = za.zone_id);"
sqlite3 "$DB" "SELECT COUNT(*) FROM programme_items WHERE lower(trim(status))='done';"
# …etc.
```

---

## 9. Closing

This report reflects the **workspace default database** at audit time. Production or other paths (`DATABASE_PATH`, Render disk) were not opened unless they match the resolved path above.

**Git:** Per instructions, this file was **not** committed or pushed.
