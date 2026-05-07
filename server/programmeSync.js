function dateKeysBetween(startStr, endStr) {
  const out = [];
  const d = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  while (d <= end) {
    if (d.getDay() !== 0) {
      out.push(
        d.getFullYear() +
          '-' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getDate()).padStart(2, '0')
      );
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function bboxFromGeom(g) {
  if (!g || typeof g !== 'object') return { x: 0, y: 0, w: 0, h: 0 };
  if (g.kind === 'rect')
    return {
      x: Number(g.x) || 0,
      y: Number(g.y) || 0,
      w: Number(g.w) || 0,
      h: Number(g.h) || 0,
    };
  if (g.kind === 'poly' && Array.isArray(g.points) && g.points.length) {
    let minx = 100,
      miny = 100,
      maxx = 0,
      maxy = 0;
    g.points.forEach((pt) => {
      const px = Number(pt[0]),
        py = Number(pt[1]);
      minx = Math.min(minx, px);
      miny = Math.min(miny, py);
      maxx = Math.max(maxx, px);
      maxy = Math.max(maxy, py);
    });
    return { x: minx, y: miny, w: Math.max(0, maxx - minx), h: Math.max(0, maxy - miny) };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

module.exports = { dateKeysBetween, bboxFromGeom };
