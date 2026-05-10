import { dateKey } from './constants';

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
