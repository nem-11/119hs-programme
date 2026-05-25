import React, { useRef } from 'react';
import { actColor } from './constants';
import {
  countScheduleableDaysInclusive,
  normalizeScheduleStartKey,
  endOfScheduleableSpan,
  nextScheduleableDayKey,
} from './planUtils';

const LONG_PRESS_MS = 500;
const CLICK_DELAY_MS = 300;

export default function PlanActivityChip({
  it,
  z,
  dk,
  isAdmin,
  done,
  isMobile,
  coarsePointer,
  label,
  zoneLabel,
  setDragState,
  setInspect,
  onOpenEdit,
  applyZoneRows,
  hasDependency,
}) {
  const clickTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  function clearClickTimer() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openEditModal() {
    onOpenEdit({
      row: it,
      zoneId: z.zone_id,
      zoneItems: z.items,
      zoneLabel,
    });
  }

  async function runPromptEdit(action) {
    if (!action) return;
    const items = [...z.items]
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
      .map((x) => ({ ...x }));
    const idx = items.findIndex((x) => Number(x.id) === Number(it.id));
    if (idx < 0) return;
    const cmd = action.trim().toLowerCase();
    if (cmd === 'delete') {
      items.splice(idx, 1);
    } else if (cmd.startsWith('move ')) {
      const nk = normalizeScheduleStartKey(action.slice(5).trim());
      const dur = countScheduleableDaysInclusive(items[idx].start_date, items[idx].end_date);
      items[idx].start_date = nk;
      items[idx].end_date = endOfScheduleableSpan(nk, dur);
    } else if (cmd.startsWith('duration ')) {
      const d = Math.max(1, Number(action.slice(9).trim()) || 1);
      items[idx].end_date = endOfScheduleableSpan(items[idx].start_date, d);
    } else {
      window.alert('Unknown command. Use move YYYY-MM-DD, duration N, or delete.');
      return;
    }
    let from = Math.max(0, idx + (cmd === 'delete' ? 0 : 1));
    if (cmd === 'delete' && idx > 0) from = idx;
    let cursor = from === 0 ? items[0]?.start_date : nextScheduleableDayKey(items[from - 1].end_date);
    for (let i = from; i < items.length; i++) {
      const dur = countScheduleableDaysInclusive(items[i].start_date, items[i].end_date);
      items[i].start_date = normalizeScheduleStartKey(cursor);
      items[i].end_date = endOfScheduleableSpan(items[i].start_date, dur);
      cursor = nextScheduleableDayKey(items[i].end_date);
    }
    await applyZoneRows(z.zone_id, z.items, items);
  }

  return (
    <div
      title={coarsePointer ? undefined : it.activity_name}
      draggable={isAdmin && !done}
      onDragStart={() => setDragState({ zoneId: z.zone_id, zoneItems: z.items, item: it })}
      onDoubleClick={(e) => {
        if (done) return;
        e.preventDefault();
        clearClickTimer();
        onOpenEdit({
          row: it,
          zoneId: z.zone_id,
          zoneItems: z.items,
          zoneLabel,
        });
      }}
      onTouchStart={() => {
        if (done || !coarsePointer) return;
        longPressTriggeredRef.current = false;
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          openEditModal();
        }, LONG_PRESS_MS);
      }}
      onTouchEnd={clearLongPressTimer}
      onTouchMove={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      style={{
        background: actColor(it.activity_name, done ? 0.35 : 0.88),
        color: '#1a1a2e',
        fontWeight: 700,
        fontSize: isMobile ? 9 : 10,
        lineHeight: 1.15,
        padding: '4px 5px',
        borderRadius: 4,
        opacity: done ? 0.72 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        cursor: coarsePointer ? 'pointer' : isAdmin && !done ? 'grab' : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onClick={async (e) => {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          e.preventDefault();
          return;
        }
        if (coarsePointer) {
          e.preventDefault();
          setInspect({ row: it, zoneLabel });
          return;
        }
        if (!isAdmin || done) return;
        clearClickTimer();
        clickTimerRef.current = setTimeout(async () => {
          clickTimerRef.current = null;
          const action = window.prompt(
            `Edit ${it.activity_name}\nType:\n- move YYYY-MM-DD\n- duration N\n- delete`,
            ''
          );
          try {
            await runPromptEdit(action);
          } catch (err) {
            window.alert(err?.message || 'Edit failed');
          }
        }, CLICK_DELAY_MS);
      }}
    >
      {done && dk === String(it.start_date || '').trim() && (
        <span style={{ flexShrink: 0, fontSize: 11 }}>✓</span>
      )}
      {hasDependency && (
        <span
          title="Has dependencies"
          style={{ flexShrink: 0, fontSize: 9, lineHeight: 1, opacity: 0.85 }}
          aria-hidden
        >
          🔗
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{label}</span>
    </div>
  );
}
