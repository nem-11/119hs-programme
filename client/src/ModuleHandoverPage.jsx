import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as api from './api';
import { T, S, shadowCard } from './uiTheme';
import PageHeader from './PageHeader';
import ZoneDrawingCanvas from './ZoneDrawingCanvas';
import { parseZoneGeometry, svgPolygonPoints, geomBBox } from './zoneGeom';
import { isPdfFile, rasterizePdfFirstPageToJpeg } from './pdfDrawing';
import { MODULE_HANDOVER_TAB } from './constants';
import {
  MODULE_STAGES,
  moduleStageMeta,
  normalizeModuleStage,
  moduleCompletionSummary,
} from './moduleHandover';

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function rasterizeImageFile(file) {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  const s = Math.min(1920 / img.width, 1);
  c.width = img.width * s;
  c.height = img.height * s;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
  return { width: c.width, height: c.height, b64 };
}

/** Module Handover — modules drawn as zones on a plan, each carrying a single handover stage. */
export default function ModuleHandoverPage({ canManage = false }) {
  const [drawings, setDrawings] = useState([]);
  const [drawingId, setDrawingId] = useState('');
  const [drawing, setDrawing] = useState(null);
  const [zones, setZones] = useState([]);
  const [selId, setSelId] = useState(null);
  const [tool, setTool] = useState('view'); // 'view' | 'draw'
  const [rectDraft, setRectDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [coarse, setCoarse] = useState(false);

  const wrapRef = useRef(null);
  const drawingRef = useRef(false);
  const card = { background: '#fff', borderRadius: 12, border: '1px solid rgba(26,26,46,0.06)', boxShadow: shadowCard };

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const fn = () => setCoarse(!!mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const reloadDrawings = useCallback(() => {
    return api
      .getDrawings()
      .then((d) => {
        const list = (Array.isArray(d) ? d : []).filter((x) => String(x.tab) === MODULE_HANDOVER_TAB);
        setDrawings(list);
        return list;
      })
      .catch((e) => {
        setErr(e?.message || 'Could not load drawings');
        setDrawings([]);
        return [];
      });
  }, []);

  useEffect(() => {
    reloadDrawings();
  }, [reloadDrawings]);

  useEffect(() => {
    setDrawingId((prev) => {
      if (prev && drawings.some((d) => Number(d.id) === Number(prev))) return prev;
      return drawings[0]?.id ? String(drawings[0].id) : '';
    });
  }, [drawings]);

  const reloadZones = useCallback((did) => {
    if (!did) {
      setZones([]);
      return Promise.resolve([]);
    }
    return api
      .getZonesForDrawing(did)
      .then((z) => {
        const list = Array.isArray(z) ? z : [];
        setZones(list);
        return list;
      })
      .catch((e) => {
        setErr(e?.message || 'Could not load modules');
        setZones([]);
        return [];
      });
  }, []);

  useEffect(() => {
    setSelId(null);
    if (!drawingId) {
      setDrawing(null);
      setZones([]);
      return;
    }
    let cancelled = false;
    api.getDrawing(drawingId).then((d) => {
      if (!cancelled) setDrawing(d || null);
    });
    reloadZones(drawingId);
    return () => {
      cancelled = true;
    };
  }, [drawingId, reloadZones]);

  const summary = useMemo(() => moduleCompletionSummary(zones), [zones]);
  const selected = useMemo(() => zones.find((z) => Number(z.id) === Number(selId)) || null, [zones, selId]);

  async function handleUpload(e) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setErr('');
    setBusy(true);
    try {
      let width;
      let height;
      let b64;
      if (isPdfFile(file)) {
        const buf = await file.arrayBuffer();
        const out = await rasterizePdfFirstPageToJpeg(buf, { maxWidth: 1920, jpegQuality: 0.85 });
        width = out.width;
        height = out.height;
        b64 = out.base64;
      } else {
        const out = await rasterizeImageFile(file);
        width = out.width;
        height = out.height;
        b64 = out.b64;
      }
      const r = await api.createModuleDrawing(file.name, 'modules', b64, width, height, null);
      if (r?.ok) {
        const list = await reloadDrawings();
        if (list.some((d) => Number(d.id) === Number(r.id))) setDrawingId(String(r.id));
      } else {
        setErr(typeof r?.error === 'string' ? r.error : 'Upload failed.');
      }
    } catch (e2) {
      setErr(e2?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function renameDrawing() {
    if (!drawingId) return;
    const cur = drawings.find((d) => Number(d.id) === Number(drawingId));
    const name = window.prompt('Rename drawing', cur?.name || '');
    if (name == null) return;
    const out = await api.renameModuleDrawing(drawingId, name);
    if (out && out.error) {
      setErr(String(out.error));
      return;
    }
    reloadDrawings();
  }

  async function deleteDrawing() {
    if (!drawingId) return;
    const cur = drawings.find((d) => Number(d.id) === Number(drawingId));
    if (!window.confirm(`Delete drawing "${cur?.name || ''}" and all its modules?\nThis cannot be undone.`)) return;
    const out = await api.deleteModuleDrawing(drawingId);
    if (out && out.error) {
      setErr(String(out.error));
      return;
    }
    setDrawingId('');
    reloadDrawings();
  }

  function clientToPct(clientX, clientY) {
    const el = wrapRef.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(r.width, 1)) * 100;
    const y = ((clientY - r.top) / Math.max(r.height, 1)) * 100;
    return [Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))];
  }

  const onDrawMove = useCallback((ev) => {
    if (!drawingRef.current) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / Math.max(r.width, 1)) * 100;
    const y = ((ev.clientY - r.top) / Math.max(r.height, 1)) * 100;
    setRectDraft((d) => (d ? { ...d, w: Math.max(0, Math.min(100, x)) - d.x, h: Math.max(0, Math.min(100, y)) - d.y } : d));
  }, []);

  const onDrawUp = useCallback(async () => {
    window.removeEventListener('mousemove', onDrawMove);
    window.removeEventListener('mouseup', onDrawUp);
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setRectDraft((cur) => {
      if (!cur) return null;
      let { x, y, w, h } = cur;
      if (w < 0) {
        x += w;
        w = -w;
      }
      if (h < 0) {
        y += h;
        h = -h;
      }
      if (w < 1.2 || h < 1.2) return null;
      const name = window.prompt('Module name (e.g. M-101)', '');
      if (name == null) return null;
      const geometry = { kind: 'rect', x, y, w, h };
      api
        .addModuleZone(drawingId, name.trim() || 'Module', '', geometry)
        .then((out) => {
          if (out && out.error) setErr(String(out.error));
          else reloadZones(drawingId);
        });
      return null;
    });
  }, [drawingId, onDrawMove, reloadZones]);

  function onPlateMouseDown(e) {
    if (tool !== 'draw' || !canManage || !drawing?.image_data) return;
    e.preventDefault();
    const [x, y] = clientToPct(e.clientX, e.clientY);
    drawingRef.current = true;
    setRectDraft({ x, y, w: 0, h: 0 });
    window.addEventListener('mousemove', onDrawMove);
    window.addEventListener('mouseup', onDrawUp);
  }

  async function setStage(stageKey) {
    if (!selected || !canManage) return;
    const id = Number(selected.id);
    setZones((zs) => zs.map((z) => (Number(z.id) === id ? { ...z, handover_stage: stageKey } : z)));
    const out = await api.setModuleStage(id, stageKey);
    if (out && out.error) {
      setErr(String(out.error));
      reloadZones(drawingId);
    }
  }

  async function renameModule() {
    if (!selected || !canManage) return;
    const name = window.prompt('Rename module', selected.name || '');
    if (name == null) return;
    const out = await api.updateModuleZone(Number(selected.id), { name: name.trim() || selected.name });
    if (out && out.error) setErr(String(out.error));
    else reloadZones(drawingId);
  }

  async function deleteModule() {
    if (!selected || !canManage) return;
    if (!window.confirm(`Delete module "${selected.name}"?`)) return;
    const out = await api.deleteModuleZone(Number(selected.id));
    if (out && out.error) setErr(String(out.error));
    else {
      setSelId(null);
      reloadZones(drawingId);
    }
  }

  const styleForZone = useCallback(
    (z) => {
      const meta = moduleStageMeta(z.handover_stage);
      const isSel = Number(z.id) === Number(selId);
      return {
        fill: meta.fill,
        stroke: isSel ? 'rgba(36, 68, 140, 1)' : meta.stroke,
        strokeW: isSel ? 1.7 : 0.85,
      };
    },
    [selId]
  );

  const labelForZone = useCallback((z) => String(z.name || '').trim(), []);

  const legend = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        padding: '10px 12px',
        background: T.surface,
        border: `1px solid ${T.hairline}`,
        borderRadius: 10,
        marginTop: 10,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Stages
      </span>
      {MODULE_STAGES.map((s) => (
        <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text, fontWeight: 600 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: s.swatch, border: `1px solid ${s.stroke}` }} />
          {s.label}
        </span>
      ))}
    </div>
  );

  return (
    <div style={{ padding: '14px 16px 90px' }}>
      <PageHeader
        title="Module Handover"
        description={
          canManage
            ? 'Upload a plan, draw each module, then set its handover stage. Board sees the live picture.'
            : 'Live view of module handover progress across the plan.'
        }
        filters={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>Drawing</label>
            <select
              value={drawingId}
              onChange={(e) => setDrawingId(e.target.value)}
              style={{ ...S.input, padding: '7px 10px', fontSize: 13, minWidth: 180 }}
            >
              {!drawings.length && <option value="">No drawing</option>}
              {drawings.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
            {drawing?.image_data && (
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    setTool('view');
                    setRectDraft(null);
                  }}
                  style={{ ...S.btn, ...(tool === 'view' ? S.btnAct : {}), padding: '7px 12px', fontSize: 12 }}
                >
                  View / set stage
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setTool('draw');
                      setSelId(null);
                    }}
                    style={{ ...S.btn, ...(tool === 'draw' ? S.btnAct : {}), padding: '7px 12px', fontSize: 12 }}
                  >
                    + Add modules
                  </button>
                )}
              </div>
            )}
          </div>
        }
        actions={
          canManage ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ ...S.btn, ...S.btnPrimary, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>
                {busy ? 'Uploading…' : drawing?.image_data ? 'Replace / add drawing' : 'Upload drawing'}
                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleUpload} disabled={busy} />
              </label>
              {drawingId && (
                <>
                  <button type="button" onClick={renameDrawing} style={{ ...S.btn, padding: '8px 14px', fontSize: 12 }}>
                    Rename
                  </button>
                  <button type="button" onClick={deleteDrawing} style={{ ...S.btn, padding: '8px 14px', fontSize: 12, color: '#b3261e' }}>
                    Delete drawing
                  </button>
                </>
              )}
            </div>
          ) : null
        }
      />

      {err && (
        <div style={{ margin: '10px 0', padding: '8px 12px', background: 'rgba(179,38,30,0.08)', border: '1px solid rgba(179,38,30,0.3)', borderRadius: 8, color: '#b3261e', fontSize: 13 }}>
          {err}
          <button type="button" onClick={() => setErr('')} style={{ ...S.btn, marginLeft: 10, padding: '2px 8px', fontSize: 11 }}>
            Dismiss
          </button>
        </div>
      )}

      {!drawing?.image_data ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: T.faint, fontSize: 14, marginTop: 12 }}>
          {canManage ? 'Upload a plan to start placing modules.' : 'No module handover drawing has been set up yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, marginTop: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 520px', minWidth: 280 }}>
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              {tool === 'draw' ? (
                <div
                  ref={wrapRef}
                  onMouseDown={onPlateMouseDown}
                  style={{ position: 'relative', width: '100%', cursor: 'crosshair', userSelect: 'none' }}
                >
                  <img
                    alt="Module plan"
                    src={`data:image/jpeg;base64,${drawing.image_data}`}
                    draggable={false}
                    style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none' }}
                  />
                  <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                    {zones.map((z) => {
                      const g = parseZoneGeometry(z);
                      if (!g) return null;
                      const meta = moduleStageMeta(z.handover_stage);
                      if (g.kind === 'poly') {
                        return <polygon key={z.id} points={svgPolygonPoints(g)} fill={meta.fill} stroke={meta.stroke} strokeWidth={0.7} />;
                      }
                      return <rect key={z.id} x={g.x} y={g.y} width={g.w} height={g.h} fill={meta.fill} stroke={meta.stroke} strokeWidth={0.7} />;
                    })}
                    {rectDraft && (
                      <rect
                        x={Math.min(rectDraft.x, rectDraft.x + rectDraft.w)}
                        y={Math.min(rectDraft.y, rectDraft.y + rectDraft.h)}
                        width={Math.abs(rectDraft.w)}
                        height={Math.abs(rectDraft.h)}
                        fill="rgba(66,133,244,0.22)"
                        stroke="rgba(36,68,140,1)"
                        strokeWidth={0.7}
                        strokeDasharray="1.4 1"
                      />
                    )}
                  </svg>
                </div>
              ) : (
                <ZoneDrawingCanvas
                  drawing={drawing}
                  zones={zones}
                  enableZoomPan
                  allowZoneClick
                  coarsePointer={coarse}
                  minHeight="min(70vh, 620px)"
                  styleForZone={styleForZone}
                  labelForZone={labelForZone}
                  labelActiveForZone={() => true}
                  onZoneClick={(z) => setSelId(Number(z.id))}
                  emptyMessage="No drawing selected."
                />
              )}
            </div>
            {tool === 'draw' && (
              <div style={{ marginTop: 8, fontSize: 12, color: T.muted }}>
                Drag a box around each module, then name it. Switch to “View / set stage” to record handover progress.
              </div>
            )}
            {legend}
          </div>

          <div style={{ flex: '0 0 280px', minWidth: 240, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...card, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Handover progress
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, color: T.text, marginTop: 6 }}>{summary.pct}%</div>
              <div style={{ fontSize: 13, color: T.muted }}>
                {summary.handed} of {summary.total} modules handed over
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {MODULE_STAGES.map((s) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: T.text }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: s.swatch, border: `1px solid ${s.stroke}` }} />
                      {s.label}
                    </span>
                    <span style={{ fontWeight: 700 }}>{summary.byStage[s.key] || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            {selected ? (
              <div style={{ ...card, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{selected.name}</div>
                  <button type="button" onClick={() => setSelId(null)} style={{ ...S.btn, padding: '2px 8px', fontSize: 11 }}>
                    Close
                  </button>
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                  Current: <strong style={{ color: T.text }}>{moduleStageMeta(selected.handover_stage).label}</strong>
                </div>
                {canManage ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 12 }}>
                      Set stage
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {MODULE_STAGES.map((s) => {
                        const active = normalizeModuleStage(selected.handover_stage) === s.key;
                        return (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => setStage(s.key)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: active ? `2px solid ${s.stroke}` : `1px solid ${T.hairline}`,
                              background: active ? s.fill : '#fff',
                              color: T.text,
                              fontSize: 13,
                              fontWeight: active ? 800 : 600,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ width: 13, height: 13, borderRadius: 3, background: s.swatch, border: `1px solid ${s.stroke}`, flex: '0 0 auto' }} />
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button type="button" onClick={renameModule} style={{ ...S.btn, padding: '7px 12px', fontSize: 12 }}>
                        Rename
                      </button>
                      <button type="button" onClick={deleteModule} style={{ ...S.btn, padding: '7px 12px', fontSize: 12, color: '#b3261e' }}>
                        Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <div style={{ ...card, padding: 14, fontSize: 13, color: T.muted }}>
                {tool === 'draw' ? 'Drag on the plan to add a module.' : 'Tap a module on the plan to see its handover stage.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
