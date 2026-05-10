import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as api from './api';
import { actColor, dateKey, formatShort, toHtmlDateInputValue, drawingTabLabel } from './constants';
import { T, S } from './uiTheme';
import { calendarDaysBetween, zoneRowLabel, abbrevActivity } from './planUtils';

function parseKey(k) {
  const [y, m, d] = String(k || '')
    .trim()
    .split('-')
    .map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function addDaysKey(key, delta) {
  const d = parseKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + delta);
  return dateKey(d);
}

function dayOrd(key) {
  const d = parseKey(key);
  return d ? Math.floor(d.getTime() / 86400000) : 0;
}

/** Bar segment visible inside [winStart, winEnd], inclusive calendar days. */
function barGeometry(winStart, winEnd, itemStart, itemEnd) {
  const ws = dayOrd(winStart);
  const we = dayOrd(winEnd);
  const is = dayOrd(itemStart);
  const ie = dayOrd(itemEnd);
  if (ie < ws || is > we) return null;
  const a = Math.max(is, ws);
  const b = Math.min(ie, we);
  const span = we - ws + 1;
  if (span <= 0) return null;
  return { leftPct: ((a - ws) / span) * 100, widthPct: ((b - a + 1) / span) * 100 };
}

function todayMarkerPct(winStart, winEnd) {
  const tk = dateKey(new Date());
  const g = barGeometry(winStart, winEnd, tk, tk);
  if (!g) return null;
  return g.leftPct + g.widthPct / 2;
}

