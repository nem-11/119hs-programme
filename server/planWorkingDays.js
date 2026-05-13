'use strict';

const fs = require('fs');
const path = require('path');

function dateKeyFromDate(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

let bankHolidaySet = new Set();
try {
  const p = path.join(__dirname, '..', 'client', 'src', 'data', 'bank-holidays-ew.json');
  const raw = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(raw);
  if (Array.isArray(arr)) bankHolidaySet = new Set(arr.map((x) => String(x).trim()));
} catch (_) {}

function isSundayKey(dayKey) {
  const [y, m, da] = String(dayKey).split('-').map(Number);
  const d = new Date(y, m - 1, da, 12, 0, 0);
  if (Number.isNaN(d.getTime())) return false;
  return d.getDay() === 0;
}

function isBankHolidayKey(dayKey) {
  return bankHolidaySet.has(String(dayKey).trim());
}

function isNonWorkingPlanDayKey(dayKey) {
  return isSundayKey(dayKey) || isBankHolidayKey(dayKey);
}

const MAX_CAL_DAYS = 12000;

function calendarDaysBetween(startStr, endStr) {
  const out = [];
  const s = String(startStr || '').trim();
  const e = String(endStr || '').trim();
  if (!s || !e) return out;
  const [ys, ms, ds] = s.split('-').map(Number);
  const [ye, me, de] = e.split('-').map(Number);
  const d = new Date(ys, ms - 1, ds, 12, 0, 0);
  const end = new Date(ye, me - 1, de, 12, 0, 0);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d > end) return out;
  let steps = 0;
  while (d <= end && steps < MAX_CAL_DAYS) {
    steps++;
    out.push(dateKeyFromDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Scheduleable day keys in [startStr, endStr] — excludes Sundays and England & Wales bank holidays. */
function scheduleDateKeysBetween(startStr, endStr) {
  return calendarDaysBetween(startStr, endStr).filter((k) => !isNonWorkingPlanDayKey(k));
}

function clampProgrammeItemToScheduleableRange(startStr, endStr) {
  const s0 = String(startStr || '').trim();
  const e0 = String(endStr || '').trim();
  const cal = calendarDaysBetween(s0, e0);
  const sched = cal.filter((k) => !isNonWorkingPlanDayKey(k));
  if (!sched.length) {
    const s = normalizeScheduleStartKey(s0);
    return { start_date: s, end_date: endOfScheduleableSpan(s, 1) };
  }
  const runs = [];
  let run = [sched[0]];
  for (let i = 1; i < sched.length; i++) {
    const prev = run[run.length - 1];
    const next = sched[i];
    const d = new Date(String(prev) + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    if (dateKeyFromDate(d) === next) run.push(next);
    else {
      runs.push(run);
      run = [next];
    }
  }
  runs.push(run);
  let best = runs[0];
  for (let j = 1; j < runs.length; j++) {
    if (runs[j].length > best.length) best = runs[j];
  }
  return { start_date: best[0], end_date: best[best.length - 1] };
}

function normalizeScheduleStartKey(dayKey) {
  const d = new Date(String(dayKey).trim() + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateKeyFromDate(new Date());
  while (isNonWorkingPlanDayKey(dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
  return dateKeyFromDate(d);
}

function endOfScheduleableSpan(startKey, durationDays) {
  const n = Math.max(0.5, Number(durationDays) || 1);
  let d = new Date(String(normalizeScheduleStartKey(startKey)) + 'T12:00:00');
  for (let i = 1; i < n; i++) {
    d.setDate(d.getDate() + 1);
    while (isNonWorkingPlanDayKey(dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
  }
  return dateKeyFromDate(d);
}

function nextScheduleableDayKey(dayKey) {
  let d = new Date(String(dayKey).trim() + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateKeyFromDate(new Date());
  d.setDate(d.getDate() + 1);
  while (isNonWorkingPlanDayKey(dateKeyFromDate(d))) d.setDate(d.getDate() + 1);
  return dateKeyFromDate(d);
}

function lastScheduleableDayOnOrBefore(dayKey) {
  let d = new Date(String(dayKey).trim() + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dayKey).trim();
  while (isNonWorkingPlanDayKey(dateKeyFromDate(d))) d.setDate(d.getDate() - 1);
  return dateKeyFromDate(d);
}

function prevScheduleableDayBefore(dayKey) {
  let d = new Date(String(dayKey).trim() + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(dayKey).trim();
  d.setDate(d.getDate() - 1);
  while (isNonWorkingPlanDayKey(dateKeyFromDate(d))) d.setDate(d.getDate() - 1);
  return dateKeyFromDate(d);
}

function startDateOfSpanEndingScheduleable(endKey, nDays) {
  const n = Math.max(0.5, Number(nDays) || 1);
  let curKey = lastScheduleableDayOnOrBefore(endKey);
  let hops = Math.max(0, Math.ceil(n) - 1);
  while (hops--) curKey = prevScheduleableDayBefore(curKey);
  return curKey;
}

/**
 * Programme schedule day keys between bounds (excludes Sundays and bank holidays).
 * Used for schedule table rows and must match client `scheduleDateKeysBetween`.
 */
function dateKeysBetween(startStr, endStr) {
  return scheduleDateKeysBetween(startStr, endStr);
}

module.exports = {
  dateKeysBetween,
  calendarDaysBetween,
  scheduleDateKeysBetween,
  isNonWorkingPlanDayKey,
  normalizeScheduleStartKey,
  endOfScheduleableSpan,
  nextScheduleableDayKey,
  lastScheduleableDayOnOrBefore,
  prevScheduleableDayBefore,
  startDateOfSpanEndingScheduleable,
  clampProgrammeItemToScheduleableRange,
  dateKeyFromDate,
};
