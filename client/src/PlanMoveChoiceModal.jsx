import React, { useEffect } from 'react';
import { formatShort } from './constants';
import { T, S } from './uiTheme';

function formatPlanDay(key) {
  const k = String(key || '').trim();
  if (!k) return '—';
  try {
    return formatShort(new Date(k + 'T12:00:00'));
  } catch (_) {
    return k;
  }
}

export default function PlanMoveChoiceModal({
  open,
  activityName,
  targetDay,
  targetShift,
  busy,
  onSingle,
  onProgramme,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const shiftLabel = targetShift === 'night' ? 'Night' : 'Day';
  const targetLabel = `${formatPlanDay(targetDay)} (${shiftLabel})`;

  const btnBase = {
    ...S.btn,
    minHeight: 48,
    padding: '12px 14px',
    fontSize: 14,
    fontWeight: 700,
    width: '100%',
    textAlign: 'left',
    lineHeight: 1.35,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose move type"
      onClick={() => {
        if (!busy) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2150,
        background: 'rgba(26,26,46,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          background: T.surface,
          borderRadius: 16,
          border: `1px solid ${T.hairline}`,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
          padding: 16,
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>
          How should this move work?
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: T.muted, lineHeight: 1.45 }}>
          Moving <strong style={{ color: T.text }}>{activityName}</strong> to{' '}
          <strong style={{ color: T.text }}>{targetLabel}</strong>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSingle()}
            style={{ ...btnBase, ...S.btnPrimary }}
          >
            <div>This day / item only</div>
            <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.88, marginTop: 4 }}>
              Move just what you picked up. Other activities in the zone stay put.
            </div>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onProgramme()}
            style={btnBase}
          >
            <div>Shift programme</div>
            <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.72, marginTop: 4 }}>
              Move the whole activity and pull following rows in this zone to keep the template sequence.
            </div>
          </button>
          <button type="button" disabled={busy} onClick={onCancel} style={{ ...btnBase, marginTop: 4 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
