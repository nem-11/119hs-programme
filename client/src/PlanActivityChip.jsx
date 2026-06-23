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
  completionAt,
  isMobile,
  coarsePointer,
  label,
  zoneLabel,
  compact = false,
  setDragState,
  setInspect,
  onOpenEdit,
  applyZoneRows,
  hasDependency,
  onShiftToggle,
}) {
  const clickTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const draggedRef = useRef(false);

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
      dayKey: dk,
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
      await applyZoneRows(z.zone_id, z.items, items);
      return;
    } else if (cmd.startsWith('duration ')) {
      const d = Math.max(1, Number(action.slice(9).trim()) || 1);
      items[idx].end_date = endOfScheduleableSpan(items[idx].start_date, d);
      await applyZoneRows(z.zone_id, z.items, items);
      return;
    } else {
      window.alert('Unknown command. Use move YYYY-MM-DD, duration N, or delete.');
      return;
    }
    let from = Math.max(0, idx);
    if (idx > 0) from = idx;
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
      className={compact ? 'plan-activity-chip plan-activity-chip--compact' : undefined}
      title={coarsePointer || compact ? it.activity_name : undefined}
      draggable={isAdmin && !done && !compact}
      onDragStart={() => {
        draggedRef.current = true;
        setDragState({ zoneId: z.zone_id, zoneItems: z.items, item: it });
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 100);
      }}
      onDoubleClick={(e) => {
        if (compact) return;
        e.preventDefault();
        clearClickTimer();
        onOpenEdit({
          row: it,
          zoneId: z.zone_id,
          zoneItems: z.items,
          zoneLabel,
          dayKey: dk,
        });
      }}
      onTouchStart={() => {
        if (!coarsePointer) return;
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
        fontSize: compact ? undefined : isMobile ? 9 : 10,
        lineHeight: compact ? 1 : 1.15,
        padding: compact ? undefined : '4px 5px',
        borderRadius: compact ? 2 : 4,
        opacity: done ? 0.72 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 0 : 4,
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        cursor: compact ? 'default' : coarsePointer ? 'pointer' : isAdmin ? (done ? 'pointer' : 'grab') : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onClick={async (e) => {
        if (compact) return;
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          e.preventDefault();
          return;
        }
        if (onShiftToggle && isAdmin) {
          if (draggedRef.current) return;
          e.preventDefault();
          clearClickTimer();
          try {
            await onShiftToggle(it);
          } catch (err) {
            window.alert(err?.message || 'Shift update failed');
          }
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
      {compact ? (
        <span className="plan-activity-chip__abbrev">{label}</span>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {done && (
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
        {done && completionAt && (
          <span style={{ fontSize: 8, opacity: 0.72, lineHeight: 1.2, marginTop: 1 }}>
            {completionAt}
          </span>
        )}
      </div>
      )}
    </div>
  );
}
