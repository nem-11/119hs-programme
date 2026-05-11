import React, { useEffect } from 'react';
import { T, S } from './uiTheme';
import { calendarDaysBetween } from './planUtils';

export default function ActivityInspectModal({ open, onClose, row, zoneLabel }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const sd = String(row.start_date || '').trim();
  const ed = String(row.end_date || '').trim();
  let calDays = 0;
  try {
    calDays = calendarDaysBetween(sd, ed).length;
  } catch (_) {}

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Activity details"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
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
          maxHeight: '85vh',
          overflow: 'auto',
          background: T.surface,
          borderRadius: 16,
          border: `1px solid ${T.hairline}`,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
          padding: 16,
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Activity
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, lineHeight: 1.25, marginTop: 4 }}>{row.activity_name}</div>
            {zoneLabel && (
              <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>{zoneLabel}</div>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ ...S.btn, padding: '6px 12px', fontSize: 12, flexShrink: 0 }}>
            Close
          </button>
        </div>
        <dl style={{ margin: 0, display: 'grid', gap: 10, fontSize: 13 }}>
          <div>
            <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>Start</dt>
            <dd style={{ margin: '4px 0 0', color: T.text, fontWeight: 600 }}>{sd || '—'}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>End</dt>
            <dd style={{ margin: '4px 0 0', color: T.text, fontWeight: 600 }}>{ed || '—'}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>Duration</dt>
            <dd style={{ margin: '4px 0 0', color: T.text, fontWeight: 600 }}>
              {calDays > 0 ? `${calDays} calendar day${calDays === 1 ? '' : 's'}` : '—'}
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>Status</dt>
            <dd style={{ margin: '4px 0 0', color: T.text, fontWeight: 600 }}>{row.status || 'planned'}</dd>
          </div>
          {row.notes ? (
            <div>
              <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>Notes</dt>
              <dd style={{ margin: '4px 0 0', color: T.muted, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{row.notes}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
