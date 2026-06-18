import { completionKeyFromProgrammeRow, scheduleDateKeysBetween, isProgrammeRowFullyDone } from './planUtils';

function normaliseDayKey(dayKey) {
  return String(dayKey || '').trim();
}

/** Ground → numeric floors → basement/other. */
export function floorSortRank(floor) {
  const s = String(floor || '').toLowerCase().trim();
  if (s.includes('basement')) return -1;
  if (!s || s === 'gf' || s === 'ground' || s === 'ground floor' || s === 'g/f' || s === 'g') return 0;
  const m = s.match(/(\d+)\s*(?:st|nd|rd|th)?\s*floor/) || s.match(/floor\s*(\d+)/) || s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

export function floorLabelFromRow(row) {
  const fl = String(row?.drawing_floor || '').trim();
  const dn = String(row?.drawing_name || '').trim();
  return fl || dn || '—';
}

function tallyRow(bucket, row, comp) {
  bucket.total += 1;
  if (isProgrammeRowFullyDone(row, comp)) bucket.done += 1;
}

/**
 * Per-tower and per-floor completion for a programme scope.
 * Denominator = every scheduled activity in each zone (finish line = last activity ticked).
 * New programme rows automatically extend totals.
 */
export function programmeCompletionBreakdown(planRows, comp, rowMatches) {
  const byTower = new Map();
  const byFloor = new Map();
  for (const r of planRows || []) {
    if (!r || typeof rowMatches !== 'function' || !rowMatches(r)) continue;
    const tw = String(r.tower || '').trim() || '—';
    const zn = String(r.zone_name || '').trim();
    const act = String(r.activity_name || '').trim();
    if (!zn || !act) continue;
    if (!String(r.start_date || '').trim() || !String(r.end_date || '').trim()) continue;
    const fl = floorLabelFromRow(r);
    if (!byTower.has(tw)) byTower.set(tw, { label: tw, total: 0, done: 0 });
    if (!byFloor.has(fl)) byFloor.set(fl, { label: fl, total: 0, done: 0 });
    tallyRow(byTower.get(tw), r, comp);
    tallyRow(byFloor.get(fl), r, comp);
  }
  const mapPct = (e) => ({ ...e, pct: e.total > 0 ? Math.round((e.done / e.total) * 100) : 0 });
  return {
    towers: [...byTower.values()]
      .map(mapPct)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })),
    floors: [...byFloor.values()]
      .map(mapPct)
      .sort((a, b) => floorSortRank(a.label) - floorSortRank(b.label) || a.label.localeCompare(b.label)),
  };
}

/**
 * Activity fully done as of a date: status done, or every scheduled day in the span
 * (on or before asOf) has its own completion tick.
 */
function rowDoneAsOf(row, asOfDate, comp) {
  if (!row) return false;
  if (String(row.status || '').toLowerCase() === 'done') return true;
  const ck = completionKeyFromProgrammeRow(row);
  if (!ck || !comp || typeof comp !== 'object') return false;
  const asOf = normaliseDayKey(asOfDate);
  const days = scheduleDateKeysBetween(row.start_date, row.end_date).filter(
    (dk) => !asOf || normaliseDayKey(dk) <= asOf
  );
  if (!days.length) return false;
  return days.every((dk) => !!comp[dk]?.[ck]);
}

export function zoneCompletionsAsOf(date, zones, programmeRows, comp) {
  const asOfDate = normaliseDayKey(date);
  const zoneList = Array.isArray(zones) ? zones : [];
  const zoneIds = new Set(zoneList.map((z) => Number(z.id)).filter(Number.isFinite));
  const byZone = new Map(zoneList.map((z) => [Number(z.id), []]));

  // A zone's denominator is its FULL programme — every activity, regardless of when
  // it is scheduled. That way 100% means the last activity in the zone is ticked, and
  // adding new activities (e.g. commissioning) extends the finish line and lowers the %.
  for (const row of programmeRows || []) {
    const zid = Number(row?.zone_id);
    if (!zoneIds.has(zid)) continue;
    if (!byZone.has(zid)) byZone.set(zid, []);
    byZone.get(zid).push(row);
  }

  const out = new Map();
  for (const z of zoneList) {
    const zid = Number(z.id);
    const rows = byZone.get(zid) || [];
    if (!rows.length) {
      out.set(zid, null);
      continue;
    }

    const done = rows.filter((row) => rowDoneAsOf(row, asOfDate, comp)).length;
    const total = rows.length;
    // Unweighted: every activity counts equally toward the zone's finish line.
    out.set(zid, {
      pct: total === 0 ? null : done / total,
      total,
      done,
    });
  }
  return out;
}
