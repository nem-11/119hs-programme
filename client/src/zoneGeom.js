export function parseZoneGeometry(z) {
  if (!z) return null;
  if (z.geometry) {
    try {
      const g = typeof z.geometry === 'string' ? JSON.parse(z.geometry) : z.geometry;
      if (g && g.kind === 'rect') return g;
      if (g && g.kind === 'poly' && Array.isArray(g.points)) return g;
    } catch (_) {}
  }
  return {
    kind: 'rect',
    x: Number(z.x) || 0,
    y: Number(z.y) || 0,
    w: Number(z.w) || 0,
    h: Number(z.h) || 0,
  };
}

export function pointInGeom(px, py, g) {
  if (!g) return false;
  if (g.kind === 'rect')
    return px >= g.x && px <= g.x + g.w && py >= g.y && py <= g.y + g.h;
  if (g.kind === 'poly' && g.points?.length >= 3) {
    let inside = false;
    const pts = g.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0],
        yi = pts[i][1],
        xj = pts[j][0],
        yj = pts[j][1];
      const denom = yj - yi || 1e-12;
      const intersect =
        yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / denom + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  return false;
}

export function svgPolygonPoints(g) {
  if (g?.kind !== 'poly' || !g.points?.length) return '';
  return g.points.map((p) => `${p[0]},${p[1]}`).join(' ');
}
