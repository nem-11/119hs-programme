import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as api from './api';
import { actColor, dateKey, formatShort, toHtmlDateInputValue, drawingTabLabel } from './constants';
import { T, S } from './uiTheme';
import PageHeader from './PageHeader';
import {
  calendarDaysBetween,
  isWeekendKey,
  dayKeyInItemRange,
  abbrevActivity,
  zoneRowLabel,
  isNonWorkingPlanDayKey,
  isSundayOrBankHolidayKey,
  clampProgrammeItemToScheduleableRange,
  countScheduleableDaysInclusive,
  normalizeScheduleStartKey,
  endOfScheduleableSpan,
  nextScheduleableDayKey,
} from './planUtils';
import { parseZoneGeometry, svgPolygonPoints } from './zoneGeom';
import './planPrint.css';
import ActivityInspectModal from './ActivityInspectModal';
import ActivityChipEditModal from './ActivityChipEditModal';
import PlanAddActivityModal from './PlanAddActivityModal';
import PlanActivityChip from './PlanActivityChip';

/**
 * Fixed vivid palette so neighbouring zones stay visually distinct (not muddy HSL steps).
 * Cycles with brightness tiers when there are more zones than colours.
 */
const PLAN_ZONE_PALETTE = [
  [231, 76, 60],
  [52, 152, 219],
  [46, 204, 113],
  [241, 196, 15],
  [155, 89, 182],
  [230, 126, 34],
  [26, 188, 156],
  [231, 76, 120],
  [142, 68, 173],
  [22, 160, 133],
  [243, 156, 18],
  [211, 84, 0],
  [41, 128, 185],
  [39, 174, 96],
  [192, 57, 43],
  [106, 176, 222],
  [147, 112, 219],
  [212, 172, 13],
  [199, 55, 150],
  [72, 201, 176],
];

function planZoneRgb(zoneIndex) {
  const L = PLAN_ZONE_PALETTE.length;
  /** Spread consecutive zone indices across the palette (coprime step mod L). */
  const slot = ((zoneIndex * 11 + 5) % L + L) % L;
  const [r0, g0, b0] = PLAN_ZONE_PALETTE[slot];
  const tier = Math.floor(zoneIndex / L);
  if (tier === 0) return [r0, g0, b0];
  const t = 0.92 - (tier % 5) * 0.075;
  return [
    Math.round(Math.min(255, r0 * t)),
    Math.round(Math.min(255, g0 * t)),
    Math.round(Math.min(255, b0 * t)),
  ];
}

/** Fill + stroke for one zone on the plan drawing (active = programme work that day). */
function planZoneDrawingStyles(zoneIndex, { done, active }) {
  if (!active) {
    return {
      fill: 'rgba(110, 118, 135, 0.18)',
      stroke: 'rgba(35, 40, 52, 0.65)',
      strokeW: 0.55,
    };
  }
  const [r, g, b] = planZoneRgb(zoneIndex);
  const alpha = done ? 0.52 : 0.72;
  const fill = `rgba(${r},${g},${b},${alpha})`;
  const sr = Math.max(0, r - 42);
  const sg = Math.max(0, g - 42);
  const sb = Math.max(0, b - 42);
  const stroke = `rgb(${sr},${sg},${sb})`;
  return { fill, stroke, strokeW: 1.05 };
}

/** Bounding box + centre for zone geometry (viewBox 0–100). */
function geomBBox(g, z) {
  if (g?.kind === 'rect') {
    return {
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      cx: g.x + g.w / 2,
      cy: g.y + g.h / 2,
    };
  }
  if (g?.kind === 'poly' && Array.isArray(g.points) && g.points.length >= 3) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of g.points) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    return { x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2 };
  }
  const x = Number(z?.x) || 0;
  const y = Number(z?.y) || 0;
  const w = Number(z?.w) || 0;
  const h = Number(z?.h) || 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Readable micro-label size from zone footprint; cap so text stays subtle on large zones. */
function zoneLabelFontSize(bb) {
  const m = Math.min(bb.w, bb.h);
  return Math.min(1.15, Math.max(0.52, m * 0.16));
}

