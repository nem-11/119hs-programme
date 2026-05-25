import React from 'react';
import { formatShort } from './constants';
import { parseYMD } from './programmeSchedule';
import {
  isNonWorkingPlanDayKey,
  normalizeScheduleStartKey,
  lastScheduleableDayOnOrBefore,
} from './planUtils';

/**
 * Display-only hint when a template anchor/start (or finish) date falls on a non-working day.
 */
export default function NonWorkingAnchorDateWarning({ dateKey, variant = 'start' }) {
  const dk = String(dateKey || '').trim();
  if (!dk || !isNonWorkingPlanDayKey(dk)) return null;

  const adjusted =
    variant === 'finish' ? lastScheduleableDayOnOrBefore(dk) : normalizeScheduleStartKey(dk);
  const formatted = formatShort(parseYMD(adjusted));
  const text =
    variant === 'finish'
      ? `This date is a non-working day — the programme will finish on ${formatted} instead.`
      : `This date is a non-working day — the programme will start from ${formatted} instead.`;

  return (
    <div style={{ fontSize: 10, color: '#b7791f', marginTop: 4, lineHeight: 1.35 }}>{text}</div>
  );
}
