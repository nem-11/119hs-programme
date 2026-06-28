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

/** Numeric floor rank from drawing floor + name (matches server moduleBulkSchedule). */
export function floorRankFromDrawing(drawing) {
  const parts = [drawing?.floor, drawing?.name].filter(Boolean).map((x) => String(x).toLowerCase());
  const s = parts.join(' ');
  if (s.includes('basement')) return -1;
  if (s.includes('ground') || /\bgf\b/.test(s)) return 0;
  const m = s.match(/(\d+)\s*(?:st|nd|rd|th)?\s*floor/) || s.match(/floor\s*(\d+)/) || s.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 999;
}

/** Human-readable floor label derived from drawing metadata. */
export function floorLabelFromDrawing(drawing) {
  const rank = floorRankFromDrawing(drawing);
  if (rank === -1) return 'Basement';
  if (rank === 0) return 'Ground floor';
  if (rank >= 1 && rank < 999) {
    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    return `${rank}${suffix} floor`;
  }
  const raw = String(drawing?.floor || '').trim();
  if (raw) return raw;
  return String(drawing?.name || '').trim() || '—';
}

export function floorLabelFromRow(row) {
  return floorLabelFromDrawing({
    floor: row?.drawing_floor,
    name: row?.drawing_name,
  });
}

export function levelKeyFromRow(row) {
  const tw = String(row?.tower || '').trim() || '—';
  const rank = floorRankFromDrawing({ floor: row?.drawing_floor, name: row?.drawing_name });
  return `${tw}|${rank}`;
}

export function levelLabelFromRow(row) {
  const tw = String(row?.tower || '').trim() || '—';
  return `${tw} · ${floorLabelFromRow(row)}`;
}

function tallyRow(bucket, row, comp) {
  bucket.total += 1;
  if (isProgrammeRowFullyDone(row, comp)) bucket.done += 1;
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

/** Latest completion tick date for a fully-done row (within optional as-of date). */
function rowLastCompletionDate(row, comp, asOfDate) {
  if (!rowDoneAsOf(row, asOfDate, comp)) return null;
  const ck = completionKeyFromProgrammeRow(row);
  const asOf = normaliseDayKey(asOfDate);
  let last = null;
  if (ck && comp && typeof comp === 'object') {
    for (const dk of scheduleDateKeysBetween(row.start_date, row.end_date)) {
      if (asOf && normaliseDayKey(dk) > asOf) continue;
      if (comp[dk]?.[ck]) last = dk;
    }
  }
  if (!last && String(row.status || '').toLowerCase() === 'done') {
    const end = normaliseDayKey(row.end_date);
    if (!asOf || !end || end <= asOf) last = end || last;
  }
  return last;
}

function levelCompletionForRows(rows, comp, asOfDate) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let done = 0;
  let lastFinishedDate = null;
  for (const row of list) {
    total += 1;
    if (rowDoneAsOf(row, asOfDate, comp)) {
      done += 1;
      const d = rowLastCompletionDate(row, comp, asOfDate);
      if (d && (!lastFinishedDate || d > lastFinishedDate)) lastFinishedDate = d;
    }
  }
  const pct = total > 0 ? done / total : null;
  return {
    total,
    done,
    pct,
    lastFinishedDate: done === total && total > 0 ? lastFinishedDate : null,
  };
}

function programmeRowsForDrawingLevel(drawing, zones, programmeRows) {
  const rank = floorRankFromDrawing(drawing);
  const towers = new Set((zones || []).map((z) => String(z.tower || '').trim()).filter(Boolean));
  const out = [];
  for (const row of programmeRows || []) {
    const tw = String(row?.tower || '').trim();
    const zn = String(row?.zone_name || '').trim();
    const act = String(row?.activity_name || '').trim();
    if (!tw || !zn || !act) continue;
    if (!String(row.start_date || '').trim() || !String(row.end_date || '').trim()) continue;
    if (floorRankFromDrawing({ floor: row.drawing_floor, name: row.drawing_name }) !== rank) continue;
    if (towers.size && !towers.has(tw)) continue;
    out.push(row);
  }
  return out;
}

