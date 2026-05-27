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

/** Bounding box + centre for zone geometry (viewBox 0–100). */
export function geomBBox(g, z) {
  if (g?.kind === 'rect') {
    return {
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      cx: g.x + g.w / 2,
      cy: g.y + g.h / 2,
    };
  }
  if (g?.kind === 'poly' && Array.isArray(g.points) && g.points.length >= 3) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of g.points) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    return { x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2 };
  }
  const x = Number(z?.x) || 0;
  const y = Number(z?.y) || 0;
  const w = Number(z?.w) || 0;
  const h = Number(z?.h) || 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Readable micro-label size from zone footprint; cap so text stays subtle on large zones. */
export function zoneLabelFontSize(bb) {
  const m = Math.min(bb.w, bb.h);
  return Math.min(1.15, Math.max(0.52, m * 0.16));
}
