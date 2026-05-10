/**
 * Role-based access for API enforcement.
 * Roles: admin | site_editor | gw_subbie | int_subbie | board_viewer
 * Legacy: editor → treated as site_editor
 */

function isSiteEditorRole(role) {
  return role === 'site_editor' || role === 'editor';
}

function isAdminRole(role) {
  return role === 'admin';
}

function canTickCompletions(role) {
  return (
    isAdminRole(role) ||
    isSiteEditorRole(role) ||
    role === 'gw_subbie' ||
    role === 'int_subbie'
  );
}

function canEditProgrammeAndZones(role) {
  return isAdminRole(role) || isSiteEditorRole(role);
}

function isBoardViewer(role) {
  return role === 'board_viewer';
}

/** Flatten schedule day JSON into completion keys (matches client UpdPage). */
function scheduleDayCompletionKeys(dayData) {
  const keys = new Set();
  if (!dayData || typeof dayData !== 'object') return keys;
  Object.entries(dayData).forEach(([tw, zones]) => {
    if (Array.isArray(zones)) {
      zones.forEach((act) => keys.add(`${tw}|${act}`));
    } else {
      Object.entries(zones).forEach(([z, acts]) => {
        const pfx = z === '_default' ? tw : `${tw}|${z}`;
        (acts || []).forEach((act) => keys.add(`${pfx}|${act}`));
      });
    }
  });
  return keys;
}

function completionKeyAllowedForUser(db, user, dateStr, key) {
  const role = user.role;
  const tabCandidates = [];
  if (isAdminRole(role) || isSiteEditorRole(role)) {
    tabCandidates.push(...(user.tabs || []));
  } else if (role === 'gw_subbie') {
    tabCandidates.push('groundworks');
  } else if (role === 'int_subbie') {
    tabCandidates.push('internals');
  } else {
    return false;
  }
  for (const tab of tabCandidates) {
    const sched = db.getSchedule(tab);
    const day = sched[String(dateStr)];
    if (scheduleDayCompletionKeys(day).has(String(key))) return true;
  }
  return false;
}

function userTabsSet(user) {
  return new Set(user.tabs || []);
}

function assertDrawingTabAllowed(db, user, drawingId) {
  const id = Number(drawingId);
  if (!id) return { ok: false };
  const d = db.getDrawing(id);
  if (!d) return { ok: false };
  if (isAdminRole(user.role)) return { ok: true, drawing: d };
  const tabs = userTabsSet(user);
  if (!tabs.has(d.tab)) return { ok: false };
  return { ok: true, drawing: d };
}

function assertZoneTabAllowed(db, user, zoneId) {
  const zid = Number(zoneId);
  if (!zid) return { ok: false };
  const row = db.get(
    `SELECT z.id, d.tab FROM zones z JOIN drawings d ON d.id = z.drawing_id WHERE z.id = ?`,
    [zid]
  );
  if (!row) return { ok: false };
  if (isAdminRole(user.role)) return { ok: true, tab: row.tab };
  if (!userTabsSet(user).has(row.tab)) return { ok: false };
  return { ok: true, tab: row.tab };
}

function filterActivitiesForUser(user, rows) {
  if (!Array.isArray(rows)) return [];
  if (isAdminRole(user.role)) return rows;
  const tabs = userTabsSet(user);
  return rows.filter((r) => tabs.has(r.type));
}

function filterDrawingsForUser(user, rows) {
  if (!Array.isArray(rows)) return [];
  if (isAdminRole(user.role)) return rows;
  const tabs = userTabsSet(user);
  return rows.filter((d) => tabs.has(d.tab));
}

function filterZonesAllForUser(db, user, rows) {
  if (!Array.isArray(rows)) return [];
  if (isAdminRole(user.role)) return rows;
  const tabs = userTabsSet(user);
  return rows.filter((z) => {
    const d = db.getDrawing(z.drawing_id);
    return d && tabs.has(d.tab);
  });
}

function filterCompletionsForUser(db, user, completionsObj) {
  if (isAdminRole(user.role) || isSiteEditorRole(user.role)) return completionsObj || {};
  /** Board: read-only full completions for dashboard metrics (cannot POST — completionWriter). */
  if (isBoardViewer(user.role)) return completionsObj || {};
  const out = {};
  Object.entries(completionsObj || {}).forEach(([date, keysObj]) => {
    const filtered = {};
    Object.entries(keysObj || {}).forEach(([key, meta]) => {
      if (completionKeyAllowedForUser(db, user, date, key)) filtered[key] = meta;
    });
    if (Object.keys(filtered).length) out[date] = filtered;
  });
  return out;
}

function filterTemplatesForUser(user, rows) {
  if (!Array.isArray(rows)) return [];
  if (isAdminRole(user.role)) return rows;
  const tabs = userTabsSet(user);
  return rows.filter((t) => tabs.has(t.tab));
}

/** Express: Programme-item APIs are for the hidden Programme screen only. */
function denyBoardViewer(req, res, next) {
  if (isBoardViewer(req.user.role)) {
    return res.status(403).json({ error: 'Not permitted for this role' });
  }
  next();
}

module.exports = {
  isSiteEditorRole,
  isAdminRole,
  canTickCompletions,
  canEditProgrammeAndZones,
  isBoardViewer,
  denyBoardViewer,
  scheduleDayCompletionKeys,
  completionKeyAllowedForUser,
  assertDrawingTabAllowed,
  assertZoneTabAllowed,
  filterActivitiesForUser,
  filterDrawingsForUser,
  filterZonesAllForUser,
  filterCompletionsForUser,
  filterTemplatesForUser,
  userTabsSet,
};
