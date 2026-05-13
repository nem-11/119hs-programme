'use strict';

const pw = require('./planWorkingDays');

/** Normalize names so template strings match DB despite spacing / dash variants. */
function normalizeActivityKey(s) {
  return String(s || '')
    .trim()
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * @param {{ id: number|string, name?: string }[]} actRows
 * @returns {{ map: Map<string, number>, normMap: Map<string, number> }}
 */
function buildActivityLookup(actRows) {
  const map = new Map();
  const normMap = new Map();
  for (const a of actRows || []) {
    const id = Number(a.id);
    if (!Number.isFinite(id)) continue;
    const name = String(a.name ?? '');
    map.set(name, id);
    map.set(name.trim(), id);
    const nk = normalizeActivityKey(name);
    if (!normMap.has(nk)) normMap.set(nk, id);
  }
  return { map, normMap };
}

function resolveActivityId(lookup, templateName) {
  if (!lookup) return null;
  const raw = String(templateName ?? '');
  if (lookup.map?.has(raw)) return lookup.map.get(raw);
  const t = raw.trim();
  if (lookup.map?.has(t)) return lookup.map.get(t);
  const nk = normalizeActivityKey(raw);
  if (lookup.normMap?.has(nk)) return lookup.normMap.get(nk);
  return null;
}

/** Ensure one duration per sequence step (missing entries default to 1 scheduleable day). */
function alignTemplateDurations(sequence, durations) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = Array.isArray(durations) ? durations : [];
  return seq.map((_, i) => {
    const v = dur[i];
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.max(0.5, Math.round(n * 2) / 2) : 1;
  });
}

function dateKey(d) {
  return pw.dateKeyFromDate(d);
}

function parseYMD(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || '').trim());
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isWeekendDate(d) {
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}

/** @deprecated Prefer `normalizeScheduleStartKey` from plan rules; kept for API compat — snaps to next scheduleable day (Saturdays excluded). */
function snapToNextWeekday(d) {
  const k = pw.normalizeScheduleStartKey(pw.dateKeyFromDate(d));
  return parseYMD(k);
}

/** @deprecated Kept for API compat — last scheduleable day on or before this calendar date. */
function snapToPrevWeekday(d) {
  const k = pw.lastScheduleableDayOnOrBefore(pw.dateKeyFromDate(d));
  return parseYMD(k);
}

function prevWorkingDayBefore(dateKeyStr) {
  return pw.prevScheduleableDayBefore(String(dateKeyStr || '').trim());
}

function nextWorkingDayAfter(dateKeyStr) {
  return pw.nextScheduleableDayKey(String(dateKeyStr || '').trim());
}

function endDateOfSpanStarting(startKey, nWorking) {
  return pw.endOfScheduleableSpan(startKey, nWorking);
}

function startDateOfSpanEnding(endKey, nWorking) {
  return pw.startDateOfSpanEndingScheduleable(endKey, nWorking);
}

/**
 * Anchor activity ends on anchorEndDateKey (last scheduleable day of that stage on or before the chosen date).
 * Earlier stages are computed backwards; later stages forwards.
 * @param {{ map: Map<string, number>, normMap: Map<string, number> }} activityLookup from buildActivityLookup
 */
