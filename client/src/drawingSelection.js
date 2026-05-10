/** Persist floor-plan choice across Zones + Programme tabs (same tab: GW / Internals). */
const key = (tab) => `119hs-drawing-${tab}`;

export function readSavedDrawingId(tab, drawingsForTab) {
  if (!drawingsForTab?.length) return null;
  try {
    const raw = sessionStorage.getItem(key(tab));
    if (!raw) return null;
    const id = Number(raw);
    return drawingsForTab.some((d) => d.id === id) ? id : null;
  } catch (_) {
    return null;
  }
}

export function writeSavedDrawingId(tab, id) {
  try {
    sessionStorage.setItem(key(tab), String(id));
  } catch (_) {}
}