function csvEscape(v) {
  if (v == null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv(filename, rows) {
  const lines = rows.map((r) => r.map(csvEscape).join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  x.setDate(x.getDate() + n);
  return x;
}

function useIsMobile() {
  const [m, setM] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return m;
}

export default function PlanPage({ tab, userTabs, isAdmin }) {
  const [rows, setRows] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [preset, setPreset] = useState('7');
  const [viewMode, setViewMode] = useState('grid'); // grid | drawing
  const [vizDate, setVizDate] = useState(() => dateKey(new Date()));
  const [drawings, setDrawings] = useState([]);
  const [drawingId, setDrawingId] = useState(null);
  const [drawData, setDrawData] = useState(null);
  const [drawZones, setDrawZones] = useState([]);
  const todayRef = useRef(new Date());

  const defaultEnd = useMemo(() => addDays(todayRef.current, 6), []);
  const [startDate, setStartDate] = useState(() => dateKey(todayRef.current));
  const [endDate, setEndDate] = useState(() => dateKey(defaultEnd));

  /** Explicit selected drawing tabs (multi-select); synced from header `tab`. */
  const [selectedTabs, setSelectedTabs] = useState(() => [tab]);
  /** null = all towers; otherwise whitelist */
  const [towerWhitelist, setTowerWhitelist] = useState(null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfOpts, setPdfOpts] = useState({
    allZones: true,
    legend: true,
    header: true,
    showWeekends: true,
  });

  /** Active during print preview + print dialog */
  const [printLayout, setPrintLayout] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [undoState, setUndoState] = useState(null);
  const [dismissedClashKey, setDismissedClashKey] = useState('');

  const titleRestore = useRef(typeof document !== 'undefined' ? document.title : '');
  const isMobile = useIsMobile();
  const [inspect, setInspect] = useState(null);
  const [chipEdit, setChipEdit] = useState(null);
  const [addActivityZone, setAddActivityZone] = useState(null);
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const fn = () => setCoarsePointer(!!mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

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

  useEffect(() => {
    api.getActivities().then((a) => setActivities(Array.isArray(a) ? a : []));
  }, []);

  useEffect(() => {
    api.getDrawings().then((d) => setDrawings(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    function afterPrint() {
      document.body.classList.remove('plan-print-mode');
      document.title = titleRestore.current || '119HS';
      setPrintLayout(null);
    }
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);

  const permittedTabs = useMemo(() => {
    const base = userTabs?.length ? userTabs : ['groundworks', 'internals'];
    if (!isAdmin) return base;
    const s = new Set(base);
    for (const r of rows) {
      if (r.drawing_tab) s.add(String(r.drawing_tab));
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [isAdmin, userTabs, rows]);

  /** When the header programme tab changes, match Plan scope to that tab only. */
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

  const applyPreset = useCallback((p) => {
    const t0 = new Date();
    t0.setHours(12, 0, 0, 0);
    setPreset(p);
    if (p === 'custom') return;
    const days = parseInt(p, 10);
    setStartDate(dateKey(t0));
    setEndDate(dateKey(addDays(t0, days - 1)));
  }, []);

  /** Scope only (no tower filter) so the tower chips always list every tower in the current scope. */
  const rowsForScope = useMemo(() => {
    return rows.filter((r) => {
      const dt = String(r.drawing_tab || '').trim();
      if (!permittedTabs.includes(dt)) return false;
      if (!selectedSet.has(dt)) return false;
      return true;
    });
  }, [rows, permittedTabs, selectedSet]);

  const filteredRows = useMemo(() => {
    return rowsForScope.filter((r) => {
      if (towerWhitelist !== null) {
        const tw = String(r.tower || '').trim();
        if (!towerWhitelist.has(tw)) return false;
      }
      return true;
    });
  }, [rowsForScope, towerWhitelist]);

  const towersInView = useMemo(() => {
    const s = new Set();
    rowsForScope.forEach((r) => {
      const tw = String(r.tower || '').trim();
      if (tw) s.add(tw);
    });
    return [...s].sort();
  }, [rowsForScope]);

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

  const dayColumns = useMemo(() => {
    const all = calendarDaysBetween(startDate, endDate);
    if (printLayout && !printLayout.showWeekends) {
      return all.filter((k) => !isWeekendKey(k));
    }
    return all;
  }, [startDate, endDate, printLayout]);

  const todayKey = dateKey(new Date());

  const zoneBlocks = useMemo(() => {
    const byZone = new Map();
    for (const r of filteredRows) {
      const id = r.zone_id;
      if (!byZone.has(id)) {
        byZone.set(id, {
          zone_id: id,
          zone_name: r.zone_name,
          tower: r.tower,
          drawing_tab: r.drawing_tab,
          drawing_name: r.drawing_name,
          items: [],
        });
      }
      byZone.get(id).items.push(r);
    }

    const blocks = [];
    const emptyZones = !!(printLayout && printLayout.emptyZones);

    for (const z of byZone.values()) {
      const cells = {};
      let any = false;
      for (const dk of dayColumns) {
        const hits = isSundayOrBankHolidayKey(dk)
          ? []
          : z.items.filter((it) => dayKeyInItemRange(dk, it.start_date, it.end_date));
        if (hits.length) any = true;
        cells[dk] = hits;
      }
      if (!any && !emptyZones) continue;
      blocks.push({ ...z, cells });
    }

    blocks.sort((a, b) => {
      const dtab = String(a.drawing_tab || '').localeCompare(String(b.drawing_tab || ''));
      if (dtab !== 0) return dtab;
      const tw = String(a.tower || '').localeCompare(String(b.tower || ''));
      if (tw !== 0) return tw;
      return zoneRowLabel(a).localeCompare(zoneRowLabel(b));
    });

    return blocks;
  }, [filteredRows, dayColumns, printLayout]);

  const legendActs = useMemo(() => {
    const names = new Set();
    for (const z of zoneBlocks) {
      for (const dk of dayColumns) {
        for (const it of z.cells[dk] || []) {
          if (it.activity_name) names.add(it.activity_name);
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [zoneBlocks, dayColumns]);

  const drawingOptions = useMemo(() => {
    return (drawings || []).filter((d) => {
      const t = String(d.tab || '').trim();
      if (!permittedTabs.includes(t)) return false;
      if (!selectedSet.has(t)) return false;
      return true;
    });
  }, [drawings, permittedTabs, selectedSet]);

  useEffect(() => {
    if (!drawingOptions.length) {
      setDrawingId(null);
      return;
    }
    if (!drawingId || !drawingOptions.some((d) => Number(d.id) === Number(drawingId))) {
      setDrawingId(drawingOptions[0].id);
    }
  }, [drawingOptions, drawingId]);

  useEffect(() => {
    if (!drawingId) {
      setDrawData(null);
      setDrawZones([]);
      return;
    }
    api.getDrawing(drawingId).then((d) => setDrawData(d || null));
    api.getZonesForDrawing(drawingId).then((z) => setDrawZones(Array.isArray(z) ? z : []));
  }, [drawingId]);

  const zoneDayActivity = useMemo(() => {
    if (isSundayOrBankHolidayKey(vizDate)) return new Map();
    const by = new Map();
    for (const r of filteredRows) {
      if (!dayKeyInItemRange(vizDate, r.start_date, r.end_date)) continue;
      const id = Number(r.zone_id);
      const cur = by.get(id);
      if (!cur) {
        by.set(id, r);
        continue;
      }
      const curDone = String(cur.status || '').toLowerCase() === 'done';
      const nextDone = String(r.status || '').toLowerCase() === 'done';
      if (curDone && !nextDone) {
        by.set(id, r);
        continue;
      }
      if (String(r.start_date) < String(cur.start_date)) by.set(id, r);
    }
    return by;
  }, [filteredRows, vizDate]);

  /** One row per zone on this drawing with programme that day: tower + zone - activity. */
  const drawingDayLegendEntries = useMemo(() => {
    const ids = new Set(drawZones.map((z) => Number(z.id)));
    const zoneById = new Map(drawZones.map((z) => [Number(z.id), z]));
    const out = [];
    zoneDayActivity.forEach((r, zid) => {
      if (!ids.has(zid)) return;
      if (!r?.activity_name) return;
      const z = zoneById.get(zid);
      const tw = String(z?.tower ?? r.tower ?? '').trim();
      const zn = String(z?.name ?? r.zone_name ?? '').trim();
      const zonePart = [tw, zn].filter(Boolean).join(' ');
      const label = zonePart ? `${zonePart} - ${r.activity_name}` : String(r.activity_name);
      const done = String(r.status || '').toLowerCase() === 'done';
      out.push({ key: zid, label, activity_name: r.activity_name, done });
    });
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [zoneDayActivity, drawZones]);

  const drawingZoneColorMeta = useMemo(() => {
    const sorted = [...drawZones].sort((a, b) => Number(a.id) - Number(b.id));
    const byId = new Map();
    sorted.forEach((z, i) => byId.set(Number(z.id), i));
    return { byId, total: sorted.length };
  }, [drawZones]);

  const shiftVizDate = useCallback((deltaDays) => {
    setVizDate((prev) => dateKey(addDays(new Date(String(prev) + 'T12:00:00'), deltaDays)));
  }, []);

  const shiftGridRange = useCallback((deltaDays) => {
    setPreset('custom');
    setStartDate((s) => dateKey(addDays(new Date(String(s) + 'T12:00:00'), deltaDays)));
    setEndDate((en) => dateKey(addDays(new Date(String(en) + 'T12:00:00'), deltaDays)));
  }, []);

  const jumpGridToDayColumn = useCallback(
    (dk) => {
      setPreset('custom');
      const span = Math.max(1, calendarDaysBetween(startDate, endDate).length);
      setStartDate(dk);
      setEndDate(dateKey(addDays(new Date(String(dk) + 'T12:00:00'), span - 1)));
      setVizDate(dk);
    },
    [startDate, endDate]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      if (viewMode === 'drawing') shiftVizDate(step);
      else shiftGridRange(step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, shiftVizDate, shiftGridRange]);

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

  async function applyZoneRows(zoneId, zoneItems, nextItems) {
    const payload = (nextItems || []).map((r) => {
      const c = clampProgrammeItemToScheduleableRange(r.start_date, r.end_date);
      return {
        activity_id: Number(r.activity_id),
        start_date: c.start_date,
        end_date: c.end_date,
        status: r.status || 'planned',
        notes: r.notes || '',
      };
    });
    const out = await api.replacePlanZoneItems(zoneId, payload);
    if (out && out.error) throw new Error(out.error);
    setUndoState({
      type: 'zone_rows',
      zoneId,
      label: 'Revert last activity edit/move/add/delete in selected zone',
      at: new Date().toISOString(),
      rowsBefore: zoneItems.map((r) => ({
        activity_id: Number(r.activity_id),
        start_date: String(r.start_date),
        end_date: String(r.end_date),
        status: r.status || 'planned',
        notes: r.notes || '',
      })),
    });
    await load();
  }

  const catalogueActivities = useMemo(
    () => activities.filter((a) => String(a.type || '') === String(tab || '')),
    [activities, tab]
  );

  async function addActivityToZone(z, { activityKey, customName, startDate: startInput, duration, insertAfter }) {
    let act;
    if (activityKey === '__custom__') {
      const name = String(customName || '').trim();
      if (!name) throw new Error('Activity name is required');
      act = activities.find((a) => String(a.name).toLowerCase() === name.toLowerCase());
    } else {
      act = activities.find((a) => Number(a.id) === Number(activityKey));
    }
    if (!act) throw new Error('Activity not found');
    const start = normalizeScheduleStartKey(startInput);
    const durationDays = Math.max(1, Number(duration) || 1);
    const items = [...z.items]
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
      .map((x) => ({ ...x }));
    let idx = items.length;
    if (insertAfter) {
      const afterIdx = items.findIndex(
        (it) => String(it.activity_name).toLowerCase() === String(insertAfter).trim().toLowerCase()
      );
      idx = afterIdx >= 0 ? afterIdx + 1 : items.length;
    }
    const end = endOfScheduleableSpan(start, durationDays);
    items.splice(idx, 0, {
      id: `tmp_${Date.now()}`,
      zone_id: z.zone_id,
      activity_id: Number(act.id),
      activity_name: act.name,
      start_date: start,
      end_date: end,
      status: 'planned',
      notes: '',
    });
    let cursor = idx === 0 ? items[0].start_date : nextScheduleableDayKey(items[idx - 1].end_date);
    for (let i = idx; i < items.length; i++) {
      const dur = countScheduleableDaysInclusive(items[i].start_date, items[i].end_date);
      items[i] = {
        ...items[i],
        start_date: normalizeScheduleStartKey(cursor),
        end_date: endOfScheduleableSpan(normalizeScheduleStartKey(cursor), dur),
      };
      cursor = nextScheduleableDayKey(items[i].end_date);
    }
    await applyZoneRows(z.zone_id, z.items, items);
  }

  async function deleteActivityFromZone(zoneId, zoneItems, itemId) {
    const items = [...zoneItems]
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
      .map((x) => ({ ...x }));
    const idx = items.findIndex((x) => Number(x.id) === Number(itemId));
    if (idx < 0) throw new Error('Activity not found');
    items.splice(idx, 1);
    const from = idx;
    let cursor = from === 0 ? items[0]?.start_date : nextScheduleableDayKey(items[from - 1].end_date);
    for (let i = from; i < items.length; i++) {
      const dur = countScheduleableDaysInclusive(items[i].start_date, items[i].end_date);
      items[i] = { ...items[i], start_date: normalizeScheduleStartKey(cursor), end_date: endOfScheduleableSpan(normalizeScheduleStartKey(cursor), dur) };
      cursor = nextScheduleableDayKey(items[i].end_date);
    }
    await applyZoneRows(zoneId, zoneItems, items);
  }

  function detectClash(allRows) {
    const by = new Map();
    for (const r of allRows || []) {
      for (const dk of calendarDaysBetween(r.start_date, r.end_date)) {
        if (isSundayOrBankHolidayKey(dk)) continue;
        const key = `${dk}__${r.activity_name}`;
        if (!by.has(key)) by.set(key, []);
        by.get(key).push(r);
      }
    }
    for (const [key, arr] of by.entries()) {
      const zoneIds = [...new Set(arr.map((x) => Number(x.zone_id)))];
      if (zoneIds.length >= 2) {
        const [day, activity] = key.split('__');
        return { key, day, activity, rows: arr.slice(0, 2) };
      }
    }
    return null;
  }

  function runPrint(layout) {
    titleRestore.current = document.title;
    document.title = `119HS_Programme_${startDate}_${endDate}`;
    setPrintLayout(layout);
    document.body.classList.add('plan-print-mode');
    requestAnimationFrame(() => {
      window.print();
    });
  }

  function handlePrintClick() {
    runPrint({
      showWeekends: true,
      legend: true,
      header: true,
      emptyZones: false,
    });
  }

  function confirmPdfExport() {
    setPdfOpen(false);
    runPrint({
      showWeekends: pdfOpts.showWeekends,
      legend: pdfOpts.legend,
      header: pdfOpts.header,
      emptyZones: pdfOpts.allZones,
    });
  }

  async function exportAdminCsv() {
    let src = rows;
    if (isAdmin) {
      try {
        const full = await api.getPlanProgrammeFullExport();
        if (Array.isArray(full)) src = full;
      } catch (_) {}
    }
    const header = [
      'programme_item_id',
      'zone_id',
      'zone_name',
      'tower',
      'drawing_tab',
      'drawing_name',
      'activity_name',
      'activity_type',
      'start_date',
      'end_date',
      'status',
      'notes',
    ];
    const lines = [
      header,
      ...src.map((r) => [
        r.id,
        r.zone_id,
        r.zone_name,
        r.tower,
        r.drawing_tab,
        r.drawing_name,
        r.activity_name,
        r.activity_type,
        r.start_date,
        r.end_date,
        r.status,
        r.notes || '',
      ]),
    ];
    downloadCsv(`119HS_Programme_${startDate}_${endDate}.csv`, lines);
  }

  const printHeaderVisible = printLayout && printLayout.header;
  const legendVisible = printLayout == null || printLayout.legend;
  const clash = useMemo(() => detectClash(rows), [rows]);

  return (
    <div className="plan-print-root" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bg }}>
      <ActivityInspectModal
        open={Boolean(inspect)}
        onClose={() => setInspect(null)}
        row={inspect?.row}
        zoneLabel={inspect?.zoneLabel}
      />
      <ActivityChipEditModal
        open={Boolean(chipEdit)}
        onClose={() => setChipEdit(null)}
        row={chipEdit?.row}
        zoneLabel={chipEdit?.zoneLabel}
        onDelete={async () => {
          if (!chipEdit) return;
          await deleteActivityFromZone(chipEdit.zoneId, chipEdit.zoneItems, chipEdit.row.id);
        }}
      />
      <PlanAddActivityModal
        open={Boolean(addActivityZone)}
        onClose={() => setAddActivityZone(null)}
        zoneLabel={addActivityZone ? zoneRowLabel(addActivityZone) : ''}
        zoneItems={addActivityZone?.items || []}
        catalogueActivities={catalogueActivities}
        defaultStartDate={dayColumns[0] || startDate}
        onConfirm={async (form) => {
          if (!addActivityZone) return;
          await addActivityToZone(addActivityZone, form);
        }}
      />
      <PageHeader
        className="plan-no-print"
        title="Plan"
        description={
          <>
            Printable programme grid by zone and day — durations count <strong style={{ color: T.muted }}>scheduleable days</strong> (Mon–Fri only; Saturdays, Sundays, and England and Wales bank holidays are grey; you can still drag or edit onto a Saturday when needed). Admins: ＋ add per zone, drag to move, double-click (or long-press on mobile) a chip to delete, or single-click a chip to move/duration.
          </>
        }
        toggles={
          <div className="page-header__toggle-group">
            <button type="button" onClick={() => setViewMode('grid')} style={{ ...S.btn, ...(viewMode === 'grid' ? S.btnAct : {}), padding: '6px 10px', fontSize: 11 }}>Grid</button>
            <button type="button" onClick={() => setViewMode('drawing')} style={{ ...S.btn, ...(viewMode === 'drawing' ? S.btnAct : {}), padding: '6px 10px', fontSize: 11 }}>Drawing</button>
          </div>
        }
        actions={
          <>
            {isMobile && (
              <span style={{ fontSize: 10, color: T.muted, maxWidth: 220, lineHeight: 1.35 }}>
                For best results, print from a desktop browser.
              </span>
            )}
            <button type="button" onClick={handlePrintClick} style={{ ...S.btn, ...S.btnPrimary, padding: '8px 14px', fontSize: 12 }}>
              PRINT
            </button>
            <button type="button" onClick={() => setPdfOpen(true)} style={{ ...S.btn, padding: '8px 14px', fontSize: 12 }}>
              EXPORT PDF
            </button>
            {isAdmin && (
              <button type="button" onClick={exportAdminCsv} style={{ ...S.btn, padding: '8px 14px', fontSize: 12 }}>
                EXPORT DATA
              </button>
            )}
            {isAdmin && undoState && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (undoState.type === 'zone_rows') {
                      await api.replacePlanZoneItems(undoState.zoneId, undoState.rowsBefore);
                    } else if (undoState.type === 'delete_zone') {
                      await api.restorePlanZone(undoState.snapshot);
                    }
                    setUndoState(null);
                    await load();
                  } catch (e) {
                    window.alert(e?.message || 'Undo failed');
                  }
                }}
                style={{ ...S.btn, padding: '8px 14px', fontSize: 12 }}
              >
                UNDO
              </button>
            )}
          </>
        }
        filters={
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', width: '100%' }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted }}>
                Start
                <input
                  type="date"
                  value={toHtmlDateInputValue(startDate)}
                  onChange={(e) => {
                    setPreset('custom');
                    setStartDate(e.target.value);
                  }}
                  style={{ ...S.input, display: 'block', marginTop: 4, width: 148, fontSize: 12, padding: '6px 10px' }}
                />
              </label>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted }}>
                End
                <input
                  type="date"
                  value={toHtmlDateInputValue(endDate)}
                  onChange={(e) => {
                    setPreset('custom');
                    setEndDate(e.target.value);
                  }}
                  style={{ ...S.input, display: 'block', marginTop: 4, width: 148, fontSize: 12, padding: '6px 10px' }}
                />
              </label>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, marginBottom: 4 }}>Days</div>
                <div style={{ fontSize: 9, color: T.faint, marginBottom: 4, maxWidth: 280, lineHeight: 1.35 }}>
                  ← → arrow keys step one day{viewMode === 'grid' ? '; click a date column header to jump the window' : ''}.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {['7', '14', '21', '28'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyPreset(p)}
                      style={{ ...S.btn, ...(preset === p ? S.btnAct : {}), padding: '6px 10px', fontSize: 11 }}
                    >
                      {p}d
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPreset('custom')}
                    style={{ ...S.btn, ...(preset === 'custom' ? S.btnAct : {}), padding: '6px 10px', fontSize: 11 }}
                  >
                    Custom
                  </button>
                </div>
              </div>
            </div>

            {permittedTabs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
                <span className="page-header__filter-label">Scope</span>
                <span style={{ fontSize: 10, color: T.muted }}>Tick any combination:</span>
                {permittedTabs.length > 1 && (
                  <button
                    type="button"
                    onClick={selectAllProgrammeTabs}
                    title="Show every programme scope you have access to"
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
                      title={on ? 'Click to hide from this plan' : 'Click to include on this plan'}
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

            {towersInView.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: T.muted }}>Towers</span>
                <button type="button" onClick={selectAllTowers} style={{ ...S.btn, padding: '6px 10px', fontSize: 11 }}>
                  All towers
                </button>
                {towersInView.map((tw) => {
                  const active = towerWhitelist === null || towerWhitelist.has(tw);
                  return (
                    <button
                      key={tw}
                      type="button"
                      onClick={() => toggleTower(tw)}
                      style={{ ...S.btn, ...(active ? S.btnAct : {}), padding: '6px 10px', fontSize: 11, opacity: active ? 1 : 0.55 }}
                    >
                      {tw}
                    </button>
                  );
                })}
              </div>
            )}

            {viewMode === 'drawing' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: T.muted }}>Drawing date</span>
                <button type="button" onClick={() => shiftVizDate(-1)} style={{ ...S.btn, padding: '6px 12px', fontSize: 11 }} aria-label="Previous day">
                  ← Prev day
                </button>
                <input type="date" value={toHtmlDateInputValue(vizDate)} onChange={(e) => setVizDate(e.target.value)} style={{ ...S.input, width: 150, fontSize: 12, padding: '6px 10px' }} />
                <button type="button" onClick={() => shiftVizDate(1)} style={{ ...S.btn, padding: '6px 12px', fontSize: 11 }} aria-label="Next day">
                  Next day →
                </button>
                <span style={{ fontSize: 10, fontWeight: 600, color: T.muted }}>Drawing</span>
                <select value={drawingId || ''} onChange={(e) => setDrawingId(Number(e.target.value) || null)} style={{ ...S.input, width: 220, fontSize: 12, padding: '6px 10px' }}>
                  {drawingOptions.length === 0 && <option value="">No drawing in this scope</option>}
                  {drawingOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
          </>
        }
      >
        {isAdmin && (
          <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${T.hairline}`, background: 'rgba(66,133,244,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                Undo Last Change
              </div>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>
                {undoState?.label || 'No undo snapshot yet'}
              </div>
              {undoState?.at && (
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                  Saved {formatShort(new Date(undoState.at))}
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={!undoState}
              onClick={async () => {
                if (!undoState) return;
                try {
                  if (undoState.type === 'zone_rows') {
                    await api.replacePlanZoneItems(undoState.zoneId, undoState.rowsBefore);
                  } else if (undoState.type === 'delete_zone') {
                    await api.restorePlanZone(undoState.snapshot);
                  }
                  setUndoState(null);
                  await load();
                } catch (e) {
                  window.alert(e?.message || 'Undo failed');
                }
              }}
              style={{ ...S.btn, ...(!undoState ? {} : S.btnPrimary), padding: '8px 14px', fontSize: 12, opacity: undoState ? 1 : 0.45 }}
            >
              Undo Last
            </button>
          </div>
        )}
      </PageHeader>

      {loadErr && (
        <div className="plan-no-print" style={{ padding: '8px 14px', fontSize: 12, color: '#c0392b' }}>
          {loadErr}
        </div>
      )}
      {clash && dismissedClashKey !== clash.key && (
        <div className="plan-no-print" style={{ margin: '8px 12px 0', padding: 10, borderRadius: 10, border: '1px solid rgba(244,165,26,0.35)', background: 'rgba(244,165,26,0.12)', fontSize: 12, color: T.text, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>⚠️ CLASH DETECTED: {zoneRowLabel(clash.rows[0])} and {zoneRowLabel(clash.rows[1])} both have {clash.activity} on {formatShort(new Date(clash.day + 'T12:00:00'))}.</span>
          <button type="button" onClick={() => setDismissedClashKey(clash.key)} style={{ ...S.btn, padding: '5px 10px', fontSize: 11 }}>DISMISS</button>
        </div>
      )}

      {printHeaderVisible && (
        <div style={{ padding: '12px 14px 8px', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: '0.02em' }}>
            119 HIGH STREET — PROGRAMME WEEK OF {formatShort(new Date(startDate + 'T12:00:00'))} TO{' '}
            {formatShort(new Date(endDate + 'T12:00:00'))} {new Date(endDate + 'T12:00:00').getFullYear()}
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
            Printed {formatShort(new Date())} {new Date().getFullYear()} · {dayColumns.length} day column(s)
          </div>
        </div>
      )}

      <div className="plan-grid-scroll" style={{ flex: 1, overflow: 'auto', padding: '0 12px 16px' }}>
        {zoneBlocks.length === 0 && !loadErr && (
          <div style={{ padding: 40, textAlign: 'center', color: T.faint, fontSize: 13 }}>No programme rows in this range or filters.</div>
        )}
        {viewMode === 'grid' && zoneBlocks.length > 0 && (
          <table
            style={{
              borderCollapse: 'collapse',
              fontSize: isMobile ? 10 : 11,
              minWidth: 480,
              background: T.surface,
              border: `1px solid ${T.hairline}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <thead>
              <tr>
                <th
                  className="plan-zone-col"
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: `1px solid ${T.hairline}`,
                    borderRight: `1px solid ${T.hairline}`,
                    background: T.surface,
                    fontWeight: 700,
                    color: T.text,
                    minWidth: 140,
                    maxWidth: 220,
                    width: 180,
                    position: 'sticky',
                    left: 0,
                    zIndex: 3,
                  }}
                >
                  Zone
                </th>
                {dayColumns.map((dk) => {
                  const d = new Date(dk + 'T12:00:00');
                  const colGrey = isNonWorkingPlanDayKey(dk);
                  const isToday = dk === todayKey && !isNonWorkingPlanDayKey(dk);
                  return (
                    <th
                      key={dk}
                      role="button"
                      tabIndex={0}
                      title="Jump date range to start on this day (same number of columns)"
                      onClick={() => jumpGridToDayColumn(dk)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          jumpGridToDayColumn(dk);
                        }
                      }}
                      style={{
                        padding: '8px 6px',
                        borderBottom: `1px solid ${T.hairline}`,
                        borderLeft: `1px solid ${T.hairline}`,
                        fontWeight: 700,
                        color: T.text,
                        textAlign: 'center',
                        minWidth: 56,
                        maxWidth: 72,
                        background: colGrey ? 'rgba(26,26,46,0.06)' : T.surface,
                        boxShadow: isToday ? `inset 0 3px 0 0 rgba(66,133,244,0.85)` : undefined,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <div>{formatShort(d)}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T.faint }}>{d.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {zoneBlocks.map((z) => (
                <tr key={z.zone_id}>
                  <td
                    className="plan-zone-col"
                    style={{
                      padding: '8px 10px',
                      borderTop: `1px solid ${T.hairline}`,
                      borderRight: `1px solid ${T.hairline}`,
                      fontWeight: 600,
                      color: T.text,
                      verticalAlign: 'top',
                      background: T.surface,
                      lineHeight: 1.25,
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      boxShadow: '4px 0 8px rgba(26,26,46,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span>{zoneRowLabel(z)}</span>
                      {isAdmin && (
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            title="Add activity"
                            style={{ ...S.btn, padding: '2px 6px', fontSize: 11 }}
                            onClick={() => setAddActivityZone(z)}
                          >
                            ＋
                          </button>
                          <button
                            type="button"
                            title="Delete zone"
                            style={{ ...S.btn, ...S.btnDanger, padding: '2px 6px', fontSize: 11 }}
                            onClick={async () => {
                              if (!window.confirm(`Delete ${zoneRowLabel(z)} and all its activities?\nThis cannot be undone.`)) return;
                              try {
                                const out = await api.deletePlanZone(z.zone_id);
                                if (out && out.error) throw new Error(out.error);
                                setUndoState({
                                  type: 'delete_zone',
                                  snapshot: out.snapshot,
                                  label: `Restore deleted zone ${zoneRowLabel(z)}`,
                                  at: new Date().toISOString(),
                                });
                                await load();
                              } catch (e) {
                                window.alert(e?.message || 'Delete zone failed');
                              }
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </div>
                  </td>
                  {dayColumns.map((dk) => {
                    const hits = z.cells[dk] || [];
                    const colGrey = isNonWorkingPlanDayKey(dk);
                    return (
                      <td
                        key={dk}
                        style={{
                          borderTop: `1px solid ${T.hairline}`,
                          borderLeft: `1px solid ${T.hairline}`,
                          padding: 2,
                          verticalAlign: 'top',
                          minHeight: 36,
                          height: 36,
                          background: colGrey ? 'rgba(26,26,46,0.04)' : 'rgba(26,26,46,0.02)',
                        }}
                        onDragOver={(e) => {
                          if (isAdmin && dragState && !isSundayOrBankHolidayKey(dk)) e.preventDefault();
                        }}
                        onDrop={async () => {
                          if (!isAdmin || !dragState) return;
                          if (isSundayOrBankHolidayKey(dk)) {
                            window.alert('Sundays and bank holidays are non-working — drop on another day (Saturdays are allowed for manual placement).');
                            setDragState(null);
                            return;
                          }
                          try {
                            const moved = dragState.item;
                            if (String(moved.status || '').toLowerCase() === 'done') return;
                            if (!window.confirm(`Move ${moved.activity_name} to ${dk}? This will recalculate downstream activities.`)) {
                              setDragState(null);
                              return;
                            }
                            const items = [...dragState.zoneItems].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))).map((x) => ({ ...x }));
                            const idx = items.findIndex((x) => Number(x.id) === Number(moved.id));
                            if (idx < 0) return;
                            const dur = countScheduleableDaysInclusive(items[idx].start_date, items[idx].end_date);
                            items[idx].start_date = normalizeScheduleStartKey(dk);
                            items[idx].end_date = endOfScheduleableSpan(items[idx].start_date, dur);
                            let cursor = nextScheduleableDayKey(items[idx].end_date);
                            for (let i = idx + 1; i < items.length; i++) {
                              const d = countScheduleableDaysInclusive(items[i].start_date, items[i].end_date);
                              items[i].start_date = normalizeScheduleStartKey(cursor);
                              items[i].end_date = endOfScheduleableSpan(items[i].start_date, d);
                              cursor = nextScheduleableDayKey(items[i].end_date);
                            }
                            await applyZoneRows(dragState.zoneId, dragState.zoneItems, items);
                          } catch (e) {
                            window.alert(e?.message || 'Move failed');
                          } finally {
                            setDragState(null);
                          }
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 32 }}>
                          {hits.map((it) => {
                            const done = String(it.status || '').toLowerCase() === 'done';
                            const label = abbrevActivity(it.activity_name);
                            const zLab = zoneRowLabel(z);
                            return (
                              <PlanActivityChip
                                key={it.id}
                                it={it}
                                z={z}
                                dk={dk}
                                isAdmin={isAdmin}
                                done={done}
                                isMobile={isMobile}
                                coarsePointer={coarsePointer}
                                label={label}
                                zoneLabel={zLab}
                                setDragState={setDragState}
                                setInspect={setInspect}
                                onOpenEdit={setChipEdit}
                                applyZoneRows={applyZoneRows}
                              />
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {viewMode === 'drawing' && (
          <div style={{ marginTop: 10, background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 10, overflow: 'hidden' }}>
            {!drawData?.image_data && (
              <div style={{ padding: 30, textAlign: 'center', color: T.faint, fontSize: 12 }}>
                No drawing selected for current scope.
              </div>
            )}
            {drawData?.image_data && (
              <div style={{ position: 'relative', minHeight: 420, background: '#ececf1' }}>
                <img alt="Plan drawing" src={`data:image/jpeg;base64,${drawData.image_data}`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                  {drawZones.map((z) => {
                    const g = parseZoneGeometry(z);
                    if (!g) return null;
                    const hit = zoneDayActivity.get(Number(z.id));
                    const done = String(hit?.status || '').toLowerCase() === 'done';
                    const zi = drawingZoneColorMeta.byId.get(Number(z.id)) ?? 0;
                    const zStyles = planZoneDrawingStyles(zi, { done, active: !!hit });
                    const { fill, stroke, strokeW } = zStyles;
                    const bb = geomBBox(g, z);
                    const cx = bb.cx;
                    const cy = bb.cy;
                    const minDim = Math.min(bb.w, bb.h);
                    const fs = zoneLabelFontSize(bb);
                    const vertical = bb.h > bb.w * 1.15;
                    let shortLabel = '';
                    if (hit?.activity_name) {
                      shortLabel = abbrevActivity(hit.activity_name);
                    } else if (minDim >= 2.4) {
                      const zn = String(z.name || '').trim();
                      shortLabel = zn.length > 10 ? `${zn.slice(0, 9)}…` : zn;
                    }
                    const showText = shortLabel && minDim >= 1.6;
                    const shape = g.kind === 'poly'
                      ? <polygon points={svgPolygonPoints(g)} fill={fill} stroke={stroke} strokeWidth={strokeW} strokeLinejoin="round" />
                      : <rect x={g.x} y={g.y} width={g.w} height={g.h} fill={fill} stroke={stroke} strokeWidth={strokeW} />;
                    const zLab = [String(z.tower || '').trim(), String(z.name || '').trim()].filter(Boolean).join(' ') || 'Zone';
                    return (
                      <g
                        key={z.id}
                        style={{ cursor: coarsePointer && hit ? 'pointer' : 'default' }}
                        onClick={(e) => {
                          if (!coarsePointer || !hit) return;
                          e.stopPropagation();
                          setInspect({ row: hit, zoneLabel: zLab });
                        }}
                        onKeyDown={(e) => {
                          if (!coarsePointer || !hit) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setInspect({ row: hit, zoneLabel: zLab });
                          }
                        }}
                        role={coarsePointer && hit ? 'button' : undefined}
                        tabIndex={coarsePointer && hit ? 0 : undefined}
                      >
                        {shape}
                        {showText && (
                          <text
                            transform={`translate(${cx},${cy}) rotate(${vertical ? -90 : 0})`}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill={hit ? T.text : 'rgba(26,26,46,0.55)'}
                            fontSize={fs}
                            fontWeight="700"
                            stroke="rgba(255,255,255,0.88)"
                            strokeWidth={Math.max(0.04, fs * 0.07)}
                            paintOrder="stroke fill"
                            pointerEvents="none"
                          >
                            {shortLabel}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                <div
                  className="plan-drawing-activity-key"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 2,
                    maxWidth: 'min(340px, 55vw)',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.94)',
                    border: `1px solid ${T.hairline}`,
                    boxShadow: '0 4px 18px rgba(26,26,46,0.12)',
                    pointerEvents: 'none',
                    WebkitPrintColorAdjust: 'exact',
                    printColorAdjust: 'exact',
                  }}
                >
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 }}>
                    Activities — {formatShort(new Date(vizDate + 'T12:00:00'))}
                  </div>
                  {drawingDayLegendEntries.length === 0 ? (
                    <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.4 }}>No programme activity on this drawing for this date.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {drawingDayLegendEntries.map((entry) => {
                        const zi = drawingZoneColorMeta.byId.get(entry.key) ?? 0;
                        const zs = planZoneDrawingStyles(zi, { done: entry.done, active: true });
                        return (
                          <div key={entry.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center', marginTop: 2 }}>
                              <span
                                title="Activity colour"
                                style={{
                                  width: 5,
                                  height: 18,
                                  borderRadius: 2,
                                  background: actColor(entry.activity_name, 0.92),
                                  border: `1px solid ${actColor(entry.activity_name, 1)}`,
                                  WebkitPrintColorAdjust: 'exact',
                                  printColorAdjust: 'exact',
                                }}
                              />
                              <span
                                title="Zone colour on drawing"
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 4,
                                  background: zs.fill,
                                  border: `2px solid ${zs.stroke}`,
                                  boxSizing: 'border-box',
                                  WebkitPrintColorAdjust: 'exact',
                                  printColorAdjust: 'exact',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 11, color: T.text, fontWeight: 600, lineHeight: 1.35 }}>{entry.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: T.faint, marginTop: 8, lineHeight: 1.35 }}>
                    Large square = zone tint on plan (unique per zone). Narrow strip = activity type colour.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {legendVisible && viewMode === 'grid' && legendActs.length > 0 && (
          <div style={{ marginTop: 14, padding: 12, background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Legend
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {legendActs.map((name) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: actColor(name, 0.88), WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                  <span style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: 10, color: T.faint }}>({abbrevActivity(name)})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pdfOpen && (
        <div
          className="plan-no-print"
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
          aria-labelledby="plan-pdf-title"
        >
          <div style={{ width: 'min(400px,100%)', background: T.surface, borderRadius: 14, border: `1px solid ${T.hairline}`, padding: 18, boxShadow: '0 12px 40px rgba(26,26,46,0.15)' }}>
            <div id="plan-pdf-title" style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 12 }}>
              Export Programme to PDF
            </div>
            <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px', lineHeight: 1.45 }}>
              Date range:{' '}
              <strong>{formatShort(new Date(startDate + 'T12:00:00'))}</strong> to{' '}
              <strong>
                {formatShort(new Date(endDate + 'T12:00:00'))} {new Date(endDate + 'T12:00:00').getFullYear()}
              </strong>
              <br />
              Days shown: {calendarDaysBetween(startDate, endDate).length}
            </p>
            <div style={{ fontSize: 12, color: T.text, marginBottom: 10 }}>Include:</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pdfOpts.allZones}
                onChange={(e) => setPdfOpts((o) => ({ ...o, allZones: e.target.checked }))}
              />
              All zones (include rows with no activity in range)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={pdfOpts.legend} onChange={(e) => setPdfOpts((o) => ({ ...o, legend: e.target.checked }))} />
              Legend
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={pdfOpts.header} onChange={(e) => setPdfOpts((o) => ({ ...o, header: e.target.checked }))} />
              Page header
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pdfOpts.showWeekends}
                onChange={(e) => setPdfOpts((o) => ({ ...o, showWeekends: e.target.checked }))}
              />
              Show weekends
            </label>
            <p style={{ fontSize: 10, color: T.faint, margin: '0 0 14px', lineHeight: 1.4 }}>
              Uses your browser print dialog → choose “Save as PDF”. Suggested filename:{' '}
              <code style={{ fontSize: 10 }}>119HS_Programme_{startDate}_{endDate}.pdf</code>
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setPdfOpen(false)} style={{ ...S.btn, padding: '10px 16px' }}>
                Cancel
              </button>
              <button type="button" onClick={confirmPdfExport} style={{ ...S.btn, ...S.btnPrimary, padding: '10px 16px' }}>
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
