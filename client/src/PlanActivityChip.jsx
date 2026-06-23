import React, { useRef } from 'react';
import { actColor } from './constants';

const LONG_PRESS_MS = 500;

export default function PlanActivityChip({
  it,
  z,
  dk,
  shiftKey = 'day',
  isAdmin,
  done,
  completionAt,
  isMobile,
  coarsePointer,
  label,
  zoneLabel,
  compact = false,
  isDragging = false,
  setDragState,
  setInspect,
  onOpenEdit,
  hasDependency,
}) {
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDragRef = useRef(null);
  const DRAG_THRESHOLD_PX = 8;

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

  return (
    <div
      className={compact ? 'plan-activity-chip plan-activity-chip--compact' : undefined}
      title={coarsePointer || compact ? it.activity_name : undefined}
      onDoubleClick={(e) => {
        if (compact || !isAdmin) return;
        e.preventDefault();
        e.stopPropagation();
        openEditModal();
      }}
      onPointerDown={(e) => {
        if (!isAdmin || done || compact || e.button !== 0) return;
        pointerDragRef.current = { startX: e.clientX, startY: e.clientY, active: false };
      }}
      onPointerMove={(e) => {
        const p = pointerDragRef.current;
        if (!p || p.active) return;
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        p.active = true;
        setDragState({
          zoneId: z.zone_id,
          zoneItems: z.items,
          item: it,
          sourceDay: dk,
          sourceShift: shiftKey,
        });
      }}
      onPointerUp={() => {
        pointerDragRef.current = null;
      }}
      onPointerCancel={() => {
        pointerDragRef.current = null;
      }}
      onTouchStart={() => {
        if (!coarsePointer || !isAdmin || compact) return;
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
        opacity: isDragging ? 0.35 : done ? 0.72 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 0 : 4,
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        cursor: compact ? 'default' : coarsePointer ? 'pointer' : isAdmin ? (done ? 'pointer' : 'grab') : 'default',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onClick={(e) => {
        if (compact) return;
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          e.preventDefault();
          return;
        }
        if (coarsePointer) {
          e.preventDefault();
          setInspect({ row: it, zoneLabel });
        }
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
