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

/** Editing zones / programme lines — admin only (site uses Plan/Gantt). */
export function canEditZonesProgramme(role) {
  return isAdmin(role);
}

/** Update / tick-offs — admin + site only. */
export function canTick(role) {
  return isAdmin(role) || isSiteEditor(role);
}

/** Gantt: admin, site, board, GW/INT subbies (scoped tabs). */
export function showGantt(role) {
  return (
    isAdmin(role) ||
    isSiteEditor(role) ||
    isBoardViewer(role) ||
    isGwSubbie(role) ||
    isIntSubbie(role)
  );
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
    return [dash, plan, gantt, zones];
  }

  if (isSiteEditor(role)) {
    return [dash, upd, ahead, plan, gantt, zones];
  }

  if (isGwSubbie(role) || isIntSubbie(role)) {
    return [dash, ahead, plan, gantt, zones];
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
