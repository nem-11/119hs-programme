import React, { useEffect, useMemo, useState } from 'react';
import { T, S } from './uiTheme';
import { drawingTabLabel, toHtmlDateInputValue } from './constants';

const CUSTOM_VALUE = '__custom__';

const fieldLabel = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  color: T.faint,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 6,
};

const fieldInput = {
  ...S.input,
  width: '100%',
  fontSize: 14,
  padding: '10px 12px',
  minHeight: 44,
  boxSizing: 'border-box',
};

const btnBase = {
  ...S.btn,
  minHeight: 44,
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 700,
  width: '100%',
};

export default function PlanAddActivityModal({
  open,
  onClose,
  zoneLabel,
  scopeOptions,
  defaultScopeTab,
  activities,
  zoneItems,
  defaultStartDate,
  onConfirm,
}) {
  const [scopeTab, setScopeTab] = useState('');
  const [activityKey, setActivityKey] = useState('');
  const [customName, setCustomName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [duration, setDuration] = useState('1');
  const [insertAfter, setInsertAfter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const scopeLabel = scopeTab ? drawingTabLabel(scopeTab) : '';

  const catalogueActivities = useMemo(
    () => (activities || []).filter((a) => String(a.type || '') === String(scopeTab || '')),
    [activities, scopeTab]
  );

  const insertOptions = useMemo(() => {
    const sorted = [...(zoneItems || [])].sort((a, b) =>
      String(a.start_date).localeCompare(String(b.start_date))
    );
    return sorted.map((it) => ({
      value: String(it.activity_name || ''),
      label: String(it.activity_name || ''),
    }));
  }, [zoneItems]);

  useEffect(() => {
    if (!open) return;
    const scope = defaultScopeTab || scopeOptions?.[0] || 'groundworks';
    setScopeTab(scope);
    setCustomName('');
    setStartDate(defaultStartDate || '');
    setDuration('1');
    setInsertAfter('');
    setSubmitting(false);
    setErr('');
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, defaultStartDate, defaultScopeTab, onClose, submitting, scopeOptions]);

  useEffect(() => {
    if (!open) return;
    setActivityKey(catalogueActivities[0] ? String(catalogueActivities[0].id) : CUSTOM_VALUE);
  }, [open, scopeTab, catalogueActivities]);

  if (!open) return null;

  const isCustom = activityKey === CUSTOM_VALUE;
  const activityValid = isCustom ? Boolean(customName.trim()) : Boolean(activityKey);

  async function handleConfirm(e) {
    e.preventDefault();
    if (!activityValid || !startDate.trim() || !scopeTab) return;
    setSubmitting(true);
    setErr('');
    try {
      await onConfirm({
        activityKey,
        customName: customName.trim(),
        startDate: startDate.trim(),
        duration: Math.max(1, Number(duration) || 1),
        insertAfter: insertAfter.trim(),
        scopeTab,
      });
      onClose();
    } catch (ex) {
      setErr(ex?.message || 'Add failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add activity"
      onClick={() => {
        if (!submitting) onClose();
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
      <form
        onSubmit={handleConfirm}
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
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>
          Add activity to {zoneLabel}
        </h3>

        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel} htmlFor="plan-add-scope">
            Programme scope <span style={{ color: '#c0392b' }}>*</span>
          </label>
          {scopeOptions?.length > 1 ? (
            <select
              id="plan-add-scope"
              required
              value={scopeTab}
              onChange={(e) => setScopeTab(e.target.value)}
              style={fieldInput}
            >
              {scopeOptions.map((t) => (
                <option key={t} value={t}>
                  {drawingTabLabel(t)}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ ...fieldInput, display: 'flex', alignItems: 'center', background: 'rgba(26,26,46,0.03)' }}>
              {scopeLabel || '—'}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel} htmlFor="plan-add-activity">
            Activity <span style={{ color: '#c0392b' }}>*</span>
          </label>
          <select
            id="plan-add-activity"
            required={!isCustom}
            value={activityKey}
            onChange={(e) => setActivityKey(e.target.value)}
            style={fieldInput}
          >
            {catalogueActivities.length === 0 && (
              <option value="" disabled>
                No activities in this scope — use Custom…
              </option>
            )}
            {catalogueActivities.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
            <option value={CUSTOM_VALUE}>Custom…</option>
          </select>
          {isCustom && (
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={scopeLabel ? `New or existing ${scopeLabel} activity name` : 'Activity name'}
              required
              style={{ ...fieldInput, marginTop: 8 }}
            />
          )}
          {isCustom && (
            <p style={{ fontSize: 11, color: T.muted, margin: '8px 0 0', lineHeight: 1.4 }}>
              Custom names are added to the {scopeLabel || 'selected'} catalogue if they do not exist yet.
            </p>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel} htmlFor="plan-add-start">
            Start date <span style={{ color: '#c0392b' }}>*</span>
          </label>
          <input
            id="plan-add-start"
            type="date"
            required
            value={toHtmlDateInputValue(startDate)}
            onChange={(e) => setStartDate(e.target.value)}
            style={fieldInput}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel} htmlFor="plan-add-duration">
            Working days <span style={{ color: '#c0392b' }}>*</span>
          </label>
          <input
            id="plan-add-duration"
            type="number"
            min={1}
            step={1}
            required
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            style={fieldInput}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={fieldLabel} htmlFor="plan-add-after">
            Insert after (reference only)
          </label>
          <select
            id="plan-add-after"
            value={insertAfter}
            onChange={(e) => setInsertAfter(e.target.value)}
            style={fieldInput}
          >
            <option value="">At end</option>
            {insertOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 11, color: T.muted, margin: '8px 0 0', lineHeight: 1.4 }}>
            Other activities in the zone are not moved — dates above are used as-is.
          </p>
        </div>

        {err && (
          <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 12, lineHeight: 1.4 }}>{err}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="submit"
            disabled={submitting || !activityValid || !startDate.trim() || !scopeTab}
            style={{
              ...btnBase,
              ...S.btnPrimary,
              opacity: submitting || !activityValid || !startDate.trim() || !scopeTab ? 0.55 : 1,
            }}
          >
            {submitting ? 'Adding…' : 'Add activity'}
          </button>
          <button type="button" disabled={submitting} onClick={onClose} style={btnBase}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
