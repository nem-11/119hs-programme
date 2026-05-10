import { dateKey } from './constants';

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

export function snapToPrevWeekday(d) {
  const x = new Date(d);
  while (isWeekendDate(x)) x.setDate(x.getDate() - 1);
  return x;
}

export function snapToNextWeekday(d) {
  const x = new Date(d);
  while (isWeekendDate(x)) x.setDate(x.getDate() + 1);
  return x;
}

/** Last weekday strictly before dateKey (calendar day before, then skip weekends). */
export function prevWorkingDayBefore(dateKey) {
  let d = parseYMD(dateKey);
  d.setDate(d.getDate() - 1);
  return formatYMD(snapToPrevWeekday(d));
}

/** First weekday strictly after dateKey. */
export function nextWorkingDayAfter(dateKey) {
  let d = parseYMD(dateKey);
  d.setDate(d.getDate() + 1);
  return formatYMD(snapToNextWeekday(d));
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

/** Inclusive span of n weekday days starting at startKey (n>=1). */
export function endDateOfSpanStarting(startKey, nWorking) {
  const n = Math.max(0.5, Number(nWorking) || 1);
  let cur = snapToNextWeekday(parseYMD(startKey));
  let end = new Date(cur);
  for (let i = 1; i < n; i++) end = nextWorkingDayFrom(end);
  return formatYMD(end);
}

/** Inclusive span of n weekday days ending at endKey (n>=1). */
export function startDateOfSpanEnding(endKey, nWorking) {
  const n = Math.max(0.5, Number(nWorking) || 1);
  let cur = snapToPrevWeekday(parseYMD(endKey));
  let start = new Date(cur);
  for (let i = 1; i < n; i++) start = prevWorkingDayFrom(start);
  return formatYMD(start);
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
 * @param startDateKey — first weekday of that stage
 */
/** Anchor stage finishes on anchorEndDateKey (weekday). Prior / following stages use template durations on working days only. */
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

  const endK = formatYMD(snapToPrevWeekday(parseYMD(raw)));
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

  const startNorm = formatYMD(snapToNextWeekday(parseYMD(raw)));
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