export default function GanttPage({ tab, userTabs, isAdmin }) {
  const [rows, setRows] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [preset, setPreset] = useState('fit');
  const [startDate, setStartDate] = useState(() => dateKey(new Date()));
  const [endDate, setEndDate] = useState(() => addDaysKey(dateKey(new Date()), 56));
  const [towerWhitelist, setTowerWhitelist] = useState(null);
  /** Multiple drawing tabs can be selected for one combined Gantt (print / site review). */
  const [selectedTabs, setSelectedTabs] = useState(() => [tab]);

  const permittedTabs = useMemo(() => {
    const base = userTabs?.length ? userTabs : ['groundworks', 'internals'];
    if (!isAdmin) return base;
    const s = new Set(base);
    for (const r of rows) {
      if (r.drawing_tab) s.add(String(r.drawing_tab));
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [isAdmin, userTabs, rows]);

  /** When the header scope changes, match Gantt to that tab only (avoid stale multi-select). */
  useEffect(() => {
    setSelectedTabs([tab]);
  }, [tab]);

  useEffect(() => {
    if (!permittedTabs.length) return;
    setSelectedTabs((prev) => {
      const kept = prev.filter((t) => permittedTabs.includes(t));
      if (kept.length) return kept;
      return [permittedTabs[0]];
    });
  }, [permittedTabs]);

  const selectedSet = useMemo(() => new Set(selectedTabs), [selectedTabs]);

  function toggleProgrammeTab(t) {
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
        if (next.size === 0) return [t];
      } else {
        next.add(t);
      }
      return permittedTabs.filter((x) => next.has(x));
    });
  }

  function selectAllProgrammeTabs() {
    setSelectedTabs([...permittedTabs]);
  }

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      let data;
      if (isAdmin) {
        data = await api.getPlanProgrammeFullExport();
        if (!Array.isArray(data)) data = await api.getPlanProgramme();
      } else {
        data = await api.getPlanProgramme();
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load programme');
      setRows([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  /** Programme tab selection only — tower chips stay visible when towers are filtered off. */
  const rowsForProgrammePick = useMemo(() => {
    return rows.filter((r) => {
      if (!permittedTabs.includes(r.drawing_tab)) return false;
      if (!selectedSet.has(r.drawing_tab)) return false;
      return parseKey(r.start_date) && parseKey(r.end_date);
    });
  }, [rows, permittedTabs, selectedSet]);

  const filteredRows = useMemo(() => {
    return rowsForProgrammePick.filter((r) => {
      if (towerWhitelist !== null) {
        const tw = String(r.tower || '').trim();
        if (!towerWhitelist.has(tw)) return false;
      }
      return true;
    });
  }, [rowsForProgrammePick, towerWhitelist]);

  const towersInView = useMemo(() => {
    const s = new Set();
    rowsForProgrammePick.forEach((r) => {
      const tw = String(r.tower || '').trim();
      if (tw) s.add(tw);
    });
    return [...s].sort();
  }, [rowsForProgrammePick]);

  useEffect(() => {
    const valid = new Set(towersInView);
    setTowerWhitelist((prev) => {
      if (prev === null) return null;
      const next = new Set([...prev].filter((t) => valid.has(t)));
      if (next.size === 0) return null;
      if (next.size === valid.size) return null;
      return next;
    });
  }, [towersInView]);

  const bounds = useMemo(() => {
    if (!filteredRows.length) return null;
    let minS = filteredRows[0].start_date;
    let maxE = filteredRows[0].end_date;
    for (const r of filteredRows) {
      if (String(r.start_date) < String(minS)) minS = r.start_date;
      if (String(r.end_date) > String(maxE)) maxE = r.end_date;
    }
    return { minS, maxE };
  }, [filteredRows]);

  useEffect(() => {
    if (preset !== 'fit' || !bounds) return;
    setStartDate(addDaysKey(bounds.minS, -7));
    setEndDate(addDaysKey(bounds.maxE, 7));
  }, [preset, bounds]);

  const zoneRows = useMemo(() => {
    const byZone = new Map();
    for (const r of filteredRows) {
      const zid = Number(r.zone_id);
      if (!byZone.has(zid)) {
        byZone.set(zid, {
          zone_id: zid,
          tower: r.tower,
          zone_name: r.zone_name,
          items: [],
        });
      }
      byZone.get(zid).items.push(r);
    }
    const out = [...byZone.values()];
    out.forEach((z) => {
      z.items.sort((a, b) => {
        const sd = String(a.start_date).localeCompare(String(b.start_date));
        if (sd !== 0) return sd;
        const ed = String(a.end_date).localeCompare(String(b.end_date));
        if (ed !== 0) return ed;
        return String(a.activity_name || '').localeCompare(String(b.activity_name || ''));
      });
    });
    out.sort((a, b) => {
      const tw = String(a.tower || '').localeCompare(String(b.tower || ''), undefined, { numeric: true });
      if (tw !== 0) return tw;
      return String(a.zone_name || '').localeCompare(String(b.zone_name || ''), undefined, { numeric: true });
    });
    return out;
  }, [filteredRows]);

  const dayTicks = useMemo(() => calendarDaysBetween(startDate, endDate), [startDate, endDate]);

  function applyPreset(p) {
    setPreset(p);
    const t0 = new Date();
    t0.setHours(12, 0, 0, 0);
    const k0 = dateKey(t0);
    if (p === 'fit') {
      /* window set by effect from bounds */
      return;
    }
    if (p === 'custom') return;
    const days = parseInt(p, 10);
    if (!Number.isFinite(days) || days < 1) return;
    setStartDate(k0);
    setEndDate(addDaysKey(k0, days - 1));
  }

  function toggleTower(tw) {
    setTowerWhitelist((prev) => {
      const full = new Set(towersInView);
      const cur = prev === null ? full : new Set(prev);
      if (cur.has(tw)) cur.delete(tw);
      else cur.add(tw);
      if (cur.size === full.size) return null;
      return cur;
    });
  }

  function selectAllTowers() {
    setTowerWhitelist(null);
  }

  const todayPct = todayMarkerPct(startDate, endDate);
  const timelineMinWidth = Math.max(480, dayTicks.length * 6);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
      <div style={{ flexShrink: 0, padding: '12px 14px', borderBottom: `1px solid ${T.hairline}`, background: T.surface }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: T.text }}>Gantt</h2>
            <p style={{ margin: 0, fontSize: 11, color: T.faint, lineHeight: 1.45 }}>
              One line per zone.
              {selectedTabs.length > 1 ? (
                <>
                  {' '}
                  Showing <strong style={{ color: T.muted, fontWeight: 600 }}>{selectedTabs.map((x) => drawingTabLabel(x)).join(' · ')}</strong>{' '}
                  together — use Print for one sheet.
                </>
              ) : (
                <> Scope: {drawingTabLabel(selectedTabs[0])}.</>
              )}
              {isAdmin ? ' Admins see every drawing tab that has programme rows.' : ''}
            </p>
          </div>
          <button type="button" onClick={() => load()} style={{ ...S.btn, ...S.btnAct, padding: '8px 14px', fontSize: 12 }}>
            Refresh
          </button>
        </div>
        {loadErr && (
          <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 8 }}>{loadErr}</div>
        )}
        {permittedTabs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: 'uppercase' }}>Programme</span>
            <span style={{ fontSize: 10, color: T.muted }}>Tick any combination:</span>
            {permittedTabs.length > 1 && (
              <button
                type="button"
                onClick={selectAllProgrammeTabs}
                style={{ ...S.btn, padding: '5px 10px', fontSize: 10 }}
              >
                All tabs
              </button>
            )}
            {permittedTabs.map((t) => {
              const on = selectedSet.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleProgrammeTab(t)}
                  title={on ? 'Click to hide from this Gantt' : 'Click to include on this Gantt'}
                  style={{
                    ...S.btn,
                    ...(on ? S.btnAct : {}),
                    padding: '6px 12px',
                    fontSize: 11,
                    opacity: on ? 1 : 0.55,
                    boxShadow: on ? undefined : 'inset 0 0 0 1px rgba(26,26,46,0.08)',
                  }}
                >
                  <span style={{ marginRight: 6, opacity: 0.85 }} aria-hidden>
                    {on ? '✓' : '○'}
                  </span>
                  {drawingTabLabel(t)}
                </button>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: 'uppercase' }}>Range</span>
          {[
            { id: 'fit', label: 'Fit all' },
            { id: '28', label: '4 wk' },
            { id: '56', label: '8 wk' },
            { id: '84', label: '12 wk' },
            { id: 'custom', label: 'Custom' },
          ].map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => applyPreset(x.id)}
              style={{ ...S.btn, ...(preset === x.id ? S.btnAct : {}), padding: '6px 12px', fontSize: 11 }}
            >
              {x.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="date"
              value={toHtmlDateInputValue(startDate)}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ ...S.input, width: 'auto', fontSize: 12, padding: '6px 10px' }}
            />
            <span style={{ fontSize: 11, color: T.muted }}>to</span>
            <input
              type="date"
              value={toHtmlDateInputValue(endDate)}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ ...S.input, width: 'auto', fontSize: 12, padding: '6px 10px' }}
            />
          </div>
        )}
        {towersInView.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: 'uppercase' }}>Towers</span>
            <button type="button" onClick={selectAllTowers} style={{ ...S.btn, padding: '4px 10px', fontSize: 10 }}>
              All towers
            </button>
            {towersInView.map((tw) => {
              const active = towerWhitelist === null || towerWhitelist.has(tw);
              return (
                <button
                  key={tw}
                  type="button"
                  onClick={() => toggleTower(tw)}
                  style={{
                    ...S.btn,
                    ...(active ? S.btnAct : {}),
                    padding: '4px 10px',
                    fontSize: 10,
                    opacity: towerWhitelist === null ? 1 : active ? 1 : 0.45,
                  }}
                >
                  {tw}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
        {!zoneRows.length && (
          <div style={{ textAlign: 'center', padding: 48, color: T.faint, fontSize: 13 }}>
            No programme items for this range and selection. Tick more programme tabs above, schedule on the Programme page, or widen the date range.
          </div>
        )}
        {zoneRows.length > 0 && (
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', marginBottom: 6, position: 'sticky', top: 0, zIndex: 2, background: T.bg, paddingBottom: 4 }}>
              <div style={{ width: 200, flexShrink: 0, fontSize: 9, fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Zone / activity
              </div>
              <div
                style={{
                  flex: 1,
                  minWidth: timelineMinWidth,
                  position: 'relative',
                  height: 22,
                  borderBottom: `1px solid ${T.hairline}`,
                }}
              >
                {dayTicks.map((dk, i) => {
                  const d = parseKey(dk);
                  const show = i === 0 || d.getDate() === 1 || d.getDay() === 1;
                  if (!show) return null;
                  const leftPct = barGeometry(startDate, endDate, dk, dk)?.leftPct ?? 0;
                  return (
                    <span
                      key={dk}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        transform: 'translateX(-2px)',
                        fontSize: 9,
                        color: T.muted,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatShort(d)}
                    </span>
                  );
                })}
              </div>
            </div>
            {zoneRows.map((z) => {
              const zoneLabel = zoneRowLabel(z);
              return (
                <div key={z.zone_id} style={{ display: 'flex', alignItems: 'center', minHeight: 40, borderBottom: `1px solid ${T.hairline}` }}>
                  <div
                    style={{
                      width: 200,
                      flexShrink: 0,
                      paddingRight: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.text,
                      lineHeight: 1.25,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={`${z.zone_name || ''} (${z.tower || ''})${selectedTabs.length > 1 ? ` · ${drawingTabLabel(z.items[0]?.drawing_tab)}` : ''}`}
                  >
                    {zoneLabel}
                    {selectedTabs.length > 1 && z.items[0]?.drawing_tab && (
                      <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: T.faint, marginTop: 2 }}>
                        {drawingTabLabel(z.items[0].drawing_tab)}
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: timelineMinWidth, position: 'relative', height: 28, padding: '4px 0' }}>
                    <div
                      style={{
                        position: 'absolute',
                        inset: '4px 0',
                        borderRadius: 6,
                        background: `repeating-linear-gradient(90deg, transparent, transparent 14px, ${T.hairline} 14px, ${T.hairline} 15px)`,
                        opacity: 0.35,
                      }}
                    />
                    {todayPct != null && (
                      <div
                        title="Today"
                        style={{
                          position: 'absolute',
                          left: `${todayPct}%`,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          marginLeft: -1,
                          background: 'rgba(231,76,60,0.85)',
                          zIndex: 1,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    {z.items.map((it) => {
                      const geo = barGeometry(startDate, endDate, it.start_date, it.end_date);
                      if (!geo) return null;
                      const done = String(it.status || '').toLowerCase() === 'done';
                      const tabHint =
                        selectedTabs.length > 1 ? `${drawingTabLabel(it.drawing_tab)} · ` : '';
                      const tip = `${tabHint}${it.activity_name}\n${it.start_date} → ${it.end_date}\n${it.status || 'planned'}${it.notes ? `\n${it.notes}` : ''}`;
                      return (
                        <div
                          key={it.id}
                          title={tip}
                          style={{
                            position: 'absolute',
                            left: `${geo.leftPct}%`,
                            width: `${Math.max(geo.widthPct, 0.8)}%`,
                            top: 6,
                            height: 16,
                            borderRadius: 6,
                            background: actColor(it.activity_name, done ? 0.35 : 0.72),
                            border: `1px solid ${actColor(it.activity_name, 0.95)}`,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: 6,
                            fontSize: 9,
                            fontWeight: 700,
                            color: T.text,
                            textShadow: '0 0 6px rgba(255,255,255,0.9)',
                            cursor: 'default',
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{abbrevActivity(it.activity_name)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
