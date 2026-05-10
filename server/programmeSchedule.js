'use strict';

function dateKey(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
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

function snapToPrevWeekday(d) {
  const x = new Date(d);
  while (isWeekendDate(x)) x.setDate(x.getDate() - 1);
  return x;
}

function snapToNextWeekday(d) {
  const x = new Date(d);
  while (isWeekendDate(x)) x.setDate(x.getDate() + 1);
  return x;
}

function prevWorkingDayBefore(dateKeyStr) {
  let d = parseYMD(dateKeyStr);
  d.setDate(d.getDate() - 1);
  return dateKey(snapToPrevWeekday(d));
}

function nextWorkingDayAfter(dateKeyStr) {
  let d = parseYMD(dateKeyStr);
  d.setDate(d.getDate() + 1);
  return dateKey(snapToNextWeekday(d));
}

function nextWorkingDayFrom(d) {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  return snapToNextWeekday(x);
}

function prevWorkingDayFrom(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - 1);
  return snapToPrevWeekday(x);
}

function endDateOfSpanStarting(startKey, nWorking) {
  const n = Math.max(0.5, Number(nWorking) || 1);
  let end = new Date(snapToNextWeekday(parseYMD(startKey)));
  for (let i = 1; i < n; i++) end = nextWorkingDayFrom(end);
  return dateKey(end);
}

function startDateOfSpanEnding(endKey, nWorking) {
  const n = Math.max(0.5, Number(nWorking) || 1);
  let start = new Date(snapToPrevWeekday(parseYMD(endKey)));
  for (let i = 1; i < n; i++) start = prevWorkingDayFrom(start);
  return dateKey(start);
}

/**
 * @param {Map<string, number>} activityIdByName
 */
/**
 * Anchor activity ends on anchorEndDateKey (last weekday of that stage).
 * Earlier stages are computed backwards; later stages forwards.
 * @param {Map<string, number>} activityIdByName
 */
function buildRowsFromTargetEndDate({
  sequence,
  durations,
  anchorIndex,
  anchorEndDateKey,
  activityIdByName,
}) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = Array.isArray(durations) ? durations : [];
  const n = seq.length;
  const k = Math.min(Math.max(0, Number(anchorIndex) || 0), Math.max(0, n - 1));
  const raw = String(anchorEndDateKey || '').trim();
  if (!n || !raw) return [];

  const endK = dateKey(snapToPrevWeekday(parseYMD(raw)));
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
      activity_id: activityIdByName.get(name) ?? null,
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
    activity_id: activityIdByName.get(seq[k]) ?? null,
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
      activity_id: activityIdByName.get(name) ?? null,
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
  activityIdByName,
}) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = Array.isArray(durations) ? durations : [];
  const n = seq.length;
  const k = Math.min(Math.max(0, Number(startStageIndex) || 0), Math.max(0, n - 1));
  const raw = String(startDateKey || '').trim();
  if (!n || !raw) return [];

  const startNorm = dateKey(snapToNextWeekday(parseYMD(raw)));
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
      activity_id: activityIdByName.get(name) ?? null,
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
      activity_id: activityIdByName.get(name) ?? null,
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
  return dateKey(snapToNextWeekday(new Date()));
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
  nextWorkingDayAfter,
  prevWorkingDayBefore,
  dateKey,
  todayKey,
  addCalendarDays,
  parseYMD,
  snapToNextWeekday,
};
