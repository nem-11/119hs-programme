import { completionKeyFromProgrammeRow } from './planUtils';

function normaliseDayKey(dayKey) {
  return String(dayKey || '').trim();
}

/**
 * Activity-level "done as of a date": the activity is done if its status is done, or it
 * carries a completion tick on any day on or before asOf. Ticks are stored per (day, key),
 * but a tick on any day marks the activity complete — we do not require the tick to fall
 * inside the activity's scheduled window, so ticked activities always register.
 */
function rowDoneAsOf(row, asOfDate, comp) {
  if (!row) return false;
  if (String(row.status || '').toLowerCase() === 'done') return true;
  const ck = completionKeyFromProgrammeRow(row);
  if (!ck || !comp || typeof comp !== 'object') return false;
  const asOf = normaliseDayKey(asOfDate);
  for (const dk of Object.keys(comp)) {
    if (!comp[dk]?.[ck]) continue;
    if (!asOf || normaliseDayKey(dk) <= asOf) return true;
  }
  return false;
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
