/** Mirrors server roles: admin | site_editor | editor (legacy) | gw_subbie | int_subbie | board_viewer */

export function isAdmin(role) {
  return role === 'admin';
}

export function isSiteEditor(role) {
  return role === 'site_editor' || role === 'editor';
}

export function isBoardViewer(role) {
  return role === 'board_viewer';
}

export function isGwSubbie(role) {
  return role === 'gw_subbie';
}

export function isIntSubbie(role) {
  return role === 'int_subbie';
}

export function canEditZonesProgramme(role) {
  return isAdmin(role) || isSiteEditor(role);
}

export function canTick(role) {
  return isAdmin(role) || isSiteEditor(role) || isGwSubbie(role) || isIntSubbie(role);
}

/** Gantt is an advanced programme view — site + admin only. */
export function showGantt(role) {
  return isAdmin(role) || isSiteEditor(role);
}

export function bottomNavItemsForRole(role) {
  const dash = { id: 'dashboard', label: 'Dash', icon: '▣' };
  const upd = { id: 'update', label: 'Update', icon: '✓' };
  const ahead = { id: 'lookahead', label: 'Ahead', icon: '▶' };
  const plan = { id: 'plan', label: 'Plan', icon: '▦' };
  const gantt = { id: 'gantt', label: 'Gantt', icon: '▤' };
  const zones = { id: 'zones', label: 'Zones', icon: '◇' };
  const prog = { id: 'programme', label: 'Programme', icon: '◎' };
  const tpl = { id: 'templates', label: 'Templates', icon: '⧉' };
  const sett = { id: 'settings', label: 'Settings', icon: '⚙' };

  if (isBoardViewer(role)) {
    return [dash, plan, prog];
  }

  const core = [dash, upd, ahead, plan];
  const gz = showGantt(role) ? [gantt] : [];
  const zp = [zones, prog];
  const adm = isAdmin(role) ? [tpl, sett] : [];
  return [...core, ...gz, ...zp, ...adm];
}

export function allowedPageIdsForRole(role) {
  return new Set(bottomNavItemsForRole(role).map((x) => x.id));
}
