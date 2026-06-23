import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as api from './api';
import { actColor, dateKey, formatShort, toHtmlDateInputValue, drawingTabLabel, drawingTabForScope, scopeForRow, buildPermittedScopeTabs, normalizeProgrammeScopeTabs } from './constants';
import { T, S } from './uiTheme';
import PageHeader, { PageFooterHint } from './PageHeader';
import { useRefreshOnFocus, usePollingWhenVisible, formatLastRefreshed } from './useRefreshOnFocus';
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
  asCompletionsMap,
  isProgrammeItemDoneOnDay,
  completionInfoForRowOnDay,
  programmeItemShift,
} from './planUtils';
import { parseZoneGeometry, geomBBox } from './zoneGeom';
import ZoneDrawingCanvas from './ZoneDrawingCanvas';
import './planPrint.css';
import ActivityInspectModal from './ActivityInspectModal';
import ActivityChipEditModal from './ActivityChipEditModal';
import PlanAddActivityModal from './PlanAddActivityModal';
import PlanActivityChip from './PlanActivityChip';
import { clearPrintPageSize, setPrintPageSize, mmToPrintPx, printableAreaPx } from './printPage';

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

/** Sort rank for floor labels: GF = 0, then numeric floors 1, 2, 3… */
function floorSortRank(floor) {
  const s = String(floor || '').toLowerCase().trim();
  if (!s || s === 'gf' || s === 'ground' || s === 'ground floor' || s === 'g/f' || s === 'g') return 0;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

const PDF_PAPER_SIZES = ['A4', 'A3', 'A2', 'A1', 'A0'];

/**
 * Print layout sizing in physical CSS pixels (96 dpi), matching Zone setup A3
 * print geometry — not getBoundingClientRect. Row height matches the rendered
 * grid cell (36px) so capacity tracks what actually fits per sheet.
 */
const PRINT_ROW_PX = 28;
const PRINT_TABLE_HEAD_PX = mmToPrintPx(13);
const PRINT_PAGE_TITLE_PX = mmToPrintPx(14);
const PRINT_LEGEND_PX = mmToPrintPx(14);
const PRINT_ZONE_COL_PX = mmToPrintPx(32);
const PRINT_DAY_COL_PX = mmToPrintPx(9);

/**
 * Derive how many zone rows and day columns fit on one sheet from the physical
 * printable area minus per-page chrome (title, table head, colour key).
 */
function paperCapacity(paper, orientation, { includeHeader = true, includeLegend = true } = {}) {
  const { widthPx, heightPx } = printableAreaPx(paper, orientation);
  let overheadPx = PRINT_TABLE_HEAD_PX;
  if (includeHeader) overheadPx += PRINT_PAGE_TITLE_PX;
  if (includeLegend) overheadPx += PRINT_LEGEND_PX;
  const cols = Math.max(1, Math.floor((widthPx - PRINT_ZONE_COL_PX) / (PRINT_DAY_COL_PX * 2)));
  const rows = Math.max(1, Math.floor((heightPx - overheadPx) / PRINT_ROW_PX));
  return { rows, cols };
}

/** Uniform cell sizes for a chosen rows × columns layout on the printable area. */
function printGridGeometry(
  paper,
  orientation,
  rowsPerPage,
  colsPerPage,
  { includeHeader = true, includeLegend = true } = {}
) {
  const { widthPx, heightPx } = printableAreaPx(paper, orientation);
  let overheadPx = PRINT_TABLE_HEAD_PX;
  if (includeHeader) overheadPx += PRINT_PAGE_TITLE_PX;
  if (includeLegend) overheadPx += PRINT_LEGEND_PX;
  const rows = Math.max(1, sanitizePerPage(rowsPerPage, 1));
  const cols = Math.max(1, sanitizePerPage(colsPerPage, 1));
  const rowPx = Math.max(16, Math.floor((heightPx - overheadPx) / rows));
  const zoneColPx = PRINT_ZONE_COL_PX;
  const dayColPx = Math.max(10, Math.floor((widthPx - zoneColPx) / (cols * 2)));
  return { rowPx, zoneColPx, dayColPx, rows, cols };
}

function sanitizePerPage(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(400, Math.round(n)));
}

function sanitizeRowsPerPage(value) {
  return sanitizePerPage(value, 25);
}

function chunkArray(items, size) {
  const n = Math.max(1, Math.round(Number(size) || 1));
  const chunks = [];
  for (let i = 0; i < items.length; i += n) {
    chunks.push(items.slice(i, i + n));
  }
  return chunks.length ? chunks : [[]];
}

function formatPrintDayHeader(dayKey) {
  const d = new Date(dayKey + 'T12:00:00');
  const D = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return `${D[d.getDay()]} ${d.getDate()}`;
}

