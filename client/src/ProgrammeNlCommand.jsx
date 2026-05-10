import React, { useState } from 'react';
import * as api from './api';
import { T, S } from './uiTheme';
import { formatShort } from './constants';

function fmt(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const d = new Date(s + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return formatShort(d);
}

const TRY_HINTS = [
  'Move Tower 2 Pour 3 by 2 days',
  'Tower 3 Zone 1 start 18th May',
  'Podium Pour Tower 2 on 30 May',
  'Push all Tower 2 zones forward 1 week',
  'Shift the whole programme by 5 days',
];

export default function ProgrammeNlCommand({ onApplied }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [applyBusy, setApplyBusy] = useState(false);

  async function runParse() {
    const cmd = String(text || '').trim();
    if (!cmd) return;
    setBusy(true);
    setPreview(null);
    try {
      const res = await api.previewProgrammeCommand(cmd);
      setPreview(res && typeof res === 'object' ? res : { unknown: true, message: 'Invalid response' });
    } catch (e) {
      setPreview({ unknown: true, ok: false, message: e?.message || 'Request failed' });
    } finally {
      setBusy(false);
    }
  }

  async function confirmApply() {
    if (!preview || !preview.ok || preview.action?.action === 'unknown') return;
    const cmd = String(text || '').trim();
    setApplyBusy(true);
    try {
      const res = await api.applyProgrammeCommand(cmd, preview.action);
      if (res && res.error) {
        window.alert(String(res.error));
        return;
      }
      setPreview(null);
      setText('');
      if (onApplied) await onApplied();
    } catch (e) {
      window.alert(e?.message || 'Apply failed');
    } finally {
      setApplyBusy(false);
    }
  }

  function closeModal() {
    setPreview(null);
  }

  const showConfirm =
    preview?.ok === true && preview?.action?.action && preview.action.action !== 'unknown';
  const showUnknown = preview && !showConfirm;

  return (
    <>
      <div
        style={{
          flexShrink: 0,
          padding: '12px 14px',
          borderBottom: `1px solid ${T.hairline}`,
          background: 'linear-gradient(135deg,rgba(66,133,244,0.07),rgba(26,26,46,0.02))',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, color: T.text, marginBottom: 8, letterSpacing: '0.04em' }}>
          💬 PROGRAMME COMMAND
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && runParse()}
            placeholder='e.g. "Move Tower 2 Pour 3 by 2 days"'
            style={{
              ...S.input,
              flex: 1,
              minWidth: 200,
              fontSize: 13,
              padding: '10px 12px',
            }}
          />
          <button
            type="button"
            disabled={busy || !String(text).trim()}
            onClick={() => void runParse()}
            style={{ ...S.btn, ...S.btnAct, padding: '10px 20px', fontSize: 13, fontWeight: 700 }}
          >
            {busy ? '…' : 'RUN'}
          </button>
        </div>
      </div>

      {preview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26,26,46,0.35)',
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            style={{
              width: 'min(520px,100%)',
              maxHeight: '88vh',
              overflow: 'auto',
              background: T.surface,
              borderRadius: 14,
              border: `1px solid ${T.hairline}`,
              padding: 18,
              boxShadow: '0 12px 40px rgba(26,26,46,0.15)',
            }}
          >
            {showUnknown && (
              <>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 10 }}>
                  ⚠️ Could not interpret that command
                </div>
                <p style={{ fontSize: 13, color: T.muted, margin: '0 0 14px', lineHeight: 1.45 }}>
                  {preview.message || 'Try rephrasing, or check the server has ANTHROPIC_API_KEY set.'}
                </p>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, marginBottom: 8 }}>Try something like:</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.text, lineHeight: 1.6 }}>
                  {TRY_HINTS.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                <button type="button" onClick={closeModal} style={{ ...S.btn, marginTop: 16, width: '100%', padding: 12 }}>
                  Close
                </button>
              </>
            )}

            {showConfirm && (
              <>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 12 }}>
                  CONFIRM PROGRAMME CHANGE
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: T.text }}>Command:</span> "{preview.command}"
                </div>
                <div style={{ fontSize: 13, color: T.text, marginBottom: 14, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 700 }}>Action:</span> {preview.summary}
                </div>

                {preview.skipped_done_total > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'rgba(244,165,26,0.95)',
                      marginBottom: 12,
                      padding: 10,
                      borderRadius: 10,
                      background: 'rgba(244,165,26,0.12)',
                      border: '1px solid rgba(244,165,26,0.28)',
                    }}
                  >
                    {preview.skipped_done_total} activit{preview.skipped_done_total === 1 ? 'y is' : 'ies are'}{' '}
                    already marked complete and will not be moved.
                  </div>
                )}

                {(preview.affected_zones || []).map((z) => (
                  <div key={z.id} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>{z.label}</div>

                    {Array.isArray(z.preview_rows) && z.preview_rows.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, marginBottom: 4 }}>BEFORE → AFTER</div>
                        {z.preview_rows.map((r, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 11,
                              color: T.text,
                              padding: '4px 0',
                              borderBottom: `1px solid ${T.hairline}`,
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{r.activity_name}</span>
                            <span style={{ color: T.muted }}>
                              {fmt(r.start_before)} → {fmt(r.end_before)} → {fmt(r.start_after)} → {fmt(r.end_after)}
                            </span>
                          </div>
                        ))}
                        {z.truncated && (
                          <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>Showing first rows only…</div>
                        )}
                      </>
                    )}

                    {Array.isArray(z.before_rows) && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, marginBottom: 4 }}>Before</div>
                        {z.before_rows.map((r, i) => (
                          <div key={`b-${i}`} style={{ fontSize: 11, color: T.muted, padding: '2px 0' }}>
                            {r.activity_name}: {fmt(r.start_before)} → {fmt(r.end_before)}
                          </div>
                        ))}
                        <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, margin: '8px 0 4px' }}>After</div>
                        {(z.after_rows || []).map((r, i) => (
                          <div key={`a-${i}`} style={{ fontSize: 11, color: T.text, padding: '2px 0' }}>
                            {r.activity_name}: {fmt(r.start_after)} → {fmt(r.end_after)}
                            {r.is_target ? ' ✓ TARGET' : ''}
                          </div>
                        ))}
                        {(z.truncated_before || z.truncated_after) && (
                          <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>Truncated preview…</div>
                        )}
                      </>
                    )}

                    {(z.zone_finish_before || z.zone_finish_after) && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginTop: 8 }}>
                        Zone finish: {fmt(z.zone_finish_after)}
                        {z.zone_finish_before ? ` (was ${fmt(z.zone_finish_before)})` : ''}
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="button" onClick={closeModal} style={{ ...S.btn, flex: 1, padding: 12 }}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applyBusy}
                    onClick={() => void confirmApply()}
                    style={{ ...S.btn, ...S.btnAct, flex: 1, padding: 12, fontWeight: 700 }}
                  >
                    {applyBusy ? 'Saving…' : 'CONFIRM'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
