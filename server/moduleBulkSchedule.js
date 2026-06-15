'use strict';

/**
 * Module bulk programme — order 245 module zones and assign Module Completion
 * template start dates (5 per Mon–Sat day, Sundays + bank holidays skipped).
 */

const pw = require('./planWorkingDays');
const schedule = require('./programmeSchedule');

const MODULE_HANDOVER_TAB = 'module_handover';
const MODULE_PROGRAMME_TAB = 'module_programme';
const TOWER_ORDER = ['T4', 'T1', 'T2', 'T3'];

/** Module Completion template — 11 activities, 12 scheduleable days (Module Paint = 2d). */
const MODULE_COMPLETION_SEQUENCE = [
  'Ryan Snag',
  'Build Clean',
  'Mastic',
  'Carpentry',
  'Make Good',
  'Module Paint',
  'Furniture Install',
  'TV Install',
  'Ryan De Snag',
  'Unilife Sign Off',
  'Sparkle',
];
const MODULE_COMPLETION_DURATIONS = [1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1];
const MODULE_COMPLETION_TEMPLATE_NAME = 'Module Completion';

const DEFAULT_BULK_START = '2026-06-22';
const DEFAULT_MODULES_PER_DAY = 5;

function isModuleStartNonWorkingDayKey(dayKey) {
  return pw.isSundayKey(dayKey) || pw.isBankHolidayKey(dayKey);
}

