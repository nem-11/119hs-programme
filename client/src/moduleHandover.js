/**
 * Module Handover stages — a single status per module zone, progressing from
 * "Not started" through snagging/clean/furniture to "Handover" (complete).
 * Shared by the Module Handover page and the Dashboard Module Completion section.
 */

export const MODULE_STAGES = [
  {
    key: 'nothing',
    label: 'Not started',
    swatch: 'rgb(176, 183, 194)',
    fill: 'rgba(176, 183, 194, 0.22)',
    stroke: 'rgba(96, 104, 116, 0.6)',
  },
  {
    key: 'snagged',
    label: 'Snagged',
    swatch: 'rgb(229, 57, 53)',
    fill: 'rgba(229, 57, 53, 0.42)',
    stroke: 'rgba(183, 28, 28, 0.92)',
  },
  {
    key: 'snagging_wip',
    label: 'Snagging in progress',
    swatch: 'rgb(251, 140, 0)',
    fill: 'rgba(251, 140, 0, 0.44)',
    stroke: 'rgba(230, 108, 0, 0.92)',
  },
  {
    key: 'clean',
    label: 'Clean',
    swatch: 'rgb(245, 196, 0)',
    fill: 'rgba(253, 216, 53, 0.52)',
    stroke: 'rgba(238, 178, 0, 0.95)',
  },
  {
    key: 'furniture',
    label: 'Furniture',
    swatch: 'rgb(141, 206, 80)',
    fill: 'rgba(141, 206, 80, 0.52)',
    stroke: 'rgba(104, 159, 56, 0.95)',
  },
  {
    key: 'handover',
    label: 'Handover',
    swatch: 'rgb(46, 160, 67)',
    fill: 'rgba(46, 160, 67, 0.62)',
    stroke: 'rgba(27, 120, 45, 1)',
  },
];

export const MODULE_STAGE_KEYS = MODULE_STAGES.map((s) => s.key);

const STAGE_BY_KEY = new Map(MODULE_STAGES.map((s) => [s.key, s]));

/** Default stage when a module has no recorded handover_stage. */
export const DEFAULT_MODULE_STAGE = 'nothing';

/** Stage key that counts as "handed over" / complete. */
export const MODULE_COMPLETE_STAGE = 'handover';

export function normalizeModuleStage(stage) {
  const k = String(stage || '').trim();
  return STAGE_BY_KEY.has(k) ? k : DEFAULT_MODULE_STAGE;
}

export function moduleStageMeta(stage) {
  return STAGE_BY_KEY.get(normalizeModuleStage(stage));
}

export function moduleStageIndex(stage) {
  return MODULE_STAGE_KEYS.indexOf(normalizeModuleStage(stage));
}

export function moduleStageLabel(stage) {
  return moduleStageMeta(stage).label;
}

/** Next stage in the progression (wraps to start after Handover) — for click-to-advance. */
export function nextModuleStage(stage) {
  const i = moduleStageIndex(stage);
  return MODULE_STAGE_KEYS[(i + 1) % MODULE_STAGE_KEYS.length];
}

/** Aggregate counts + handed-over percentage for a list of module zones. */
export function moduleCompletionSummary(zones) {
  const list = Array.isArray(zones) ? zones : [];
  const total = list.length;
  const byStage = {};
  for (const k of MODULE_STAGE_KEYS) byStage[k] = 0;
  let handed = 0;
  for (const z of list) {
    const k = normalizeModuleStage(z?.handover_stage);
    byStage[k] += 1;
    if (k === MODULE_COMPLETE_STAGE) handed += 1;
  }
  return { total, handed, byStage, pct: total ? Math.round((handed / total) * 100) : 0 };
}
