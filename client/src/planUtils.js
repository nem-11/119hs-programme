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

/** Saturday, Sunday, or England & Wales bank holiday — excluded from default programme scheduling and site schedule slots. */
export function isNonWorkingPlanDayKey(dayKey) {
  return isSaturdayKey(dayKey) || isSundayKey(dayKey) || isBankHolidayKey(dayKey);
}

/** Sunday or bank holiday only — Plan grid hides chips here and blocks drops; Saturday stays available for manual moves. */
export function isSundayOrBankHolidayKey(dayKey) {
  return isSundayKey(dayKey) || isBankHolidayKey(dayKey);
}

/** Programme / schedule day keys between bounds (excludes Sat, Sun, and bank holidays). */
export function scheduleDateKeysBetween(startStr, endStr) {
  return calendarDaysBetween(startStr, endStr).filter((k) => !isNonWorkingPlanDayKey(k));
}

/**
 * Snap programme item bounds to scheduleable days only. Uses the longest contiguous
 * run of scheduleable calendar days inside [start, end], so a bar cannot "bridge"
 * across a weekend or bank holiday (e.g. Mon–Fri only when Sat–Sun fall inside the window).
 * If the window has no scheduleable day, falls back to a single-day span from the
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