/**
 * Level completion for a drawing view: all programme rows on the same tower + floor
 * (pour areas A/B/C roll up to one level finish line).
 */
export function drawingLevelCompletionAsOf(asOfDate, drawing, zones, programmeRows, comp) {
  if (!drawing) return null;
  const rows = programmeRowsForDrawingLevel(drawing, zones, programmeRows);
  if (!rows.length) return null;
  const stats = levelCompletionForRows(rows, comp, asOfDate);
  return {
    ...stats,
    label: floorLabelFromDrawing(drawing),
    levelLabel: levelLabelFromRow(rows[0]),
  };
}

/**
 * Per-tower and per-level completion for a programme scope.
 * Level = tower + floor from drawing metadata; all pour zones on that floor share one finish line.
 */
export function programmeCompletionBreakdown(planRows, comp, rowMatches) {
  const byTower = new Map();
  const byLevel = new Map();
  for (const r of planRows || []) {
    if (!r || typeof rowMatches !== 'function' || !rowMatches(r)) continue;
    const tw = String(r.tower || '').trim() || '—';
    const zn = String(r.zone_name || '').trim();
    const act = String(r.activity_name || '').trim();
    if (!zn || !act) continue;
    if (!String(r.start_date || '').trim() || !String(r.end_date || '').trim()) continue;
    const lk = levelKeyFromRow(r);
    const rank = floorRankFromDrawing({ floor: r.drawing_floor, name: r.drawing_name });
    if (!byTower.has(tw)) byTower.set(tw, { label: tw, total: 0, done: 0 });
    if (!byLevel.has(lk)) {
      byLevel.set(lk, {
        label: levelLabelFromRow(r),
        rank,
        tower: tw,
        total: 0,
        done: 0,
        rows: [],
      });
    }
    tallyRow(byTower.get(tw), r, comp);
    const bucket = byLevel.get(lk);
    tallyRow(bucket, r, comp);
    bucket.rows.push(r);
  }
  const mapPct = (e) => ({ ...e, pct: e.total > 0 ? Math.round((e.done / e.total) * 100) : 0 });
  const mapLevel = (e) => {
    const base = mapPct(e);
    const lastFinishedDate =
      base.done === base.total && base.total > 0
        ? levelCompletionForRows(e.rows, comp, null).lastFinishedDate
        : null;
    return { label: base.label, total: base.total, done: base.done, pct: base.pct, lastFinishedDate };
  };
  const towerSort = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  return {
    towers: [...byTower.values()].map(mapPct).sort(towerSort),
    levels: [...byLevel.values()].map(mapLevel).sort((a, b) => {
      const tw = a.label.split(' · ')[0].localeCompare(b.label.split(' · ')[0], undefined, { numeric: true, sensitivity: 'base' });
      if (tw !== 0) return tw;
      return (a.rank ?? 999) - (b.rank ?? 999) || a.label.localeCompare(b.label);
    }),
  };
}

/** @deprecated Use drawingLevelCompletionAsOf — kept for compatibility. */
export function zoneCompletionsAsOf(date, zones, programmeRows, comp) {
  const asOfDate = normaliseDayKey(date);
  const zoneList = Array.isArray(zones) ? zones : [];
  const zoneIds = new Set(zoneList.map((z) => Number(z.id)).filter(Number.isFinite));
  const byZone = new Map(zoneList.map((z) => [Number(z.id), []]));

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
    const stats = levelCompletionForRows(rows, comp, asOfDate);
    out.set(zid, {
      pct: stats.pct,
      total: stats.total,
      done: stats.done,
      lastFinishedDate: stats.lastFinishedDate,
    });
  }
  return out;
}
