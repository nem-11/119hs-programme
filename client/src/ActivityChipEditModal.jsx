import React, { useEffect, useMemo, useState } from 'react';
import * as api from './api';
import { T, S } from './uiTheme';
import { formatShort } from './constants';
import { completionKeyFromProgrammeRow, isProgrammeRowDone } from './planUtils';

function formatPlanDate(key) {
  const k = String(key || '').trim();
  if (!k) return '—';
  try {
    return formatShort(new Date(k + 'T12:00:00'));
  } catch (_) {
    return k;
  }
}

function DependencyPicker({ label, options, onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options || [];
    if (!q) return list.slice(0, 40);
    return list.filter((o) => String(o.label || '').toLowerCase().includes(q)).slice(0, 40);
  }, [options, query]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...S.btn,
          minHeight: 40,
          padding: '8px 12px',
          fontSize: 13,
          fontWeight: 600,
          width: '100%',
          textAlign: 'left',
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {label}
      </button>
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 20,
            background: T.surface,
            border: `1px solid ${T.hairline}`,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 8,
            maxHeight: 220,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            autoFocus
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${T.hairline}`,
              fontSize: 13,
            }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ fontSize: 12, color: T.muted, padding: '8px 4px' }}>No matches</div>
            )}
            {filtered.map((opt) => (
              <button
                key={`${opt.type}:${opt.id}`}
                type="button"
                onClick={() => {
                  onSelect(opt);
                  setOpen(false);
                  setQuery('');
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 6px',
                  border: 'none',
                  background: 'transparent',
                  fontSize: 12,
                  color: T.text,
                  cursor: 'pointer',
                  borderRadius: 6,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DependencyList({ title, items, onRemove, canEdit, emptyLabel }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: T.faint,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: T.muted }}>{emptyLabel}</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((dep) => (
            <li
              key={dep.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: T.text,
                lineHeight: 1.35,
              }}
            >
              <span style={{ flex: 1 }}>{dep.label}</span>
              {canEdit && onRemove && (
                <button
                  type="button"
                  aria-label="Remove dependency"
                  onClick={() => onRemove(dep)}
                  style={{
                    ...S.btn,
                    minWidth: 32,
                    minHeight: 32,
                    padding: 0,
                    fontSize: 16,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ActivityChipEditModal({
  open,
  onClose,
  row,
  zoneLabel,
  completionDayKey,
  comp,
  canTick,
  userName,
  onDelete,
  isAdmin,
  pickerOptions,
  onDependenciesChange,
  onCompletionChange,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [deps, setDeps] = useState([]);
  const [depsLoading, setDepsLoading] = useState(false);
  const [depBusy, setDepBusy] = useState(false);
  const [compBusy, setCompBusy] = useState(false);

  const itemId = row ? Number(row.id) : null;
  const isComplete = isProgrammeRowDone(row, comp);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setDeleting(false);
    setErr('');
    const onKey = (e) => {
      if (e.key === 'Escape' && !deleting && !depBusy && !compBusy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, deleting, depBusy, compBusy]);

  useEffect(() => {
    if (!open || !itemId) {
      setDeps([]);
      return;
    }
    let cancelled = false;
    setDepsLoading(true);
    api.getDependencies('programme_item', itemId).then((data) => {
      if (cancelled) return;
      setDeps(Array.isArray(data) ? data : []);
      setDepsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, itemId]);

  const predecessors = useMemo(
    () =>
      deps
        .filter((d) => d.successor_type === 'programme_item' && Number(d.successor_id) === itemId)
        .map((d) => ({
          id: d.id,
          label: d.predecessor_name || `${d.predecessor_type} #${d.predecessor_id}`,
          dep: d,
        })),
    [deps, itemId]
  );

  const successors = useMemo(
    () =>
      deps
        .filter((d) => d.predecessor_type === 'programme_item' && Number(d.predecessor_id) === itemId)
        .map((d) => ({
          id: d.id,
          label: d.successor_name || `${d.successor_type} #${d.successor_id}`,
          dep: d,
        })),
    [deps, itemId]
  );

  const linkedKeys = useMemo(() => {
    const s = new Set();
    for (const d of deps) {
      s.add(`${d.predecessor_type}:${d.predecessor_id}`);
      s.add(`${d.successor_type}:${d.successor_id}`);
    }
    return s;
  }, [deps]);

  const addableOptions = useMemo(() => {
    const selfKey = `programme_item:${itemId}`;
    return (pickerOptions || []).filter((opt) => {
      const key = `${opt.type}:${opt.id}`;
      if (key === selfKey) return false;
      return !linkedKeys.has(key);
    });
  }, [pickerOptions, itemId, linkedKeys]);

  async function reloadDeps() {
    if (!itemId) return;
    const data = await api.getDependencies('programme_item', itemId);
    setDeps(Array.isArray(data) ? data : []);
    if (onDependenciesChange) await onDependenciesChange();
  }

  async function addPredecessor(opt) {
    setDepBusy(true);
    setErr('');
    try {
      const out = await api.createDependency({
        predecessor_type: opt.type,
        predecessor_id: opt.id,
        successor_type: 'programme_item',
        successor_id: itemId,
      });
      if (out?.error) throw new Error(out.error);
      await reloadDeps();
    } catch (e) {
      setErr(e?.message || 'Could not add predecessor');
    } finally {
      setDepBusy(false);
    }
  }

  async function addSuccessor(opt) {
    setDepBusy(true);
    setErr('');
    try {
      const out = await api.createDependency({
        predecessor_type: 'programme_item',
        predecessor_id: itemId,
        successor_type: opt.type,
        successor_id: opt.id,
      });
      if (out?.error) throw new Error(out.error);
      await reloadDeps();
    } catch (e) {
      setErr(e?.message || 'Could not add successor');
    } finally {
      setDepBusy(false);
    }
  }

  async function removeDependency(dep) {
    setDepBusy(true);
    setErr('');
    try {
      const out = await api.deleteDependency(dep.id);
      if (out?.error) throw new Error(out.error);
      await reloadDeps();
    } catch (e) {
      setErr(e?.message || 'Could not remove dependency');
    } finally {
      setDepBusy(false);
    }
  }

  async function toggleComplete() {
    const ck = completionKeyFromProgrammeRow(row);
    const dk = String(completionDayKey || '').trim();
    if (!ck || !canTick) return;
    setCompBusy(true);
    setErr('');
    try {
      if (isComplete) {
        // Activity-level untick: clear every day that carries a tick for this activity.
        const days = comp && typeof comp === 'object'
          ? Object.keys(comp).filter((d) => comp[d] && comp[d][ck])
          : [];
        if (days.length) {
          for (const d of days) {
            await api.toggleCompletion(d, ck, userName || '');
          }
        } else if (dk) {
          await api.toggleCompletion(dk, ck, userName || '');
        }
      } else {
        if (!dk) return;
        await api.toggleCompletion(dk, ck, userName || '');
      }
      if (onCompletionChange) await onCompletionChange();
    } catch (e) {
      setErr(e?.message || 'Could not update completion');
    } finally {
      setCompBusy(false);
    }
  }

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
        if (!deleting && !depBusy && !compBusy) onClose();
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
          maxHeight: 'min(90vh, 720px)',
          overflowY: 'auto',
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

        {canTick && completionDayKey && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${T.hairline}`,
              background: isComplete ? 'rgba(46,178,96,0.08)' : 'rgba(26,26,46,0.03)',
              cursor: compBusy ? 'wait' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
              color: T.text,
            }}
          >
            <input
              type="checkbox"
              checked={isComplete}
              disabled={compBusy || depBusy || deleting}
              onChange={() => void toggleComplete()}
              style={{ width: 18, height: 18, flexShrink: 0 }}
            />
            Mark as complete
          </label>
        )}

        <div
          style={{
            marginBottom: 16,
            paddingTop: 14,
            borderTop: `1px solid ${T.hairline}`,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 10 }}>Dependencies</div>
          {depsLoading ? (
            <div style={{ fontSize: 12, color: T.muted }}>Loading…</div>
          ) : (
            <>
              <DependencyList
                title="Predecessors"
                items={predecessors}
                canEdit={isAdmin}
                emptyLabel="No predecessors"
                onRemove={(item) => removeDependency(item.dep)}
              />
              {isAdmin && (
                <div style={{ marginBottom: 12 }}>
                  <DependencyPicker
                    label="Add predecessor"
                    options={addableOptions}
                    disabled={depBusy}
                    onSelect={addPredecessor}
                  />
                </div>
              )}
              <DependencyList
                title="Successors"
                items={successors}
                canEdit={isAdmin}
                emptyLabel="No successors"
                onRemove={(item) => removeDependency(item.dep)}
              />
              {isAdmin && (
                <DependencyPicker
                  label="Add successor"
                  options={addableOptions}
                  disabled={depBusy}
                  onSelect={addSuccessor}
                />
              )}
            </>
          )}
        </div>

        {err && (
          <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 12, lineHeight: 1.4 }}>{err}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isAdmin && (
            <button
              type="button"
              disabled={deleting || depBusy || compBusy}
              onClick={handleDeleteClick}
              style={{
                ...btnBase,
                ...S.btnDanger,
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete activity'}
            </button>
          )}
          <button
            type="button"
            disabled={deleting || depBusy || compBusy}
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
