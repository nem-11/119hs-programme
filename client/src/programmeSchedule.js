import { dateKey } from './constants';
import {
  normalizeScheduleStartKey,
  endOfScheduleableSpan,
  nextScheduleableDayKey,
  prevScheduleableDayBefore,
  lastScheduleableDayOnOrBefore,
  startDateOfSpanEndingScheduleable,
} from './planUtils';

export function normalizeActivityKey(s) {
  return String(s || '')
    .trim()
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * @param {{ id: number|string, name?: string }[]} actRows
 */
export function buildActivityLookup(actRows) {
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

export function resolveActivityId(lookup, templateName) {
  if (!lookup) return null;
  const raw = String(templateName ?? '');
  if (lookup.map?.has(raw)) return lookup.map.get(raw);
  const t = raw.trim();
  if (lookup.map?.has(t)) return lookup.map.get(t);
  const nk = normalizeActivityKey(raw);
  if (lookup.normMap?.has(nk)) return lookup.normMap.get(nk);
  return null;
}

export function alignTemplateDurations(sequence, durations) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = Array.isArray(durations) ? durations : [];
  return seq.map((_, i) => {
    const v = dur[i];
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.max(0.5, Math.round(n * 2) / 2) : 1;
  });
}

export function formatYMD(d) {
  return dateKey(d);
}

export function parseYMD(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || '').trim());
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isWeekendDate(d) {
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}

/** Last scheduleable day on or before this calendar date (Saturdays, Sundays, and EW bank holidays excluded from work). */
export function snapToPrevWeekday(d) {
  return parseYMD(lastScheduleableDayOnOrBefore(formatYMD(d)));
}

/** First scheduleable day on or after this calendar date. */
export function snapToNextWeekday(d) {
  return parseYMD(normalizeScheduleStartKey(formatYMD(d)));
}

/** Last scheduleable day strictly before `dateKey`. */
export function prevWorkingDayBefore(dayKeyStr) {
  return prevScheduleableDayBefore(String(dayKeyStr || '').trim());
}

/** First scheduleable day strictly after `dateKey`. */
export function nextWorkingDayAfter(dayKeyStr) {
  return nextScheduleableDayKey(String(dayKeyStr || '').trim());
}

/** Inclusive span of `n` scheduleable days starting at `startKey`. */
export function endDateOfSpanStarting(startKey, nWorking) {
  return endOfScheduleableSpan(startKey, nWorking);
}

/** First day of an inclusive span of `n` scheduleable days ending on or before `endKey`. */
export function startDateOfSpanEnding(endKey, nWorking) {
  return startDateOfSpanEndingScheduleable(endKey, nWorking);
}

export function addCalendarDays(dateKey, delta) {
  const d = parseYMD(dateKey);
  if (Number.isNaN(d.getTime())) return dateKey;
  d.setDate(d.getDate() + Number(delta || 0));
  return formatYMD(d);
}

/**
 * Build programme rows from template sequence + durations.
 * @param startStageIndex — index in sequence for "start from" (current stage)
 * @param startDateKey — first scheduleable day of that stage (Mondays–Fridays; Saturdays, Sundays, and England and Wales bank holidays do not count)
 * Anchor stage (target-end flow): finishes on anchorEndDateKey (last scheduleable day on or before chosen date).
 */
export function buildRowsFromTargetEndDate({
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

  const endK = lastScheduleableDayOnOrBefore(raw);
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

export function buildRowsFromTemplate({
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

  const startNorm = normalizeScheduleStartKey(raw);
  if (!startNorm || Number.isNaN(parseYMD(startNorm).getTime())) return [];

  const rows = new Array(n);

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
