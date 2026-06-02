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

/** Editing zones / programme lines — admin only (site uses Plan). */
export function canEditZonesProgramme(role) {
  return isAdmin(role);
}

/** Update / tick-offs — admin + site only. */
export function canTick(role) {
  return isAdmin(role) || isSiteEditor(role);
}

/** Module Handover setup (upload drawing, draw modules, set stages) — admin + site. Board views only. */
export function canManageModules(role) {
  return isAdmin(role) || isSiteEditor(role);
}

export function bottomNavItemsForRole(role) {
  const dash = { id: 'dashboard', label: 'Dash', icon: '▣' };
  const upd = { id: 'update', label: 'Update', icon: '✓' };
  const ahead = { id: 'lookahead', label: 'Ahead', icon: '▶' };
  const plan = { id: 'plan', label: 'Plan', icon: '▦' };
  const zones = { id: 'zones', label: 'Zones', icon: '◇' };
  const prog = { id: 'programme', label: 'Programme', icon: '◎' };
  const tpl = { id: 'templates', label: 'Templates', icon: '⧉' };
  const sett = { id: 'settings', label: 'Settings', icon: '⚙' };
  const mod = { id: 'modhandover', label: 'Modules', icon: '⬚' };

  if (isBoardViewer(role)) {
    return [dash, plan, zones, mod];
  }

  /** Site: view Programme (incl. Project programme XML list); structural edit remains admin-only in ProgrammePage. */
  if (isSiteEditor(role)) {
    return [dash, upd, ahead, plan, zones, prog, mod];
  }

  if (isGwSubbie(role) || isIntSubbie(role)) {
    return [dash, ahead, plan, zones];
  }

  const core = [dash, upd, ahead, plan];
  const zp = [zones, prog];
  const adm = isAdmin(role) ? [tpl, sett] : [];
  return [...core, ...zp, mod, ...adm];
}

export function allowedPageIdsForRole(role) {
  return new Set(bottomNavItemsForRole(role).map((x) => x.id));
}
