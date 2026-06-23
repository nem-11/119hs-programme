import { dateKey } from './constants';
import BANK_HOLIDAYS_EW from './data/bank-holidays-ew.json';

const bankHolidaySet = new Set(Array.isArray(BANK_HOLIDAYS_EW) ? BANK_HOLIDAYS_EW : []);

/** Inclusive calendar days from YYYY-MM-DD to YYYY-MM-DD. */
export function calendarDaysBetween(startStr, endStr) {
  const out = [];
  const [ys, ms, ds] = String(startStr).split('-').map(Number);
  const [ye, me, de] = String(endStr).split('-').map(Number);
  const d = new Date(ys, ms - 1, ds, 12, 0, 0);
  const end = new Date(ye, me - 1, de, 12, 0, 0);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d > end) return out;
  while (d <= end) {
    out.push(dateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function isSundayKey(dayKey) {
  const [y, m, da] = String(dayKey).split('-').map(Number);
  const d = new Date(y, m - 1, da, 12, 0, 0);
  if (Number.isNaN(d.getTime())) return false;
  return d.getDay() === 0;
}

export function isSaturdayKey(dayKey) {
  const [y, m, da] = String(dayKey).split('-').map(Number);
  const d = new Date(y, m - 1, da, 12, 0, 0);
  if (Number.isNaN(d.getTime())) return false;
  return d.getDay() === 6;
}

export function isBankHolidayKey(dayKey) {
  return bankHolidaySet.has(String(dayKey).trim());
}

/** England & Wales bank holiday — excluded from default programme scheduling and site schedule slots. Saturdays and Sundays are allowed. */
export function isNonWorkingPlanDayKey(dayKey) {
  return isBankHolidayKey(dayKey);
}

/** Bank holiday only — Plan grid hides chips here and blocks drops. */
export function isSundayOrBankHolidayKey(dayKey) {
  return isBankHolidayKey(dayKey);
}

/** Programme / schedule day keys between bounds (excludes bank holidays only). */
export function scheduleDateKeysBetween(startStr, endStr) {
  return calendarDaysBetween(startStr, endStr).filter((k) => !isNonWorkingPlanDayKey(k));
}

/**
 * Snap programme item bounds to scheduleable days only. Uses the longest contiguous
 * run of calendar days inside [start, end], skipping bank holidays only.
 * If the window has no valid day, falls back to a single-day span from the
 * next scheduleable start.
 */
export function clampProgrammeItemToScheduleableRange(startStr, endStr) {
  const s0 = String(startStr || '').trim();
  const e0 = String(endStr || '').trim();
  const cal = calendarDaysBetween(s0, e0);
  const sched = cal.filter((k) => !isNonWorkingPlanDayKey(k));
  if (!sched.length) {
    const s = normalizeScheduleStartKey(startStr);
    return { start_date: s, end_date: endOfScheduleableSpan(s, 1) };
  }
  return { start_date: sched[0], end_date: sched[sched.length - 1] };
}

export function countScheduleableDaysInclusive(startKey, endKey) {
  return Math.max(1, scheduleDateKeysBetween(startKey, endKey).length);
}

export function normalizeScheduleStartKey(dayKey) {
  const d = new Date(String(dayKey) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateKey(new Date());
  while (isNonWorkingPlanDayKey(dateKey(d))) d.setDate(d.getDate() + 1);
  return dateKey(d);
}

export function endOfScheduleableSpan(startKey, durationDays) {
  const n = Math.max(0.5, Number(durationDays) || 1);
  let d = new Date(String(normalizeScheduleStartKey(startKey)) + 'T12:00:00');
  for (let i = 1; i < n; i++) {
    d.setDate(d.getDate() + 1);
    while (isNonWorkingPlanDayKey(dateKey(d))) d.setDate(d.getDate() + 1);
  }
  return dateKey(d);
}

export function nextScheduleableDayKey(dayKey) {
  let d = new Date(String(dayKey) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateKey(new Date());
  d.setDate(d.getDate() + 1);
  while (isNonWorkingPlanDayKey(dateKey(d))) d.setDate(d.getDate() + 1);
  return dateKey(d);
}

/** Last scheduleable day on or before this calendar day (for anchor end dates). */
export function lastScheduleableDayOnOrBefore(dayKey) {
  let d = new Date(String(dayKey).trim() + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dayKey).trim();
  while (isNonWorkingPlanDayKey(dateKey(d))) d.setDate(d.getDate() - 1);
  return dateKey(d);
}

/** First scheduleable day strictly before `dayKey`. */
export function prevScheduleableDayBefore(dayKey) {
  let d = new Date(String(dayKey).trim() + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dayKey).trim();
  d.setDate(d.getDate() - 1);
  while (isNonWorkingPlanDayKey(dateKey(d))) d.setDate(d.getDate() - 1);
  return dateKey(d);
}

/** First day of an inclusive span of `n` scheduleable days that ends on or before `endKey`. */
export function startDateOfSpanEndingScheduleable(endKey, nDays) {
  const n = Math.max(0.5, Number(nDays) || 1);
  let curKey = lastScheduleableDayOnOrBefore(endKey);
  let hops = Math.max(0, Math.ceil(n) - 1);
  while (hops--) curKey = prevScheduleableDayBefore(curKey);
  return curKey;
}

export function isWeekendKey(dayKey) {
  const [y, m, da] = String(dayKey).split('-').map(Number);
  const d = new Date(y, m - 1, da, 12, 0, 0);
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}

export function dayKeyInItemRange(dayKey, startStr, endStr) {
  return dayKey >= String(startStr) && dayKey <= String(endStr);
}

/** Split a programme item at one scheduleable day (for per-day drag / shift moves). */
export function splitProgrammeItemAtDay(item, dayKey) {
  const dk = normalizeScheduleStartKey(dayKey);
  const days = scheduleDateKeysBetween(item.start_date, item.end_date);
  const idx = days.indexOf(dk);
  if (idx < 0) return null;
  return {
    before: idx > 0 ? { start_date: days[0], end_date: days[idx - 1] } : null,
    after: idx < days.length - 1 ? { start_date: days[idx + 1], end_date: days[days.length - 1] } : null,
    isOnlyDay: days.length === 1,
    sourceDay: dk,
  };
}

const ABBREV_MAP = {
  'Reinforcement - Shuttering': 'REIN-SHUT',
  'Corridor Ceiling Stitch': 'C.CEIL',
  'Modular Ceiling Stitch': 'M.CEIL',
  'Modular Floor Stitch': 'M.FLOOR',
  'Corridor Floor Stitch': 'C.FLOOR',
  'Riser Stitching': 'RISER',
  'Stair Core Stitching': 'S.CORE',
  'Form Pile Cap': 'F.CAP',
  'Cage Pile Cap': 'C.CAP',
  'Pour Pile Cap': 'P.CAP',
  'Break Pile Cap': 'B.CAP',
  'Service Riser stitching': 'SVC-RIS',
  'MEP Riser': 'MEP-R',
  'MEP Corridor': 'MEP-C',
  'Install Ceiling Panels': 'CEIL-P',
  'Ceiling Install': 'CEIL',
  'Modular Linear Stitch': 'MOD-LIN',
  'Install Fire Doors': 'FIRE-D',
  'Form Door Aperture': 'DOOR-AP',
  'Commission': 'COMM',
  'Stud Walls': 'STUD',
  'Dryline': 'DRY',
  'Blinding': 'BLIND',
  'Drainage': 'DRAIN',
  'Waterproofing': 'WATER',
  'Insulation': 'INSUL',
  'Pour': 'POUR',
  'Verts': 'VERTS',
  'Podium Pour': 'P.POUR',
  'Cure': 'CURE',
  'Pile Mat': 'P.MAT',
  'Piling': 'PILE',
  'Crop Piles': 'CROP',
};

/** Short label for programme grid cells. */
export function abbrevActivity(name) {
  if (!name) return '';
  if (ABBREV_MAP[name]) return ABBREV_MAP[name];
  const s = String(name).trim();
  if (s.length <= 11) return s.toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  const ac = parts
    .map((w) => w.replace(/[^a-zA-Z]/g, '').charAt(0))
    .filter(Boolean)
    .join('')
    .toUpperCase();
  return (ac.slice(0, 10) || s.slice(0, 10)).toUpperCase();
}

export function zoneRowLabel(row) {
  const tw = (row.tower || '').trim();
  const zn = (row.zone_name || '').trim();
  if (tw && zn) return `${tw} ${zn}`.toUpperCase();
  return (zn || tw || 'ZONE').toUpperCase();
}

/** Update / Plan completion key: tower|zone_name|activity_name */
export function completionKeyFromProgrammeRow(row) {
  const tw = String(row?.tower || '').trim();
  const zn = String(row?.zone_name || '').trim();
  const act = String(row?.activity_name || '').trim();
  if (!tw || !zn || !act) return '';
  return `${tw}|${zn}|${act}`;
}

export function asCompletionsMap(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  if (typeof x.error === 'string') return {};
  return x;
}

/** True when this programme column day has its own Update tick (or frozen template row status is done). */
export function isProgrammeItemDoneOnDay(row, dayKey, comp) {
  if (!row) return false;
  const dk = String(dayKey || '').trim();
  if (!dk || !dayKeyInItemRange(dk, row.start_date, row.end_date)) return false;
  const ck = completionKeyFromProgrammeRow(row);
  if (ck && comp?.[dk]?.[ck]) return true;
  if (String(row.status || '').toLowerCase() === 'done') return true;
  return false;
}

/**
 * Set of completion keys ticked on at least one day. Use isProgrammeItemDoneOnDay for
 * per-day Plan grid cells; use this set only when you need activity-level "any day ticked".
 */
export function completionDoneKeySet(comp) {
  const s = new Set();
  if (!comp || typeof comp !== 'object') return s;
  for (const dk of Object.keys(comp)) {
    const day = comp[dk];
    if (!day || typeof day !== 'object') continue;
    for (const ck of Object.keys(day)) {
      if (day[ck]) s.add(ck);
    }
  }
  return s;
}

/**
 * Returns the completion record { date, by, at } for the first tick found on any day,
 * or null if the row has no tick. Sorted by date ascending so the earliest tick is returned.
 */
export function completionInfoForRow(row, comp) {
  const ck = completionKeyFromProgrammeRow(row);
  if (!ck || !comp || typeof comp !== 'object') return null;
  const dates = Object.keys(comp).sort();
  for (const dk of dates) {
    const entry = comp[dk]?.[ck];
    if (entry) return { date: dk, by: entry.by || '', at: entry.at || '' };
  }
  return null;
}

/** Completion record for a specific programme day column (Plan grid / chip modal). */
export function completionInfoForRowOnDay(row, dayKey, comp) {
  const ck = completionKeyFromProgrammeRow(row);
  const dk = String(dayKey || '').trim();
  if (!ck || !dk || !comp || typeof comp !== 'object') return null;
  const entry = comp[dk]?.[ck];
  if (!entry) return null;
  return { date: dk, by: entry.by || '', at: entry.at || '' };
}

/** All scheduled days in the item span carry a tick (or programme row status is done). */
export function isProgrammeRowFullyDone(row, comp) {
  if (!row) return false;
  if (String(row.status || '').toLowerCase() === 'done') return true;
  const ck = completionKeyFromProgrammeRow(row);
  if (!ck || !comp || typeof comp !== 'object') return false;
  const days = scheduleDateKeysBetween(row.start_date, row.end_date);
  if (!days.length) return false;
  return days.every((dk) => !!comp[dk]?.[ck]);
}

/**
 * Activity-level done: status done, or a tick exists on any day for this row's key.
 * Pass a precomputed key set from completionDoneKeySet(comp) for efficiency; otherwise
 * the completions map is scanned.
 */
export function isProgrammeRowDone(row, comp, doneKeys) {
  if (!row) return false;
  if (String(row.status || '').toLowerCase() === 'done') return true;
  const ck = completionKeyFromProgrammeRow(row);
  if (!ck) return false;
  if (doneKeys instanceof Set) return doneKeys.has(ck);
  if (!comp || typeof comp !== 'object') return false;
  for (const dk of Object.keys(comp)) {
    if (comp[dk]?.[ck]) return true;
  }
  return false;
}

/** Normalise programme item shift to 'day' or 'night'. */
export function programmeItemShift(row) {
  return String(row?.shift || 'day').trim().toLowerCase() === 'night' ? 'night' : 'day';
}
