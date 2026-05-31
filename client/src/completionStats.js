import { calendarDaysBetween, isProgrammeItemDoneOnDay } from './planUtils';

function normaliseDayKey(dayKey) {
  return String(dayKey || '').trim();
}

function rowDoneAsOf(row, asOfDate, comp) {
  const start = normaliseDayKey(row?.start_date);
  const end = normaliseDayKey(asOfDate);
  if (!start || !end || start > end) return false;
  return calendarDaysBetween(start, end).some((dayKey) =>
    isProgrammeItemDoneOnDay(row, dayKey, comp)
  );
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
