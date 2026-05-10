'use strict';

const db = require('./db');
const schedule = require('./programmeSchedule');

const MAX_PREVIEW_ROWS_PER_ZONE = 14;

function normalizeDateString(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    const y = iso[1];
    const mo = String(Number(iso[2])).padStart(2, '0');
    const da = String(Number(iso[3])).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (dmy) {
    let da = Number(dmy[1]);
    let mo = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }
  const months = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const cleaned = s.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
  const m = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (m) {
    const day = Number(m[1]);
    const mk = m[2].toLowerCase().slice(0, 3);
    const mon = months[mk];
    if (mon == null) return null;
    const year = m[3] ? Number(m[3]) : 2026;
    const dt = new Date(year, mon, day);
    return schedule.dateKey(dt);
  }
  return null;
}

function extractJsonFromClaudeText(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/im.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function zonesBriefForPrompt(allZones) {
  return (allZones || []).map((z) => ({
    id: Number(z.id),
    name: String(z.name || ''),
    tower: String(z.tower || ''),
    tab: z.tab || '',
  }));
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return { action: 'unknown', message: 'Invalid response from parser' };
  const act = String(raw.action || 'unknown').toLowerCase().trim();
  if (act === 'unknown') {
    return { action: 'unknown', message: raw.message || 'Could not interpret command' };
  }
  if (act === 'shift_all') {
    const days = Number(raw.days);
    if (!Number.isFinite(days)) return { action: 'unknown', message: 'Need a numeric number of days' };
    return { action: 'shift_all', days };
  }
  if (act === 'shift_tower') {
    const days = Number(raw.days);
    if (!Number.isFinite(days) || raw.tower == null || String(raw.tower).trim() === '') {
      return { action: 'unknown', message: 'Need tower and numeric days' };
    }
    return { action: 'shift_tower', tower: String(raw.tower).trim(), days };
  }
  if (act === 'shift_zone') {
    const ids = Array.isArray(raw.zone_ids)
      ? [...new Set(raw.zone_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
      : [];
    const days = Number(raw.days);
    if (!ids.length || !Number.isFinite(days)) {
      return { action: 'unknown', message: 'Need zone id(s) and numeric days' };
    }
    return { action: 'shift_zone', zone_ids: ids, days };
  }
  if (act === 'set_zone_start') {
    const ids = Array.isArray(raw.zone_ids)
      ? [...new Set(raw.zone_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
      : [];
    const date = normalizeDateString(raw.date);
    if (!ids.length || !date) return { action: 'unknown', message: 'Need zone id(s) and a valid date' };
    return { action: 'set_zone_start', zone_ids: ids, date };
  }
  if (act === 'set_activity_date') {
    const zid = Number(raw.zone_id);
    const date = normalizeDateString(raw.date);
    const activity_name = String(raw.activity_name || '').trim();
    if (!Number.isFinite(zid) || zid <= 0 || !date || !activity_name) {
      return { action: 'unknown', message: 'Need zone_id, activity_name, and date' };
    }
    return { action: 'set_activity_date', zone_id: zid, activity_name, date };
  }
  return { action: 'unknown', message: 'Unrecognised action type' };
}

function matchZonesByTower(allZones, towerSpec) {
  const spec = String(towerSpec || '').trim();
  if (!spec) return [];
  const lower = spec.toLowerCase().replace(/\s+/g, '');
  const numSpec = spec.match(/\d+/);
  return (allZones || []).filter((z) => {
    const t = String(z.tower || '').trim().toLowerCase().replace(/\s+/g, '');
    if (t === lower) return true;
    const numZ = String(z.tower || '').match(/\d+/);
    if (numSpec && numZ && numSpec[0] === numZ[0]) {
      if (/tower|t/i.test(spec) || /tower|^t\d/i.test(String(z.tower || ''))) return true;
    }
    return t.includes(lower) || lower.includes(t);
  });
}

function zoneLabel(z) {
  return `${z.tower || ''} ${z.name || ''}`.trim() || `Zone ${z.id}`;
}

function isDone(it) {
  return String(it.status || '').toLowerCase() === 'done';
}

function maxEndDate(items) {
  let m = null;
  for (const it of items || []) {
    if (!it.end_date) continue;
    if (!m || String(it.end_date) > m) m = String(it.end_date);
  }
  return m;
}

function shiftPreviewRows(items, days) {
  const movable = (items || []).filter((it) => !isDone(it));
  const skipped = (items || []).filter(isDone).length;
  const rows = movable.slice(0, MAX_PREVIEW_ROWS_PER_ZONE).map((it) => ({
    activity_name: it.activity_name || '',
    start_before: it.start_date,
    end_before: it.end_date,
    start_after: schedule.addCalendarDays(it.start_date, days),
    end_after: schedule.addCalendarDays(it.end_date, days),
  }));
  const truncated = movable.length > MAX_PREVIEW_ROWS_PER_ZONE;
  return { rows, skipped_done: skipped, truncated, total_movable: movable.length };
}

function findActivityIdByFuzzyName(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const acts = db.getActivities();
  const exact = acts.find((a) => a.name === n);
  if (exact) return Number(exact.id);
  const low = n.toLowerCase();
  const ci = acts.find((a) => String(a.name).toLowerCase() === low);
  if (ci) return Number(ci.id);
  const partial = acts.find(
    (a) =>
      String(a.name).toLowerCase().includes(low) ||
      low.includes(String(a.name).toLowerCase())
  );
  return partial ? Number(partial.id) : null;
}

function validateZoneIds(ids, allZones) {
  const set = new Set((allZones || []).map((z) => Number(z.id)));
  const bad = ids.filter((id) => !set.has(id));
  return bad.length ? { error: `Unknown zone id(s): ${bad.join(', ')}` } : null;
}

async function callAnthropic(commandText, zonesBrief) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error('ANTHROPIC_API_KEY is not set on the server');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const prompt = `You are a construction programme assistant. Parse the user's command and return ONLY a JSON object (no markdown, no explanation).

Available zones — use exact numeric ids for zone_ids / zone_id:
${JSON.stringify(zonesBrief, null, 2)}

When the year is omitted in a date, assume 2026.

User command (verbatim):
${JSON.stringify(String(commandText || '').trim())}

Return ONLY one JSON object in exactly one of these shapes:

{"action":"shift_zone","zone_ids":[123],"days":2}
{"action":"shift_zone","zone_ids":[1,2],"days":-3}
{"action":"shift_tower","tower":"T2","days":7}
{"action":"shift_all","days":5}
{"action":"set_zone_start","zone_ids":[123],"date":"2026-05-18"}
{"action":"set_activity_date","zone_id":123,"activity_name":"Podium Pour","date":"2026-05-30"}
{"action":"unknown","message":"short reason"}

Rules:
- days: calendar days; positive = push programme later, negative = earlier.
- Match tower names using the tower field (e.g. T2, T3).
- Dates must be normalized to string YYYY-MM-DD when possible.
- If unclear or unsafe to infer, use action unknown.`;

  const body = JSON.stringify({
    model,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || JSON.stringify(data);
    throw new Error(`Anthropic API: ${msg}`);
  }

  const text = data.content?.find((b) => b.type === 'text')?.text || '{}';
  return extractJsonFromClaudeText(text);
}

function resolveTargetZoneIds(action, allZones) {
  if (action.action === 'shift_zone') return action.zone_ids;
  if (action.action === 'shift_tower') {
    const zs = matchZonesByTower(allZones, action.tower);
    return zs.map((z) => Number(z.id));
  }
  if (action.action === 'shift_all') {
    return db.getZoneIdsWithProgrammeItems();
  }
  if (action.action === 'set_zone_start') return action.zone_ids;
  if (action.action === 'set_activity_date') return [action.zone_id];
  return [];
}

function previewRowsForSetZoneStart(zoneId) {
  const zone = (db.getAllZones() || []).find((z) => Number(z.id) === Number(zoneId));
  if (!zone) return { error: 'Zone not found' };
  const items = db.getProgrammeItemsByZone(zoneId);
  const done = items.filter(isDone);
  if (done.length) {
    return {
      error: `${done.length} completed row(s) — clear completions first or use another command.`,
    };
  }
  const beforeRows = items.slice(0, MAX_PREVIEW_ROWS_PER_ZONE).map((it) => ({
    activity_name: it.activity_name,
    start_before: it.start_date,
    end_before: it.end_date,
  }));
  return { zone, items, beforeRows, truncated: items.length > MAX_PREVIEW_ROWS_PER_ZONE };
}

function previewRowsForSetActivity(zoneId, activityName, endDateKey) {
  const zone = (db.getAllZones() || []).find((z) => Number(z.id) === Number(zoneId));
  if (!zone) return { error: 'Zone not found' };
  const aid = findActivityIdByFuzzyName(activityName);
  if (!aid) return { error: `No activity matching "${activityName}"` };

  const tid =
    zone.source_template_id != null && zone.source_template_id !== ''
      ? Number(zone.source_template_id)
      : null;
  if (!tid) return { error: 'Zone has no linked template' };

  const template = db.getTemplateById(tid);
  if (!template) return { error: 'Template not found' };

  let seq = [];
  let dur = [];
  try {
    seq = JSON.parse(template.sequence || '[]');
  } catch (_) {}
  try {
    dur = JSON.parse(template.durations || '[]');
  } catch (_) {}
  const actRows = db.getActivities();
  const activityLookup = schedule.buildActivityLookup(actRows);

  let k = -1;
  for (let i = 0; i < seq.length; i++) {
    if (Number(schedule.resolveActivityId(activityLookup, seq[i])) === Number(aid)) {
      k = i;
      break;
    }
  }
  if (k < 0) return { error: `"${activityName}" is not in this zone's template sequence` };

  const newRows = schedule.buildRowsFromTargetEndDate({
    sequence: seq,
    durations: dur,
    anchorIndex: k,
    anchorEndDateKey: String(endDateKey || '').trim(),
    activityLookup,
  });
  if (!newRows.length) return { error: 'Could not compute schedule from that date' };
  if (newRows.some((r) => !r.activity_id)) return { error: 'Template activity names do not match database' };

  const items = db.getProgrammeItemsByZone(zoneId);
  const skipped_done = items.filter(isDone).length;
  if (skipped_done > 0) {
    return {
      error: `This zone has ${skipped_done} completed programme row(s). Clear completions before anchoring an activity (rebuild replaces the whole zone), or use a shift command.`,
    };
  }

  const beforeSample = items.slice(0, MAX_PREVIEW_ROWS_PER_ZONE).map((it) => ({
    activity_name: it.activity_name,
    start_before: it.start_date,
    end_before: it.end_date,
  }));

  const afterSample = newRows.slice(0, MAX_PREVIEW_ROWS_PER_ZONE).map((r) => ({
    activity_name: r.activity_name,
    start_after: r.start_date,
    end_after: r.end_date,
    is_target: r.idx === k,
  }));

  return {
    zone,
    skipped_done,
    zone_finish_before: maxEndDate(items),
    zone_finish_after: newRows[newRows.length - 1].end_date,
    beforeSample,
    afterSample,
    truncated_before: items.length > MAX_PREVIEW_ROWS_PER_ZONE,
    truncated_after: newRows.length > MAX_PREVIEW_ROWS_PER_ZONE,
    template_id: tid,
    anchor_activity_id: aid,
  };
}

function buildPreview(commandText, action, allZones) {
  if (action.action === 'unknown') {
    return {
      ok: false,
      unknown: true,
      command: commandText,
      message: action.message || 'Could not interpret that command',
    };
  }

  const targetIds = resolveTargetZoneIds(action, allZones);
  const uniqIds = [...new Set(targetIds)].filter((id) => Number.isFinite(id) && id > 0);

  if (action.action === 'shift_zone' || action.action === 'set_zone_start') {
    const err = validateZoneIds(action.action === 'shift_zone' ? action.zone_ids : action.zone_ids, allZones);
    if (err) return { ok: false, unknown: true, command: commandText, message: err.error };
  }

  if (
    (action.action === 'shift_zone' ||
      action.action === 'shift_tower' ||
      action.action === 'shift_all') &&
    !uniqIds.length
  ) {
    return {
      ok: false,
      unknown: true,
      command: commandText,
      message:
        action.action === 'shift_tower'
          ? `No zones matched tower "${action.tower}"`
          : 'No programme rows found to shift',
    };
  }

  if (action.action === 'shift_zone' || action.action === 'shift_tower' || action.action === 'shift_all') {
    let skipped_done_total = 0;
    const affected = [];
    let summary = '';
    const days = action.days;
    for (const zid of uniqIds) {
      const z = allZones.find((x) => Number(x.id) === zid);
      const items = db.getProgrammeItemsByZone(zid);
      if (!items.length) continue;
      const prev = shiftPreviewRows(items, days);
      skipped_done_total += prev.skipped_done;
      const finishBefore = maxEndDate(items);
      const movable = items.filter((it) => !isDone(it));
      const finishAfter =
        movable.length && finishBefore
          ? schedule.addCalendarDays(finishBefore, days)
          : finishBefore;
      affected.push({
        id: zid,
        label: z ? zoneLabel(z) : `Zone ${zid}`,
        days,
        skipped_done: prev.skipped_done,
        preview_rows: prev.rows,
        truncated: prev.truncated,
        total_movable: prev.total_movable,
        zone_finish_before: finishBefore,
        zone_finish_after: finishAfter,
      });
    }
    if (!affected.length) {
      return {
        ok: false,
        unknown: true,
        command: commandText,
        message: 'No programme rows found for the selected zone(s)',
      };
    }
    const scope =
      action.action === 'shift_all'
        ? 'all zones with programme rows'
        : action.action === 'shift_tower'
          ? `zones in tower ${action.tower}`
          : uniqIds.length === 1
            ? affected[0]?.label || `zone ${uniqIds[0]}`
            : `${uniqIds.length} zones`;
    summary = `${days >= 0 ? 'Push' : 'Pull'} ${scope} by ${Math.abs(days)} calendar day(s)`;
    return {
      ok: true,
      command: commandText,
      action,
      summary,
      skipped_done_total,
      affected_zones: affected,
    };
  }

  if (action.action === 'set_zone_start') {
    const err = validateZoneIds(action.zone_ids, allZones);
    if (err) return { ok: false, unknown: true, command: commandText, message: err.error };

    const affected = [];
    for (const zid of action.zone_ids) {
      const pr = previewRowsForSetZoneStart(zid);
      if (pr.error) {
        return { ok: false, unknown: true, command: commandText, message: pr.error };
      }
      const tid =
        pr.zone.source_template_id != null ? Number(pr.zone.source_template_id) : null;
      if (!tid) {
        return {
          ok: false,
          unknown: true,
          command: commandText,
          message: `Zone "${zoneLabel(pr.zone)}" has no linked template`,
        };
      }
      const template = db.getTemplateById(tid);
      if (!template) {
        return { ok: false, unknown: true, command: commandText, message: 'Template missing' };
      }
      let seq = [];
      let dur = [];
      try {
        seq = JSON.parse(template.sequence || '[]');
      } catch (_) {}
      try {
        dur = JSON.parse(template.durations || '[]');
      } catch (_) {}
      const actRows = db.getActivities();
      const activityLookup = schedule.buildActivityLookup(actRows);
      const newRows = schedule
        .buildRowsFromTemplate({
          sequence: seq,
          durations: dur,
          startStageIndex: 0,
          startDateKey: action.date,
          activityLookup,
        })
        .filter(Boolean);
      if (!newRows.length || newRows.some((r) => !r.activity_id)) {
        return {
          ok: false,
          unknown: true,
          command: commandText,
          message: `Could not rebuild programme for "${zoneLabel(pr.zone)}"`,
        };
      }
      affected.push({
        id: zid,
        label: zoneLabel(pr.zone),
        before_rows: pr.beforeRows,
        after_rows: newRows.slice(0, MAX_PREVIEW_ROWS_PER_ZONE).map((r) => ({
          activity_name: r.activity_name,
          start_after: r.start_date,
          end_after: r.end_date,
        })),
        truncated_before: pr.truncated,
        truncated_after: newRows.length > MAX_PREVIEW_ROWS_PER_ZONE,
        zone_finish_before: maxEndDate(pr.items),
        zone_finish_after: newRows[newRows.length - 1].end_date,
      });
    }
    return {
      ok: true,
      command: commandText,
      action,
      summary: `Set programme start for ${affected.length} zone(s) to ${action.date} (first stage, working-day schedule)`,
      skipped_done_total: 0,
      affected_zones: affected,
    };
  }

  if (action.action === 'set_activity_date') {
    const err = validateZoneIds([action.zone_id], allZones);
    if (err) return { ok: false, unknown: true, command: commandText, message: err.error };

    const pr = previewRowsForSetActivity(action.zone_id, action.activity_name, action.date);
    if (pr.error) return { ok: false, unknown: true, command: commandText, message: pr.error };

    return {
      ok: true,
      command: commandText,
      action,
      summary: `Anchor "${pr.zone ? zoneLabel(pr.zone) : ''}" — ${action.activity_name} finishes ${action.date} (working days); full programme recomputed`,
      skipped_done_total: 0,
      affected_zones: [
        {
          id: action.zone_id,
          label: zoneLabel(pr.zone),
          skipped_done: 0,
          before_rows: pr.beforeSample,
          after_rows: pr.afterSample,
          truncated_before: pr.truncated_before,
          truncated_after: pr.truncated_after,
          zone_finish_before: pr.zone_finish_before,
          zone_finish_after: pr.zone_finish_after,
          template_id: pr.template_id,
          anchor_activity_id: pr.anchor_activity_id,
        },
      ],
    };
  }

  return { ok: false, unknown: true, command: commandText, message: 'Unsupported action' };
}

async function previewCommand(commandText, username) {
  const allZones = db.getAllZones();
  const brief = zonesBriefForPrompt(allZones);

  let raw;
  try {
    raw = await callAnthropic(String(commandText || '').trim(), brief);
  } catch (e) {
    db.logProgrammeCommand({
      username,
      command_text: commandText,
      parsed_action: null,
      phase: 'parse_error',
      error_message: e.message,
    });
    return {
      ok: false,
      unknown: true,
      command: commandText,
      message: e.code === 'NO_API_KEY' ? 'Server is not configured for AI commands (missing API key).' : e.message,
    };
  }

  let action;
  try {
    action = normalizeAction(raw);
  } catch (e) {
    db.logProgrammeCommand({
      username,
      command_text: commandText,
      parsed_action: JSON.stringify(raw),
      phase: 'parse_error',
      error_message: e.message,
    });
    return {
      ok: false,
      unknown: true,
      command: commandText,
      message: 'Could not parse AI response as JSON',
    };
  }

  const preview = buildPreview(commandText, action, allZones);

  db.logProgrammeCommand({
    username,
    command_text: commandText,
    parsed_action: JSON.stringify(action),
    phase: preview.ok && !preview.unknown ? 'preview_ok' : 'preview_unknown',
    error_message: preview.ok ? null : preview.message || null,
  });

  return preview;
}

function applyShiftZoneIds(zoneIds, days) {
  for (const zid of zoneIds) {
    const items = db.getProgrammeItemsByZone(zid);
    for (const it of items) {
      if (isDone(it)) continue;
      db.updateProgrammeItem(it.id, {
        start_date: schedule.addCalendarDays(it.start_date, days),
        end_date: schedule.addCalendarDays(it.end_date, days),
      });
    }
  }
}

function applyAction(action, username, commandText) {
  const allZones = db.getAllZones();

  if (action.action === 'unknown') {
    return { ok: false, error: action.message };
  }

  const normalized = normalizeAction(action);
  if (normalized.action === 'unknown') {
    return { ok: false, error: normalized.message };
  }

  action = normalized;

  const preview = buildPreview(commandText, action, allZones);
  if (!preview.ok || preview.unknown) {
    db.logProgrammeCommand({
      username,
      command_text: commandText,
      parsed_action: JSON.stringify(action),
      phase: 'apply_rejected',
      error_message: preview.message || 'Preview invalid',
    });
    return { ok: false, error: preview.message || 'Cannot apply' };
  }

  try {
    if (action.action === 'shift_zone' || action.action === 'shift_tower' || action.action === 'shift_all') {
      const ids = resolveTargetZoneIds(action, allZones);
      applyShiftZoneIds([...new Set(ids)], action.days);
    } else if (action.action === 'set_zone_start') {
      for (const zid of action.zone_ids) {
        const r = db.resetZoneProgrammeToTemplateStart(zid, action.date);
        if (r.error) throw new Error(r.error);
      }
    } else if (action.action === 'set_activity_date') {
      const itemsCheck = db.getProgrammeItemsByZone(action.zone_id);
      if (itemsCheck.some(isDone)) {
        throw new Error(
          'Zone has completed programme rows — clear them before applying an activity anchor'
        );
      }
      const z = allZones.find((x) => Number(x.id) === Number(action.zone_id));
      const tid =
        z && z.source_template_id != null && z.source_template_id !== ''
          ? Number(z.source_template_id)
          : null;
      const aid = findActivityIdByFuzzyName(action.activity_name);
      if (!aid) throw new Error('Activity not found');
      const r = db.scheduleFromTargetDate(action.zone_id, aid, action.date, tid);
      if (r.error) throw new Error(r.error);
    }

    db.logProgrammeCommand({
      username,
      command_text: commandText,
      parsed_action: JSON.stringify(action),
      phase: 'applied',
      error_message: null,
    });

    return { ok: true };
  } catch (e) {
    db.logProgrammeCommand({
      username,
      command_text: commandText,
      parsed_action: JSON.stringify(action),
      phase: 'apply_error',
      error_message: e.message,
    });
    return { ok: false, error: e.message };
  }
}

module.exports = {
  previewCommand,
  applyAction,
  normalizeAction,
  normalizeDateString,
};
