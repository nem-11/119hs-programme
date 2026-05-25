import React, { useEffect, useState } from 'react';
import { T, S } from './uiTheme';
import { formatShort } from './constants';

function formatPlanDate(key) {
  const k = String(key || '').trim();
  if (!k) return '—';
  try {
    return formatShort(new Date(k + 'T12:00:00'));
  } catch (_) {
    return k;
  }
}

export default function ActivityChipEditModal({ open, onClose, row, zoneLabel, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setDeleting(false);
    setErr('');
    const onKey = (e) => {
      if (e.key === 'Escape' && !deleting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, deleting]);

  if (!open || !row) return null;

  async function handleDeleteClick() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setErr('');
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setErr(e?.message || 'Delete failed');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const sd = String(row.start_date || '').trim();
  const ed = String(row.end_date || '').trim();
  const btnBase = {
    ...S.btn,
    minHeight: 44,
    padding: '12px 16px',
    fontSize: 14,
    fontWeight: 700,
    width: '100%',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit activity"
      onClick={() => {
        if (!deleting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
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
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Activity
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.25, marginTop: 4 }}>{row.activity_name}</div>
          {zoneLabel && <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>{zoneLabel}</div>}
        </div>

        <dl style={{ margin: '0 0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
          <div>
            <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>Start</dt>
            <dd style={{ margin: '4px 0 0', color: T.text, fontWeight: 600 }}>{formatPlanDate(sd)}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 10, color: T.faint, fontWeight: 700, textTransform: 'uppercase' }}>End</dt>
            <dd style={{ margin: '4px 0 0', color: T.text, fontWeight: 600 }}>{formatPlanDate(ed)}</dd>
          </div>
        </dl>

        {err && (
          <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 12, lineHeight: 1.4 }}>{err}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDeleteClick}
            style={{
              ...btnBase,
              ...S.btnDanger,
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {confirmDelete ? 'Confirm delete' : 'Delete activity'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            style={btnBase}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
