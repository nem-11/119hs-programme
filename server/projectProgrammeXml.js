const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  removeNSPrefix: true,
});

function stripDateTime(val) {
  if (val == null || val === '') return '';
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.split('T')[0] || s;
}

function asInt(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asFlag(val) {
  if (val === true || val === 1 || val === '1' || val === 'true' || val === 'yes' || val === 'Yes') {
    return 1;
  }
  return 0;
}

function taskField(t, ...keys) {
  for (const k of keys) {
    if (t == null) continue;
    if (t[k] !== undefined && t[k] !== null && t[k] !== '') return t[k];
    if (t[`@_${k}`] !== undefined && t[`@_${k}`] !== null && t[`@_${k}`] !== '') return t[`@_${k}`];
  }
  return undefined;
}

/** PT200H0M0S → working days (hours ÷ 8), 1 decimal; milestones = 0; else min 0.5. */
function durationDaysFromIso(durationStr, isMilestone) {
  if (isMilestone) return 0;
  const s = String(durationStr || '').trim().toUpperCase();
  if (!s) return 0.5;
  let hours = 0;
  const h = s.match(/(\d+(?:\.\d+)?)H/);
  const d = s.match(/(\d+(?:\.\d+)?)D/);
  const m = s.match(/(\d+(?:\.\d+)?)M/);
  if (d) hours += Number(d[1]) * 8;
  if (h) hours += Number(h[1]);
  if (m) hours += Number(m[1]) / 60;
  if (!hours && !d && !h) return 0.5;
  let days = hours / 8;
  if (days <= 0) return 0.5;
  days = Math.round(days * 10) / 10;
  return Math.max(0.5, days);
}

function normalizeTaskList(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Parse MS Project XML buffer → task rows (no DB write).
 * @param {Buffer|string} xmlBuffer
 */
function parseMsProjectXml(xmlBuffer) {
  const text = Buffer.isBuffer(xmlBuffer) ? xmlBuffer.toString('utf8') : String(xmlBuffer);
  const doc = parser.parse(text);
  const project = doc?.Project || doc?.project || doc;
  const tasksNode = project?.Tasks || project?.tasks;
  const taskList = normalizeTaskList(tasksNode?.Task || tasksNode?.task);
  const out = [];

  for (const t of taskList) {
    if (!t || typeof t !== 'object') continue;
    const uid = asInt(t.UID ?? t.uid, -1);
    if (uid === 0) continue;
    const name = String(t.Name ?? t.name ?? '').trim();
    if (!name) continue;
    let isSummary = asFlag(taskField(t, 'Summary', 'summary'));
    let isMilestone = asFlag(taskField(t, 'Milestone', 'milestone'));
    const durationRaw = String(t.Duration ?? t.duration ?? '').trim().toUpperCase();
    if (!isMilestone && /^PT0H0M0S$|^PT0H$|^PT0M$|^P0D$|^PT0D0H0M0S$/.test(durationRaw)) {
      isMilestone = 1;
    }
    const start_date = stripDateTime(t.Start ?? t.start);
    const finish_date = stripDateTime(t.Finish ?? t.finish);
    const duration_days = durationDaysFromIso(t.Duration ?? t.duration, isMilestone === 1);
    out.push({
      uid,
      name,
      wbs: String(t.WBS ?? t.wbs ?? '').trim(),
      outline_level: asInt(t.OutlineLevel ?? t.outlineLevel, 1) || 1,
      start_date,
      finish_date,
      duration_days,
      is_summary: isSummary,
      is_milestone: isMilestone,
    });
  }

  return out;
}

module.exports = { parseMsProjectXml };
