import { calendarDaysBetween, isProgrammeItemDoneOnDay } from './planUtils';

function normaliseDayKey(dayKey) {
  return String(dayKey || '').trim();
}

function isOnOrBefore(a, b) {
  const aa = normaliseDayKey(a);
  const bb = normaliseDayKey(b);
  return Boolean(aa && bb && aa <= bb);
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

  for (const row of programmeRows || []) {
    const zid = Number(row?.zone_id);
    if (!zoneIds.has(zid)) continue;
    if (!isOnOrBefore(row?.start_date, asOfDate)) continue;
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
    // TODO: consider weighted completion by scheduled activity duration.
    out.set(zid, {
      pct: total === 0 ? null : done / total,
      total,
      done,
    });
  }
  return out;
}