function parseYMD(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || '').trim());
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function normalizeModuleStartKey(dayKey) {
  const d = parseYMD(String(dayKey || '').trim());
  if (Number.isNaN(d.getTime())) return pw.dateKeyFromDate(new Date());
  while (isModuleStartNonWorkingDayKey(pw.dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
  return pw.dateKeyFromDate(d);
}

function nextModuleWorkingDayAfter(dayKey) {
  let d = parseYMD(String(dayKey || '').trim());
  if (Number.isNaN(d.getTime())) return pw.dateKeyFromDate(new Date());
  d.setDate(d.getDate() + 1);
  while (isModuleStartNonWorkingDayKey(pw.dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
  return pw.dateKeyFromDate(d);
}

function prevModuleWorkingDayBefore(dayKey) {
  let d = parseYMD(String(dayKey || '').trim());
  if (Number.isNaN(d.getTime())) return String(dayKey || '').trim();
  d.setDate(d.getDate() - 1);
  while (isModuleStartNonWorkingDayKey(pw.dateKeyFromDate(d))) d.setDate(d.getDate() - 1);
  return pw.dateKeyFromDate(d);
}

function endOfModuleCompletionSpan(startKey, durationDays) {
  const n = Math.max(0.5, Number(durationDays) || 1);
  let d = parseYMD(normalizeModuleStartKey(startKey));
  for (let i = 1; i < n; i++) {
    d.setDate(d.getDate() + 1);
    while (isModuleStartNonWorkingDayKey(pw.dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
  }
  return pw.dateKeyFromDate(d);
}

function startDateOfModuleSpanEnding(endKey, nDays) {
  const n = Math.max(0.5, Number(nDays) || 1);
  let curKey = String(endKey || '').trim();
  let d = parseYMD(curKey);
  while (isModuleStartNonWorkingDayKey(pw.dateKeyFromDate(d))) {
    d.setDate(d.getDate() - 1);
    curKey = pw.dateKeyFromDate(d);
  }
  let hops = Math.max(0, Math.ceil(n) - 1);
  while (hops--) curKey = prevModuleWorkingDayBefore(curKey);
  return curKey;
}

/** Floor rank from drawing name/floor — ground = 0 (excluded), 1st floor = 1, etc. */
function floorRankFromDrawing(drawing) {
  const parts = [drawing?.floor, drawing?.name].filter(Boolean).map((x) => String(x).toLowerCase());
  const s = parts.join(' ');
  if (s.includes('basement')) return -1;
  if (s.includes('ground') || /\bgf\b/.test(s)) return 0;
  const m = s.match(/(\d+)\s*(?:st|nd|rd|th)?\s*floor/) || s.match(/floor\s*(\d+)/) || s.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 999;
}

function isGroundFloorDrawing(drawing) {
  return floorRankFromDrawing(drawing) <= 0;
}

function towerSortKey(tower) {
  const t = String(tower || '').trim().toUpperCase();
  const idx = TOWER_ORDER.indexOf(t);
  return idx >= 0 ? idx : TOWER_ORDER.length + t.charCodeAt(0);
}

function parseGeomCenterX(z) {
  let g = null;
  try {
    g = typeof z.geometry === 'string' ? JSON.parse(z.geometry) : z.geometry;
  } catch (_) {}
  if (g?.kind === 'rect') return Number(g.x) + Number(g.w) / 2;
  if (g?.kind === 'poly' && Array.isArray(g.points) && g.points.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of g.points) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
    }
    return (minX + maxX) / 2;
  }
  return Number(z.x) + Number(z.w) / 2;
}

/** Right-to-left on plan: higher centre-x first. */
function compareModulesRightToLeft(a, b) {
  const cxA = parseGeomCenterX(a);
  const cxB = parseGeomCenterX(b);
  if (cxB !== cxA) return cxB - cxA;
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
}

/**
 * @param {function} allFn — db.all(sql, params)
 * @returns {Array<object>} ordered module zone rows with drawing metadata
 */
function getOrderedModuleZones(allFn) {
  const rows = allFn(
    `SELECT z.*, d.name AS drawing_name, d.floor AS drawing_floor, d.tab AS drawing_tab
     FROM zones z
     JOIN drawings d ON d.id = z.drawing_id
     WHERE d.tab = ?
     ORDER BY z.id`,
    [MODULE_HANDOVER_TAB]
  );

  const byTower = new Map();
  for (const z of rows) {
    const drawing = { name: z.drawing_name, floor: z.drawing_floor };
    if (isGroundFloorDrawing(drawing)) continue;
    const tw = String(z.tower || '').trim().toUpperCase() || '—';
    if (!byTower.has(tw)) byTower.set(tw, []);
    byTower.get(tw).push({ ...z, _floorRank: floorRankFromDrawing(drawing), _drawing: drawing });
  }

  const ordered = [];
  const extraTowers = [...byTower.keys()]
    .filter((tw) => !TOWER_ORDER.includes(tw))
    .sort((a, b) => towerSortKey(a) - towerSortKey(b));
  const towers = TOWER_ORDER.filter((tw) => byTower.has(tw)).concat(extraTowers);
  for (const tw of towers) {
    const list = byTower.get(tw);
    const byFloor = new Map();
    for (const z of list) {
      const fr = z._floorRank;
      if (!byFloor.has(fr)) byFloor.set(fr, []);
      byFloor.get(fr).push(z);
    }
    const floors = [...byFloor.keys()].sort((a, b) => a - b);
    for (const fr of floors) {
      const floorModules = [...byFloor.get(fr)].sort(compareModulesRightToLeft);
      ordered.push(...floorModules);
    }
  }
  return ordered;
}

/** Assign Mon–Sat start dates (5 modules per day) from anchor Monday. */
function assignModuleStartDates(count, opts = {}) {
  const anchor = normalizeModuleStartKey(opts.startDate || DEFAULT_BULK_START);
  const perDay = Math.max(1, Number(opts.modulesPerDay) || DEFAULT_MODULES_PER_DAY);
  const out = [];
  let d = parseYMD(anchor);
  let slot = 0;

  while (out.length < count) {
    const key = pw.dateKeyFromDate(d);
    if (!isModuleStartNonWorkingDayKey(key)) {
      for (let i = 0; i < perDay && out.length < count; i++) {
        out.push(key);
      }
    }
    d.setDate(d.getDate() + 1);
    slot += 1;
    if (slot > 500) break;
  }
  return out;
}

/** Start-date-forward rows using Mon–Sat module completion calendar. */
function buildRowsFromModuleTemplateStart({
  sequence,
  durations,
  startStageIndex,
  startDateKey,
  activityLookup,
}) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = schedule.alignTemplateDurations(seq, durations);
  const n = seq.length;
  const k = Math.min(Math.max(0, Number(startStageIndex) || 0), Math.max(0, n - 1));
  const raw = String(startDateKey || '').trim();
  if (!n || !raw) return [];

  const startNorm = normalizeModuleStartKey(raw);
  if (Number.isNaN(parseYMD(startNorm).getTime())) return [];

  const rows = [];

  let cursor = prevModuleWorkingDayBefore(startNorm);
  for (let j = k - 1; j >= 0; j--) {
    const d = Math.max(0.5, Number(dur[j]) || 1);
    const last = cursor;
    const first = startDateOfModuleSpanEnding(last, d);
    const name = seq[j];
    rows[j] = {
      idx: j,
      activity_id: schedule.resolveActivityId(activityLookup, name),
      activity_name: name,
      start_date: first,
      end_date: last,
      status: 'done',
      notes: '',
    };
    cursor = d < 1 ? prevModuleWorkingDayBefore(last) : prevModuleWorkingDayBefore(first);
  }

  let curStart = startNorm;
  for (let j = k; j < n; j++) {
    const d = Math.max(0.5, Number(dur[j]) || 1);
    const last = endOfModuleCompletionSpan(curStart, d);
    const name = seq[j];
    const status = j === k ? 'active' : 'planned';
    rows[j] = {
      idx: j,
      activity_id: schedule.resolveActivityId(activityLookup, name),
      activity_name: name,
      start_date: curStart,
      end_date: last,
      status,
      notes: '',
    };
    curStart = d < 1 ? last : nextModuleWorkingDayAfter(last);
  }

  return rows.filter(Boolean);
}

/**
 * Which Module Completion activity a zone is on for `todayKey`, or meta states.
 * @returns {{ kind: 'activity'|'not_yet_started'|'completed', activity_name?: string }}
 */
function moduleProgrammeStatusForZone(items, todayKey) {
  const list = (Array.isArray(items) ? items : [])
    .filter((r) => r && r.start_date && r.end_date)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  if (!list.length) return { kind: 'not_yet_started' };
  const today = String(todayKey || '').trim();
  const firstStart = String(list[0].start_date);
  const lastEnd = String(list[list.length - 1].end_date);
  if (today < firstStart) return { kind: 'not_yet_started' };
  if (today > lastEnd) return { kind: 'completed' };
  for (const r of list) {
    if (today >= String(r.start_date) && today <= String(r.end_date)) {
      return { kind: 'activity', activity_name: String(r.activity_name || '').trim() };
    }
  }
  return { kind: 'not_yet_started' };
}

function summarizeModuleProgrammeProgress(itemsByZoneId, zoneIds, todayKey, sequence) {
  const seq = Array.isArray(sequence) ? sequence : MODULE_COMPLETION_SEQUENCE;
  const counts = { not_yet_started: 0, completed: 0 };
  for (const name of seq) counts[name] = 0;

  for (const zid of zoneIds) {
    const items = itemsByZoneId.get(Number(zid)) || [];
    const st = moduleProgrammeStatusForZone(items, todayKey);
    if (st.kind === 'activity' && st.activity_name && counts[st.activity_name] != null) {
      counts[st.activity_name] += 1;
    } else if (st.kind === 'not_yet_started') {
      counts.not_yet_started += 1;
    } else if (st.kind === 'completed') {
      counts.completed += 1;
    }
  }
  return counts;
}

module.exports = {
  MODULE_HANDOVER_TAB,
  MODULE_PROGRAMME_TAB,
  MODULE_COMPLETION_SEQUENCE,
  MODULE_COMPLETION_DURATIONS,
  MODULE_COMPLETION_TEMPLATE_NAME,
  TOWER_ORDER,
  DEFAULT_BULK_START,
  DEFAULT_MODULES_PER_DAY,
  getOrderedModuleZones,
  assignModuleStartDates,
  buildRowsFromModuleTemplateStart,
  moduleProgrammeStatusForZone,
  summarizeModuleProgrammeProgress,
  floorRankFromDrawing,
  isGroundFloorDrawing,
  parseGeomCenterX,
  normalizeModuleStartKey,
};