function buildRowsFromTargetEndDate({
  sequence,
  durations,
  anchorIndex,
  anchorEndDateKey,
  activityLookup,
}) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = alignTemplateDurations(seq, durations);
  const n = seq.length;
  const k = Math.min(Math.max(0, Number(anchorIndex) || 0), Math.max(0, n - 1));
  const raw = String(anchorEndDateKey || '').trim();
  if (!n || !raw) return [];

  const endK = pw.lastScheduleableDayOnOrBefore(raw);
  if (!endK || Number.isNaN(parseYMD(endK).getTime())) return [];

  const startK = startDateOfSpanEnding(endK, dur[k]);

  const rows = [];

  let nextStageStart = startK;
  for (let i = k - 1; i >= 0; i--) {
    const d = Math.max(0.5, Number(dur[i]) || 1);
    const end_i = d < 1 ? nextStageStart : prevWorkingDayBefore(nextStageStart);
    const start_i = startDateOfSpanEnding(end_i, d);
    const name = seq[i];
    rows[i] = {
      idx: i,
      activity_id: resolveActivityId(activityLookup, name),
      activity_name: name,
      start_date: start_i,
      end_date: end_i,
      status: 'planned',
      notes: '',
    };
    nextStageStart = start_i;
  }

  rows[k] = {
    idx: k,
    activity_id: resolveActivityId(activityLookup, seq[k]),
    activity_name: seq[k],
    start_date: startK,
    end_date: endK,
    status: 'active',
    notes: '',
  };

  let prevEnd = endK;
  for (let j = k + 1; j < n; j++) {
    const d = Math.max(0.5, Number(dur[j]) || 1);
    const start_j = d < 1 ? prevEnd : nextWorkingDayAfter(prevEnd);
    const end_j = endDateOfSpanStarting(start_j, d);
    const name = seq[j];
    rows[j] = {
      idx: j,
      activity_id: resolveActivityId(activityLookup, name),
      activity_name: name,
      start_date: start_j,
      end_date: end_j,
      status: 'planned',
      notes: '',
    };
    prevEnd = end_j;
  }

  return rows.filter(Boolean);
}

function buildRowsFromTemplate({
  sequence,
  durations,
  startStageIndex,
  startDateKey,
  activityLookup,
}) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = alignTemplateDurations(seq, durations);
  const n = seq.length;
  const k = Math.min(Math.max(0, Number(startStageIndex) || 0), Math.max(0, n - 1));
  const raw = String(startDateKey || '').trim();
  if (!n || !raw) return [];

  const startNorm = pw.normalizeScheduleStartKey(raw);
  if (!startNorm || Number.isNaN(parseYMD(startNorm).getTime())) return [];

  const rows = [];

  let cursor = prevWorkingDayBefore(startNorm);
  for (let j = k - 1; j >= 0; j--) {
    const d = Math.max(0.5, Number(dur[j]) || 1);
    const last = cursor;
    const first = startDateOfSpanEnding(last, d);
    const name = seq[j];
    rows[j] = {
      idx: j,
      activity_id: resolveActivityId(activityLookup, name),
      activity_name: name,
      start_date: first,
      end_date: last,
      status: 'done',
      notes: '',
    };
    cursor = d < 1 ? prevWorkingDayBefore(last) : prevWorkingDayBefore(first);
  }

  let curStart = startNorm;
  for (let j = k; j < n; j++) {
    const d = Math.max(0.5, Number(dur[j]) || 1);
    const last = endDateOfSpanStarting(curStart, d);
    const name = seq[j];
    const status = j === k ? 'active' : 'planned';
    rows[j] = {
      idx: j,
      activity_id: resolveActivityId(activityLookup, name),
      activity_name: name,
      start_date: curStart,
      end_date: last,
      status,
      notes: '',
    };
    curStart = d < 1 ? last : nextWorkingDayAfter(last);
  }

  return rows.filter(Boolean);
}

function todayKey() {
  return pw.normalizeScheduleStartKey(pw.dateKeyFromDate(new Date()));
}

/** Calendar-day shift (matches client Programme shift). */
function addCalendarDays(dateKeyStr, delta) {
  const d = parseYMD(dateKeyStr);
  if (Number.isNaN(d.getTime())) return String(dateKeyStr || '').trim();
  d.setDate(d.getDate() + Number(delta || 0));
  return dateKey(d);
}

module.exports = {
  buildRowsFromTemplate,
  buildRowsFromTargetEndDate,
  buildActivityLookup,
  resolveActivityId,
  alignTemplateDurations,
  normalizeActivityKey,
  nextWorkingDayAfter,
  prevWorkingDayBefore,
  dateKey,
  todayKey,
  addCalendarDays,
  parseYMD,
  snapToNextWeekday,
  snapToPrevWeekday,
  isWeekendDate,
};
