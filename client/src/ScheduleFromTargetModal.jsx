import React, { useMemo, useState, useEffect } from 'react';
import * as api from './api';
import { T, S } from './uiTheme';
import { formatShort, toHtmlDateInputValue } from './constants';
import { buildRowsFromTargetEndDate, parseYMD } from './programmeSchedule';

export default function ScheduleFromTargetModal({
  open,
  onClose,
  zoneId,
  zoneTitle,
  templateId,
  templateName,
  sequence,
  durations,
  activityIdByName,
  existingItems,
  onApplied,
}) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const dur = Array.isArray(durations) ? durations : [];

  const anchorOptions = useMemo(() => {
    return seq
      .map((name, idx) => ({
        name,
        idx,
        id: activityIdByName.get(name) ?? null,
      }))
      .filter((o) => o.id != null);
  }, [seq, activityIdByName]);

  const totalDays = useMemo(() => dur.reduce((a, b) => a + Math.max(0.5, Number(b) || 1), 0), [dur]);

  const [anchorActivityId, setAnchorActivityId] = useState('');
  const [anchorDate, setAnchorDate] = useState(() => toHtmlDateInputValue(new Date()));
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const first = anchorOptions[0];
    setAnchorActivityId(first ? String(first.id) : '');
    setAnchorDate(toHtmlDateInputValue(new Date()));
  }, [open, anchorOptions]);

  const anchorIdxInSeq = useMemo(() => {
    const want = Number(anchorActivityId);
    if (!want) return -1;
    const opt = anchorOptions.find((o) => Number(o.id) === want);
    return opt ? opt.idx : -1;
  }, [anchorActivityId, anchorOptions]);

  const previewRows = useMemo(() => {
    if (anchorIdxInSeq < 0 || !anchorDate) return [];
    return buildRowsFromTargetEndDate({
      sequence: seq,
      durations: dur,
      anchorIndex: anchorIdxInSeq,
      anchorEndDateKey: anchorDate,
      activityIdByName,
    });
  }, [anchorIdxInSeq, anchorDate, seq, dur, activityIdByName]);

  const missingActs = previewRows.filter((r) => !r.activity_id);

  async function apply() {
    if (!zoneId || !templateId || !anchorActivityId || !anchorDate) return;
    if (previewRows.length === 0 || missingActs.length) return;
    const items = Array.isArray(existingItems) ? existingItems : [];
    if (items.some((it) => it.status === 'done')) {
      if (
        !window.confirm(
          'This zone has completed programme rows. Applying will replace the entire programme for this zone. Continue?'
        )
      ) {
        return;
      }
    } else if (
      items.length > 0 &&
      !window.confirm('Replace all programme rows for this zone with the calculated schedule?')
    ) {
      return;
    }

    setApplying(true);
    try {
      const res = await api.scheduleZoneFromTarget(zoneId, {
        anchor_activity_id: Number(anchorActivityId),
        anchor_date: anchorDate,
        template_id: Number(templateId),
      });
      if (res && res.error) {
        window.alert(String(res.error));
        return;
      }
      if (onApplied) await onApplied();
      onClose();
    } catch (e) {
      window.alert(e?.message || 'Request failed');
    } finally {
      setApplying(false);
    }
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,46,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sft-title"
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: T.surface,
          borderRadius: 14,
          border: `1px solid ${T.hairline}`,
          padding: 18,
          boxShadow: '0 12px 40px rgba(26,26,46,0.15)',
        }}
      >
        <div id="sft-title" style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 12 }}>
          SCHEDULE FROM TARGET DATE
        </div>

        <div style={{ fontSize: 12, color: T.muted, marginBottom: 14, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 4 }}>Zone</div>
          <div>{zoneTitle || '—'}</div>
          <div style={{ marginTop: 10 }}>
            <span style={{ fontWeight: 700, color: T.text }}>Template</span>: {templateName || '—'}{' '}
            <span style={{ color: T.faint }}>({totalDays} working days total)</span>
          </div>
        </div>

        <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 6 }}>
          Select the activity you want to target
        </label>
        <select
          value={anchorActivityId}
          onChange={(e) => setAnchorActivityId(e.target.value)}
          style={{ ...S.input, fontSize: 12, marginBottom: 12, width: '100%' }}
        >
          {anchorOptions.map((o) => (
            <option key={o.idx} value={String(o.id)}>
              {o.name}
            </option>
          ))}
        </select>

        <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 6 }}>
          Target finish date (last working day of that stage)
        </label>
        <input
          type="date"
          value={toHtmlDateInputValue(anchorDate)}
          onChange={(e) => setAnchorDate(e.target.value)}
          style={{ ...S.input, fontSize: 12, marginBottom: 8, width: '100%' }}
        />
        <div style={{ fontSize: 10, color: T.faint, marginBottom: 14, lineHeight: 1.35 }}>
          Durations use working days only (weekends skipped), matching Generate programme.
        </div>

        <div style={{ borderTop: `1px solid ${T.hairline}`, paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 8 }}>CALCULATED PROGRAMME</div>
          {previewRows.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint }}>Pick an activity and date to preview.</div>
          )}
          {missingActs.length > 0 && (
            <div style={{ fontSize: 11, color: '#c0392b', marginBottom: 8 }}>
              Unknown activity IDs — fix template / activity list.
            </div>
          )}
          {previewRows.map((row) => {
            const endD = parseYMD(row.end_date);
            const isTarget = row.idx === anchorIdxInSeq;
            return (
              <div
                key={row.idx}
                style={{
                  fontSize: 12,
                  color: T.text,
                  padding: '4px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderBottom: `1px solid ${T.hairline}`,
                }}
              >
                <span style={{ fontWeight: isTarget ? 700 : 600 }}>{row.activity_name}</span>
                <span style={{ color: T.muted, whiteSpace: 'nowrap' }}>
                  → {formatShort(endD)}
                  {isTarget ? ' ✓ TARGET' : ''}
                </span>
              </div>
            );
          })}
        </div>

        {previewRows.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 14 }}>
            Required start date:{' '}
            <span style={{ color: 'rgba(66,133,244,0.95)' }}>
              {formatShort(parseYMD(previewRows[0].start_date))}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" disabled={applying} onClick={onClose} style={{ ...S.btn, padding: '10px 16px' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={
              applying ||
              previewRows.length === 0 ||
              missingActs.length > 0 ||
              !anchorActivityId ||
              !templateId
            }
            onClick={() => void apply()}
            style={{ ...S.btn, ...S.btnPrimary, padding: '10px 16px' }}
          >
            {applying ? 'Applying…' : 'Apply to zone'}
          </button>
        </div>
      </div>
    </div>
  );
}