function legendActsForPage(pageRows, pageCols) {
  const names = new Set();
  for (const z of pageRows) {
    for (const dk of pageCols) {
      for (const it of z.cells[dk] || []) {
        if (it.activity_name) names.add(it.activity_name);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
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

export default function PlanPage({ tab, userTabs, isAdmin, canTick, userName, selectedTabs, onSelectedTabsChange }) {
  const [rows, setRows] = useState([]);
  const [comp, setComp] = useState({});
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

  /** Explicit selected drawing tabs (multi-select); persisted in App via localStorage. */
  /** null = all towers; otherwise whitelist */
  const [towerWhitelist, setTowerWhitelist] = useState(null);
  /** null = all floors; otherwise Set of drawing_floor strings */
  const [floorWhitelist, setFloorWhitelist] = useState(null);

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfOpts, setPdfOpts] = useState({
    allZones: true,
    legend: true,
    header: true,
    showWeekends: true,
    paper: 'A3',
    orientation: 'landscape',
    fit_to_paper: true,
    rows_per_page: 25,
    cols_per_page: 20,
  });

  /** Active during print preview + print dialog */
  const [printLayout, setPrintLayout] = useState(null);
  const printPendingRef = useRef(false);
  const [dragState, setDragState] = useState(null);
  const [undoState, setUndoState] = useState(null);
  const [dismissedClashKey, setDismissedClashKey] = useState('');

  const titleRestore = useRef(typeof document !== 'undefined' ? document.title : '');
  const isMobile = useIsMobile();
  const [inspect, setInspect] = useState(null);
  const [chipEdit, setChipEdit] = useState(null);
  const [addActivityZone, setAddActivityZone] = useState(null);
  const [projectProgrammeItems, setProjectProgrammeItems] = useState([]);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [, setRefreshLabelTick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const fn = () => setCoarsePointer(!!mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadErr('');
    try {
      let data;
      let completionsRaw;
      if (isAdmin) {
        [data, completionsRaw] = await Promise.all([
          api.getPlanProgrammeFullExport().then((d) => (Array.isArray(d) ? d : api.getPlanProgramme())),
          api.getCompletions(),
        ]);
        if (!Array.isArray(data)) data = await api.getPlanProgramme();
      } else {
        [data, completionsRaw] = await Promise.all([
          api.getPlanProgramme(),
          api.getCompletions(),
        ]);
      }
      setRows(Array.isArray(data) ? data : []);
      setComp(asCompletionsMap(completionsRaw));
      setLastRefreshed(new Date());
    } catch (e) {
      if (!silent) {
        setLoadErr(e?.message || 'Failed to load programme');
        setRows([]);
      }
    }
  }, [isAdmin]);

  const reloadCompletions = useCallback(async () => {
    try {
      const completionsRaw = await api.getCompletions();
      setComp(asCompletionsMap(completionsRaw));
    } catch (_) {}
  }, []);

  const silentRefresh = useCallback(() => load({ silent: true }), [load]);

  useRefreshOnFocus(silentRefresh);
  usePollingWhenVisible(silentRefresh, 45000);

  useEffect(() => {
    if (!lastRefreshed) return undefined;
    const id = setInterval(() => setRefreshLabelTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [lastRefreshed]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.getActivities().then((a) => setActivities(Array.isArray(a) ? a : []));
  }, []);

  useEffect(() => {
    api.getProjectProgrammeItems().then((d) => setProjectProgrammeItems(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    api.getDrawings().then((d) => setDrawings(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    function afterPrint() {
      document.body.classList.remove('plan-print-mode');
      document.title = titleRestore.current || '119HS';
      setPrintLayout(null);
      clearPrintPageSize();
    }
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);

  const permittedTabs = useMemo(
    () => buildPermittedScopeTabs({ userTabs, planRows: rows, isAdmin }),
    [isAdmin, userTabs, rows]
  );

  useEffect(() => {
    if (!permittedTabs.length) return;
    onSelectedTabsChange((prev) => {
      const normPrev = normalizeProgrammeScopeTabs(prev);
      const kept = normPrev.filter((t) => permittedTabs.includes(t));
      if (kept.length) return permittedTabs.filter((t) => kept.includes(t));
      return [permittedTabs[0]];
    });
  }, [permittedTabs, onSelectedTabsChange]);

  const selectedSet = useMemo(() => new Set(selectedTabs), [selectedTabs]);

  const dependencyPickerOptions = useMemo(() => {
    const opts = [];
    const seen = new Set();
    for (const r of rows) {
      const key = `programme_item:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({
        type: 'programme_item',
        id: Number(r.id),
        label: [r.tower, r.zone_name, r.activity_name].filter(Boolean).join(' — '),
      });
    }
    for (const p of projectProgrammeItems) {
      opts.push({
        type: 'project_programme_item',
        id: Number(p.id),
        label: `Project — ${p.name}`,
      });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, projectProgrammeItems]);

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
      const dt = scopeForRow(r);
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
      if (floorWhitelist !== null) {
        const fl = String(r.drawing_floor || '').trim();
        if (!floorWhitelist.has(fl)) return false;
      }
      return true;
    });
  }, [rowsForScope, towerWhitelist, floorWhitelist]);

  const towersInView = useMemo(() => {
    const s = new Set();
    rowsForScope.forEach((r) => {
      const tw = String(r.tower || '').trim();
      if (tw) s.add(tw);
    });
    return [...s].sort();
  }, [rowsForScope]);

  const floorsInView = useMemo(() => {
    const s = new Set();
    rowsForScope.forEach((r) => {
      const fl = String(r.drawing_floor || '').trim();
      if (fl) s.add(fl);
    });
    return [...s].sort((a, b) => floorSortRank(a) - floorSortRank(b));
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

  useEffect(() => {
    const valid = new Set(floorsInView);
    setFloorWhitelist((prev) => {
      if (prev === null) return null;
      const next = new Set([...prev].filter((f) => valid.has(f)));
      if (next.size === 0) return null;
      if (next.size === valid.size) return null;
      return next;
    });
  }, [floorsInView]);

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

  /** Drawing tabs that the currently selected scopes read (Module Programme reuses Module Handover drawings). */
  const selectedDrawingTabs = useMemo(
    () => new Set([...selectedSet].map((s) => drawingTabForScope(s))),
    [selectedSet]
  );
  const permittedDrawingTabs = useMemo(
    () => new Set(permittedTabs.map((s) => drawingTabForScope(s))),
    [permittedTabs]
  );

  const drawingOptions = useMemo(() => {
    return (drawings || []).filter((d) => {
      const t = String(d.tab || '').trim();
      if (!permittedDrawingTabs.has(t)) return false;
      if (!selectedDrawingTabs.has(t)) return false;
      return true;
    });
  }, [drawings, permittedDrawingTabs, selectedDrawingTabs]);

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
      const curDone = isProgrammeItemDoneOnDay(cur, vizDate, comp);
      const nextDone = isProgrammeItemDoneOnDay(r, vizDate, comp);
      if (curDone && !nextDone) {
        by.set(id, r);
        continue;
      }
      if (String(r.start_date) < String(cur.start_date)) by.set(id, r);
    }
    return by;
  }, [filteredRows, vizDate, comp]);

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
      const done = isProgrammeItemDoneOnDay(r, vizDate, comp);
      out.push({ key: zid, label, activity_name: r.activity_name, done });
    });
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [zoneDayActivity, drawZones, vizDate, comp]);

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
      // Always work on a fresh copy — when prev === null (all towers) we must not
      // mutate `full`, otherwise the size check below always matches and resets to all.
      const cur = new Set(prev === null ? full : prev);
      if (cur.has(tw)) cur.delete(tw);
      else cur.add(tw);
      if (cur.size === 0) return null;
      if (cur.size === full.size) return null;
      return cur;
    });
  }

  function selectAllTowers() {
    setTowerWhitelist(null);
  }

  function toggleFloor(fl) {
    setFloorWhitelist((prev) => {
      const full = new Set(floorsInView);
      const cur = new Set(prev === null ? full : prev);
      if (cur.has(fl)) cur.delete(fl);
      else cur.add(fl);
      if (cur.size === 0) return null;
      if (cur.size === full.size) return null;
      return cur;
    });
  }

  function selectAllFloors() {
    setFloorWhitelist(null);
  }

  function toggleProgrammeTab(t) {
    onSelectedTabsChange((prev) => {
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
    onSelectedTabsChange([...permittedTabs]);
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
        shift: programmeItemShift(r),
      };
    });
    const out = await api.replacePlanZoneItems(zoneId, payload);
    if (out && out.error) {
      throw new Error(out.message || out.error);
    }
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
        shift: programmeItemShift(r),
      })),
    });
    await load();
  }

  const toggleItemShift = useCallback(async (it) => {
    const prev = programmeItemShift(it);
    const next = prev === 'night' ? 'day' : 'night';
    setRows((prevRows) =>
      prevRows.map((r) => (Number(r.id) === Number(it.id) ? { ...r, shift: next } : r))
    );
    try {
      const out = await api.updateProgrammeItem(it.id, { shift: next });
      if (out?.error) throw new Error(out.error);
    } catch (e) {
      setRows((prevRows) =>
        prevRows.map((r) => (Number(r.id) === Number(it.id) ? { ...r, shift: prev } : r))
      );
      window.alert(e?.message || 'Shift update failed');
    }
  }, []);

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
    const paper = layout?.paper || pdfOpts.paper || 'A3';
    const orientation = layout?.orientation || pdfOpts.orientation || 'landscape';
    const printSize = setPrintPageSize({ paper, orientation });
    document.body.dataset.planPrintPaper = printSize.paper;
    document.body.dataset.planPrintOrientation = printSize.orientation;
    titleRestore.current = document.title;
    document.title = `119HS_Programme_${startDate}_${endDate}`;
    printPendingRef.current = true;
    setPrintLayout(layout);
    document.body.classList.add('plan-print-mode');
  }

  function printLayoutFromOpts(extra) {
    const cap = paperCapacity(pdfOpts.paper, pdfOpts.orientation, {
      includeHeader: pdfOpts.header,
      includeLegend: pdfOpts.legend,
    });
    const rowsPerPage = pdfOpts.fit_to_paper ? cap.rows : sanitizePerPage(pdfOpts.rows_per_page, cap.rows);
    const colsPerPage = pdfOpts.fit_to_paper ? cap.cols : sanitizePerPage(pdfOpts.cols_per_page, cap.cols);
    const geometry = printGridGeometry(pdfOpts.paper, pdfOpts.orientation, rowsPerPage, colsPerPage, {
      includeHeader: pdfOpts.header,
      includeLegend: pdfOpts.legend,
    });
    return {
      showWeekends: pdfOpts.showWeekends,
      legend: pdfOpts.legend,
      header: pdfOpts.header,
      paper: pdfOpts.paper,
      orientation: pdfOpts.orientation,
      rowsPerPage,
      colsPerPage,
      geometry,
      ...extra,
    };
  }

  function handlePrintClick() {
    setPdfOpen(true);
  }

  function confirmPrint() {
    setPdfOpen(false);
    runPrint(printLayoutFromOpts({ emptyZones: false }));
  }

  function confirmPdfExport() {
    setPdfOpen(false);
    runPrint(printLayoutFromOpts({ emptyZones: pdfOpts.allZones }));
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

  const legendVisible = printLayout == null || printLayout.legend;
  const autoCapacity = paperCapacity(pdfOpts.paper, pdfOpts.orientation, {
    includeHeader: pdfOpts.header,
    includeLegend: pdfOpts.legend,
  });
  const activeRowsPerPage = sanitizePerPage(printLayout?.rowsPerPage ?? pdfOpts.rows_per_page, autoCapacity.rows);
  const activeColsPerPage = sanitizePerPage(printLayout?.colsPerPage ?? pdfOpts.cols_per_page, autoCapacity.cols);
  const printGeometry =
    printLayout?.geometry ||
    printGridGeometry(pdfOpts.paper, pdfOpts.orientation, activeRowsPerPage, activeColsPerPage, {
      includeHeader: pdfOpts.header,
      includeLegend: pdfOpts.legend,
    });
  /**
   * Each printed sheet is a (row-chunk × column-chunk) tile so neither zones
   * nor day columns ever overflow a page. On screen (no printLayout) the whole
   * grid stays as a single scrollable table.
   */
  const printPages = useMemo(() => {
    if (!printLayout) return [{ rows: zoneBlocks, cols: dayColumns }];
    const rowChunks = chunkArray(zoneBlocks, activeRowsPerPage);
    const colChunks = chunkArray(dayColumns, activeColsPerPage);
    const pages = [];
    for (const rows of rowChunks) {
      for (const cols of colChunks) {
        pages.push({ rows, cols });
      }
    }
    return pages.length ? pages : [{ rows: zoneBlocks, cols: dayColumns }];
  }, [zoneBlocks, dayColumns, printLayout, activeRowsPerPage, activeColsPerPage]);

  /** Wait for paginated DOM before opening the print dialog. */
  useEffect(() => {
    if (!printLayout || !printPendingRef.current) return undefined;
    printPendingRef.current = false;
    const id = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(id);
  }, [printLayout, printPages.length]);

  const clash = useMemo(() => detectClash(rows), [rows]);

  const headerSummaryChips = useMemo(() => {
    const scopeLabels = selectedTabs.map((t) => drawingTabLabel(t));
    const scope = scopeLabels.length ? scopeLabels.join(' + ') : '—';
    const dayCount = calendarDaysBetween(startDate, endDate).length;
    const windowLabel = preset !== 'custom' ? `${preset}d` : `${dayCount}d`;
    const towersLabel =
      towerWhitelist === null
        ? 'All towers'
        : `${towerWhitelist.size} tower${towerWhitelist.size === 1 ? '' : 's'}`;
    return [scope, windowLabel, towersLabel];
  }, [selectedTabs, preset, startDate, endDate, towerWhitelist]);

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
        completionDayKey={chipEdit?.dayKey}
        comp={comp}
        canTick={canTick}
        userName={userName}
        isAdmin={isAdmin}
        pickerOptions={dependencyPickerOptions}
        onCompletionChange={reloadCompletions}
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
        className="plan-no-print page-header--plan"
        collapsible
        collapsibleSummary={headerSummaryChips}
        title="Plan"
        toggles={
          <div className="page-header__toggle-group">
            <button type="button" onClick={() => setViewMode('grid')} style={{ ...S.btn, ...(viewMode === 'grid' ? S.btnAct : {}), padding: '6px 10px', fontSize: 11 }}>Grid</button>
            <button type="button" onClick={() => setViewMode('drawing')} style={{ ...S.btn, ...(viewMode === 'drawing' ? S.btnAct : {}), padding: '6px 10px', fontSize: 11 }}>Drawing</button>
          </div>
        }
        actions={
          <>
            {lastRefreshed && (
              <span style={{ fontSize: 10, color: T.faint, whiteSpace: 'nowrap', alignSelf: 'center' }}>
                {formatLastRefreshed(lastRefreshed)}
              </span>
            )}
            {isMobile && (
              <span className="plan-header-print-note" style={{ fontSize: 10, color: T.muted, maxWidth: 220, lineHeight: 1.35 }}>
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

            {floorsInView.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: T.muted }}>Floor</span>
                <button type="button" onClick={selectAllFloors} style={{ ...S.btn, padding: '6px 10px', fontSize: 11 }}>
                  All floors
                </button>
                {floorsInView.map((fl) => {
                  const active = floorWhitelist === null || floorWhitelist.has(fl);
                  return (
                    <button
                      key={fl}
                      type="button"
                      onClick={() => toggleFloor(fl)}
                      style={{ ...S.btn, ...(active ? S.btnAct : {}), padding: '6px 10px', fontSize: 11, opacity: active ? 1 : 0.55 }}
                    >
                      {fl}
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

            {isAdmin && (
              <div className="plan-header-undo" style={{ marginTop: 4, padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.hairline}`, background: 'rgba(66,133,244,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%' }}>
                <div style={{ minWidth: 140 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Undo
                  </div>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>
                    {undoState?.label || 'No undo snapshot yet'}
                  </div>
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
                  style={{ ...S.btn, ...(!undoState ? {} : S.btnPrimary), padding: '6px 12px', fontSize: 11, opacity: undoState ? 1 : 0.45 }}
                >
                  Undo last
                </button>
              </div>
            )}
          </>
        }
      />

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

      <div className="plan-grid-area">
      <div className="plan-grid-scroll">
        {zoneBlocks.length === 0 && !loadErr && (
          <div style={{ padding: 40, textAlign: 'center', color: T.faint, fontSize: 13 }}>No programme rows in this range or filters.</div>
        )}
        {viewMode === 'grid' && zoneBlocks.length > 0 && (
          <>
            {printPages.map((page, pageIndex, pages) => {
              const pageRows = page.rows;
              const pageCols = page.cols;
              const pageLegendActs = printLayout ? legendActsForPage(pageRows, pageCols) : legendActs;
              const isLastPrintPage = pageIndex === pages.length - 1;
              const pageRowLabel =
                printLayout && pageRows.length
                  ? `${zoneRowLabel(pageRows[0])} – ${zoneRowLabel(pageRows[pageRows.length - 1])}`
                  : '';
              const pageColLabel =
                printLayout && pageCols.length
                  ? `${formatPrintDayHeader(pageCols[0])} – ${formatPrintDayHeader(pageCols[pageCols.length - 1])}`
                  : '';
              return (
                <div
                  key={`plan-print-page-${pageIndex}`}
                  className={printLayout ? `plan-print-page${isLastPrintPage ? ' plan-print-page--last' : ''}` : undefined}
                  style={
                    printLayout
                      ? {
                          '--plan-print-row-px': `${printGeometry.rowPx}px`,
                          '--plan-print-day-col-px': `${printGeometry.dayColPx}px`,
                          '--plan-print-zone-col-px': `${printGeometry.zoneColPx}px`,
                        }
                      : undefined
                  }
                >
                  {printLayout && printLayout.header && (
                    <div className="plan-print-page-header" style={{ padding: '0 0 6px' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: '0.02em' }}>
                        119 HIGH STREET — PROGRAMME WEEK OF {formatShort(new Date(startDate + 'T12:00:00'))} TO{' '}
                        {formatShort(new Date(endDate + 'T12:00:00'))} {new Date(endDate + 'T12:00:00').getFullYear()}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                        Printed {formatShort(new Date())} {new Date().getFullYear()}
                        {pages.length > 1 ? ` · Sheet ${pageIndex + 1} of ${pages.length}` : ''}
                        {pageRowLabel ? ` · ${pageRows.length} zone(s): ${pageRowLabel}` : ''}
                        {pageColLabel ? ` · ${pageColLabel}` : ''}
                      </div>
                    </div>
                  )}
                  <table
                    className="plan-grid-table"
                    style={{
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                      fontSize: isMobile ? 10 : 11,
                      minWidth: printLayout ? '100%' : 480,
                      width: printLayout ? '100%' : undefined,
                      tableLayout: printLayout ? 'fixed' : undefined,
                      background: T.surface,
                      border: `1px solid ${T.hairline}`,
                      borderRadius: 8,
                    }}
                  >
                    {printLayout && (
                      <colgroup>
                        <col className="plan-print-zone-col" />
                        {pageCols.map((dk) => (
                          <React.Fragment key={dk}>
                            <col className="plan-print-day-col plan-print-day-col--day" />
                            <col className="plan-print-day-col plan-print-day-col--night" />
                          </React.Fragment>
                        ))}
                      </colgroup>
                    )}
                    <thead className="plan-date-head">
                      <tr>
                        <th
                          rowSpan={2}
                          className="plan-zone-col plan-zone-col--head"
                          style={{
                            textAlign: 'left',
                            padding: printLayout ? '2px 4px' : '8px 10px',
                            borderBottom: `1px solid ${T.hairline}`,
                            borderRight: `1px solid ${T.hairline}`,
                            background: T.surface,
                            fontWeight: 700,
                            color: T.text,
                            minWidth: printLayout ? undefined : 140,
                            maxWidth: printLayout ? undefined : 220,
                            width: printLayout ? undefined : 180,
                            verticalAlign: 'middle',
                          }}
                        >
                          Zone
                        </th>
                        {pageCols.map((dk) => {
                          const d = new Date(dk + 'T12:00:00');
                          const colGrey = isNonWorkingPlanDayKey(dk);
                          const isToday = dk === todayKey && !isNonWorkingPlanDayKey(dk);
                          return (
                            <th
                              key={dk}
                              colSpan={2}
                              className="plan-date-col"
                              role={printLayout ? undefined : 'button'}
                              tabIndex={printLayout ? undefined : 0}
                              title={printLayout ? formatShort(d) : 'Jump date range to start on this day (same number of columns)'}
                              onClick={printLayout ? undefined : () => jumpGridToDayColumn(dk)}
                              onKeyDown={
                                printLayout
                                  ? undefined
                                  : (ev) => {
                                      if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault();
                                        jumpGridToDayColumn(dk);
                                      }
                                    }
                              }
                              style={{
                                padding: printLayout ? '2px 1px' : '8px 6px',
                                borderBottom: `1px solid ${T.hairline}`,
                                borderLeft: `1px solid ${T.hairline}`,
                                fontWeight: 700,
                                color: T.text,
                                textAlign: 'center',
                                minWidth: printLayout ? undefined : 112,
                                background: colGrey ? 'rgba(26,26,46,0.06)' : T.surface,
                                boxShadow: !printLayout && isToday ? `inset 0 3px 0 0 rgba(66,133,244,0.85)` : undefined,
                                cursor: printLayout ? 'default' : 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              {printLayout ? formatPrintDayHeader(dk) : (
                                <>
                                  <div>{formatShort(d)}</div>
                                  <div style={{ fontSize: 9, fontWeight: 600, color: T.faint }}>{d.getDate()}</div>
                                </>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                      <tr className="plan-shift-head">
                        {pageCols.map((dk) => {
                          const colGrey = isNonWorkingPlanDayKey(dk);
                          const subHeadStyle = {
                            padding: printLayout ? '1px 1px' : '3px 2px',
                            borderBottom: `1px solid ${T.hairline}`,
                            borderLeft: `1px solid ${T.hairline}`,
                            fontWeight: 600,
                            fontSize: printLayout ? 7 : 9,
                            color: T.faint,
                            textAlign: 'center',
                            minWidth: printLayout ? undefined : 28,
                            background: colGrey ? 'rgba(26,26,46,0.06)' : T.surface,
                            userSelect: 'none',
                          };
                          return (
                            <React.Fragment key={`${dk}-shift-head`}>
                              <th className="plan-shift-col plan-shift-col--day" style={subHeadStyle}>
                                Day
                              </th>
                              <th
                                className="plan-shift-col plan-shift-col--night"
                                style={{ ...subHeadStyle, background: colGrey ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.08)' }}
                              >
                                Night
                              </th>
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((z) => (
                        <tr key={z.zone_id}>
                          <td
                            className="plan-zone-col"
                            style={{
                              padding: printLayout ? '2px 4px' : '8px 10px',
                              borderTop: `1px solid ${T.hairline}`,
                              borderRight: `1px solid ${T.hairline}`,
                              fontWeight: 600,
                              color: T.text,
                              verticalAlign: 'middle',
                              background: T.surface,
                              lineHeight: 1.2,
                              height: printLayout ? printGeometry.rowPx : undefined,
                              maxHeight: printLayout ? printGeometry.rowPx : undefined,
                              overflow: printLayout ? 'hidden' : undefined,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                overflow: printLayout ? 'hidden' : undefined,
                                whiteSpace: printLayout ? 'nowrap' : undefined,
                                textOverflow: printLayout ? 'ellipsis' : undefined,
                              }}
                            >
                              <span title={printLayout ? zoneRowLabel(z) : undefined}>{zoneRowLabel(z)}</span>
                              {isAdmin && !printLayout && (
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
                          {pageCols.flatMap((dk) => {
                            const allHits = z.cells[dk] || [];
                            const colGrey = isNonWorkingPlanDayKey(dk);
                            const renderShiftCell = (shiftKey) => {
                              const hits = allHits.filter((it) => programmeItemShift(it) === shiftKey);
                              const isNight = shiftKey === 'night';
                              const cellClass = [
                                printLayout ? 'plan-print-day-cell' : '',
                                isNight ? 'plan-day-cell--night' : 'plan-day-cell--day',
                              ]
                                .filter(Boolean)
                                .join(' ');
                              const baseBg = colGrey
                                ? 'rgba(26,26,46,0.04)'
                                : isNight
                                  ? 'rgba(0,0,0,0.08)'
                                  : 'rgba(26,26,46,0.02)';
                              return (
                                <td
                                  key={`${dk}-${shiftKey}`}
                                  className={cellClass || undefined}
                                  style={{
                                    borderTop: `1px solid ${T.hairline}`,
                                    borderLeft: `1px solid ${T.hairline}`,
                                    padding: printLayout ? 1 : 2,
                                    verticalAlign: 'middle',
                                    height: printLayout ? printGeometry.rowPx : 36,
                                    maxHeight: printLayout ? printGeometry.rowPx : 36,
                                    minHeight: printLayout ? printGeometry.rowPx : 36,
                                    overflow: printLayout ? 'hidden' : undefined,
                                    background: baseBg,
                                    WebkitPrintColorAdjust: 'exact',
                                    printColorAdjust: 'exact',
                                  }}
                                  onDragOver={(e) => {
                                    if (isAdmin && dragState && !isSundayOrBankHolidayKey(dk)) e.preventDefault();
                                  }}
                                  onDrop={async () => {
                                    if (!isAdmin || !dragState) return;
                                    if (isSundayOrBankHolidayKey(dk)) {
                                      window.alert('Bank holidays are non-working — drop on another day.');
                                      setDragState(null);
                                      return;
                                    }
                                    try {
                                      const moved = dragState.item;
                                      if (String(moved.status || '').toLowerCase() === 'done') return;
                                      const shiftLabel = shiftKey === 'night' ? 'night' : 'day';
                                      if (!window.confirm(`Move ${moved.activity_name} to ${dk} (${shiftLabel} shift)?`)) {
                                        setDragState(null);
                                        return;
                                      }
                                      const items = [...dragState.zoneItems].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))).map((x) => ({ ...x }));
                                      const idx = items.findIndex((x) => Number(x.id) === Number(moved.id));
                                      if (idx < 0) return;
                                      const dur = countScheduleableDaysInclusive(items[idx].start_date, items[idx].end_date);
                                      items[idx].start_date = normalizeScheduleStartKey(dk);
                                      items[idx].end_date = endOfScheduleableSpan(items[idx].start_date, dur);
                                      items[idx].shift = shiftKey;
                                      await applyZoneRows(dragState.zoneId, dragState.zoneItems, items);
                                    } catch (e) {
                                      window.alert(e?.message || 'Move failed');
                                    } finally {
                                      setDragState(null);
                                    }
                                  }}
                                >
                                  <div
                                    className={printLayout ? 'plan-print-cell-inner' : undefined}
                                    style={printLayout ? undefined : { display: 'flex', flexDirection: 'column', gap: 2, minHeight: 32 }}
                                  >
                                    {hits.map((it) => {
                                      const done = isProgrammeItemDoneOnDay(it, dk, comp);
                                      const label = abbrevActivity(it.activity_name);
                                      const zLab = zoneRowLabel(z);
                                      const compInfo = done ? completionInfoForRowOnDay(it, dk, comp) : null;
                                      return (
                                        <PlanActivityChip
                                          key={it.id}
                                          it={it}
                                          z={z}
                                          dk={dk}
                                          isAdmin={isAdmin}
                                          done={done}
                                          completionAt={printLayout ? undefined : compInfo ? [compInfo.date, compInfo.at].filter(Boolean).join(' ') : undefined}
                                          isMobile={isMobile}
                                          coarsePointer={coarsePointer}
                                          label={label}
                                          zoneLabel={zLab}
                                          compact={!!printLayout}
                                          hasDependency={false}
                                          setDragState={setDragState}
                                          setInspect={setInspect}
                                          onOpenEdit={setChipEdit}
                                          applyZoneRows={applyZoneRows}
                                          onShiftToggle={isAdmin && !printLayout ? toggleItemShift : undefined}
                                        />
                                      );
                                    })}
                                  </div>
                                </td>
                              );
                            };
                            return ['day', 'night'].map(renderShiftCell);
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {printLayout && legendVisible && pageLegendActs.length > 0 && (
                    <div className="plan-print-compact-key" style={{ marginTop: 6, padding: '5px 6px', background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 4 }}>
                      <div className="plan-print-compact-key__items">
                        <span className="plan-print-compact-key__title">Key</span>
                        {pageLegendActs.map((name) => (
                          <span key={name} title={name} className="plan-print-compact-key__item">
                            <span className="plan-print-compact-key__swatch" style={{ background: actColor(name, 0.88) }} />
                            <span>{abbrevActivity(name)}</span>
                            <span className="plan-print-compact-key__full"> — {name}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
        {viewMode === 'drawing' && (
          <div style={{ marginTop: 10, background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 10, overflow: 'hidden' }}>
            <ZoneDrawingCanvas
              drawing={drawData}
              zones={drawZones}
              coarsePointer={coarsePointer}
              enableZoomPan
              minHeight="min(72vh, 640px)"
              emptyMessage="No drawing selected for current scope."
              styleForZone={(z) => {
                const hit = zoneDayActivity.get(Number(z.id));
                const done = isProgrammeItemDoneOnDay(hit, vizDate, comp);
                const zi = drawingZoneColorMeta.byId.get(Number(z.id)) ?? 0;
                return planZoneDrawingStyles(zi, { done, active: !!hit });
              }}
              labelForZone={(z) => {
                const hit = zoneDayActivity.get(Number(z.id));
                const g = parseZoneGeometry(z);
                if (!g) return '';
                const bb = geomBBox(g, z);
                const minDim = Math.min(bb.w, bb.h);
                if (hit?.activity_name) return abbrevActivity(hit.activity_name);
                if (minDim >= 2.4) {
                  const zn = String(z.name || '').trim();
                  return zn.length > 10 ? `${zn.slice(0, 9)}…` : zn;
                }
                return '';
              }}
              labelActiveForZone={(z) => !!zoneDayActivity.get(Number(z.id))}
              onZoneClick={(z) => {
                const hit = zoneDayActivity.get(Number(z.id));
                if (!hit) return;
                const zLab = [String(z.tower || '').trim(), String(z.name || '').trim()].filter(Boolean).join(' ') || 'Zone';
                setInspect({ row: hit, zoneLabel: zLab });
              }}
              legend={
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
              }
            />
          </div>
        )}

        {!printLayout && legendVisible && viewMode === 'grid' && legendActs.length > 0 && (
          <div className="plan-grid-legend">
            <span className="plan-grid-legend__title">Key</span>
            <div className="plan-grid-legend__items">
              {legendActs.map((name) => (
                <span key={name} className="plan-grid-legend__item" title={name}>
                  <span className="plan-grid-legend__swatch" style={{ background: actColor(name, 0.88) }} />
                  <span>{abbrevActivity(name)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {!printLayout && (
        <PageFooterHint>
          Grey = bank holidays; Sat/Sun are available for programme work.
          {viewMode === 'grid'
            ? ' ← → step days; click a date header to jump the window.'
            : ' Scroll to zoom; drag to pan the drawing.'}
          {isAdmin ? ' Admin: ＋ add, drag to move (day/night column sets shift), click to toggle shift, double-click (long-press) to edit.' : ''}
        </PageFooterHint>
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
          <div style={{ width: 'min(460px,100%)', background: T.surface, borderRadius: 14, border: `1px solid ${T.hairline}`, padding: 18, boxShadow: '0 12px 40px rgba(26,26,46,0.15)' }}>
            <div id="plan-pdf-title" style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 12 }}>
              Print &amp; export options
            </div>
            <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px', lineHeight: 1.45 }}>
              Date range:{' '}
              <strong>{formatShort(new Date(startDate + 'T12:00:00'))}</strong> to{' '}
              <strong>
                {formatShort(new Date(endDate + 'T12:00:00'))} {new Date(endDate + 'T12:00:00').getFullYear()}
              </strong>
              <br />
              Days shown: {calendarDaysBetween(startDate, endDate).length}
              <br />
              Print uses initials and colours only (see key on every sheet). Turn on <strong>Background graphics</strong> in the print dialog so colours print correctly.
            </p>
            <div style={{ fontSize: 12, color: T.text, marginBottom: 10 }}>Include:</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: T.text, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pdfOpts.allZones}
                onChange={(e) => setPdfOpts((o) => ({ ...o, allZones: e.target.checked }))}
              />
              <span>All zones (include rows with no activity in range)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: T.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={pdfOpts.legend} onChange={(e) => setPdfOpts((o) => ({ ...o, legend: e.target.checked }))} />
              <span>Legend</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: T.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={pdfOpts.header} onChange={(e) => setPdfOpts((o) => ({ ...o, header: e.target.checked }))} />
              <span>Page header</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12, color: T.text, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pdfOpts.showWeekends}
                onChange={(e) => setPdfOpts((o) => ({ ...o, showWeekends: e.target.checked }))}
              />
              <span>Show weekends</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>Paper</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {PDF_PAPER_SIZES.map((paper) => (
                    <button
                      key={paper}
                      type="button"
                      onClick={() => setPdfOpts((o) => ({ ...o, paper }))}
                      style={{ ...S.btn, ...(pdfOpts.paper === paper ? S.btnAct : {}), flex: '1 0 auto', minWidth: 40, padding: '7px 10px', fontSize: 12 }}
                    >
                      {paper}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>Orientation</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    ['landscape', 'Landscape'],
                    ['portrait', 'Portrait'],
                  ].map(([orientation, label]) => (
                    <button
                      key={orientation}
                      type="button"
                      onClick={() => setPdfOpts((o) => ({ ...o, orientation }))}
                      style={{ ...S.btn, ...(pdfOpts.orientation === orientation ? S.btnAct : {}), flex: 1, padding: '7px 10px', fontSize: 12 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4 }}>Grid per page</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.text, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={pdfOpts.fit_to_paper}
                  onChange={(e) => setPdfOpts((o) => ({ ...o, fit_to_paper: e.target.checked }))}
                />
                <span>Auto-fit to paper (keep rows &amp; columns readable)</span>
              </label>
              {pdfOpts.fit_to_paper ? (
                <p style={{ fontSize: 11, color: T.faint, margin: '6px 0 0', lineHeight: 1.4 }}>
                  {pdfOpts.paper} {pdfOpts.orientation} fits about{' '}
                  <strong style={{ color: T.muted }}>{autoCapacity.rows} rows</strong> ×{' '}
                  <strong style={{ color: T.muted }}>{autoCapacity.cols} day columns</strong> per sheet (~
                  {printGridGeometry(pdfOpts.paper, pdfOpts.orientation, autoCapacity.rows, autoCapacity.cols, {
                    includeHeader: pdfOpts.header,
                    includeLegend: pdfOpts.legend,
                  }).rowPx}
                  px tall cells).
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 11, color: T.muted }}>
                    Rows per page
                    <input
                      type="number"
                      min="1"
                      max="400"
                      value={sanitizePerPage(pdfOpts.rows_per_page, autoCapacity.rows)}
                      onChange={(e) => setPdfOpts((o) => ({ ...o, rows_per_page: sanitizePerPage(e.target.value, autoCapacity.rows) }))}
                      style={{ ...S.input, display: 'block', marginTop: 4, width: 110, fontSize: 12, padding: '6px 10px' }}
                      aria-label="Rows per page"
                    />
                  </label>
                  <label style={{ fontSize: 11, color: T.muted }}>
                    Columns per page
                    <input
                      type="number"
                      min="1"
                      max="400"
                      value={sanitizePerPage(pdfOpts.cols_per_page, autoCapacity.cols)}
                      onChange={(e) => setPdfOpts((o) => ({ ...o, cols_per_page: sanitizePerPage(e.target.value, autoCapacity.cols) }))}
                      style={{ ...S.input, display: 'block', marginTop: 4, width: 110, fontSize: 12, padding: '6px 10px' }}
                      aria-label="Columns per page"
                    />
                  </label>
                  <p style={{ fontSize: 11, color: T.faint, margin: '4px 0 0', lineHeight: 1.4, width: '100%' }}>
                    Fewer rows or columns = larger uniform cells on each sheet.
                  </p>
                </div>
              )}
            </div>
            <p style={{ fontSize: 10, color: T.faint, margin: '0 0 14px', lineHeight: 1.4 }}>
              Uses your browser print dialog → choose “Save as PDF”. Suggested filename:{' '}
              <code style={{ fontSize: 10 }}>119HS_Programme_{startDate}_{endDate}.pdf</code>
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setPdfOpen(false)} style={{ ...S.btn, padding: '10px 16px' }}>
                Cancel
              </button>
              <button type="button" onClick={confirmPrint} style={{ ...S.btn, ...S.btnPrimary, padding: '10px 16px' }}>
                Print
              </button>
              <button type="button" onClick={confirmPdfExport} style={{ ...S.btn, padding: '10px 16px' }}>
                Export PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
