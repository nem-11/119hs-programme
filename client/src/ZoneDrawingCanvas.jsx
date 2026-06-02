import React, { useCallback, useEffect, useRef, useState } from 'react';
import { T } from './uiTheme';
import { parseZoneGeometry, svgPolygonPoints, geomBBox, zoneLabelFontSize } from './zoneGeom';

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

const zoomBtnStyle = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: `1px solid ${T.hairline}`,
  background: 'rgba(255,255,255,0.96)',
  color: T.text,
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 8px rgba(26,26,46,0.14)',
  lineHeight: 1,
};

/**
 * Base drawing image + SVG zone overlays (shared by Plan → Drawing and Dashboard completion).
 * Pass enableZoomPan to allow scroll-to-zoom, drag-to-pan and pinch-to-zoom (like Zone drawing).
 */
export default function ZoneDrawingCanvas({
  drawing,
  zones,
  styleForZone,
  labelForZone,
  labelActiveForZone,
  legend,
  minHeight = 420,
  coarsePointer = false,
  onZoneClick,
  allowZoneClick = false,
  emptyMessage = 'No drawing selected.',
  className = '',
  enableZoomPan = false,
}) {
  const imageData = drawing?.image_data;
  const zoneList = Array.isArray(zones) ? zones : [];

  const viewportRef = useRef(null);
  const panDrag = useRef(null);
  const pinchRef = useRef(null);
  const touchStart = useRef(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [panning, setPanning] = useState(false);

  // Reset the view whenever the drawing changes.
  useEffect(() => {
    setView({ scale: 1, tx: 0, ty: 0 });
  }, [imageData]);

  const applyWheelZoom = useCallback((e) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const vr = vp.getBoundingClientRect();
    const mx = e.clientX - vr.left;
    const my = e.clientY - vr.top;
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setView((v) => {
      const next = clampScale(v.scale + delta);
      const cx = (mx - v.tx) / v.scale;
      const cy = (my - v.ty) / v.scale;
      return { scale: next, tx: mx - cx * next, ty: my - cy * next };
    });
  }, []);

  useEffect(() => {
    if (!enableZoomPan) return undefined;
    const vp = viewportRef.current;
    if (!vp || !imageData) return undefined;
    const handler = (e) => applyWheelZoom(e);
    vp.addEventListener('wheel', handler, { passive: false });
    return () => vp.removeEventListener('wheel', handler);
  }, [enableZoomPan, imageData, applyWheelZoom]);

  // Two-finger pinch needs an active touchmove listener to preventDefault.
  useEffect(() => {
    if (!enableZoomPan) return undefined;
    const vp = viewportRef.current;
    if (!vp || !imageData) return undefined;
    const tm = (e) => {
      if (e.touches.length === 2 && pinchRef.current) e.preventDefault();
    };
    vp.addEventListener('touchmove', tm, { passive: false });
    return () => vp.removeEventListener('touchmove', tm);
  }, [enableZoomPan, imageData]);

  const zoomBy = useCallback((delta) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vr = vp.getBoundingClientRect();
    const mx = vr.width / 2;
    const my = vr.height / 2;
    setView((v) => {
      const next = clampScale(v.scale + delta);
      const cx = (mx - v.tx) / v.scale;
      const cy = (my - v.ty) / v.scale;
      return { scale: next, tx: mx - cx * next, ty: my - cy * next };
    });
  }, []);

  const resetView = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), []);

  const onMouseDownViewport = useCallback((e) => {
    if (!enableZoomPan) return;
    if (e.button !== 0 && e.button !== 1) return;
    panDrag.current = { lastX: e.clientX, lastY: e.clientY };
    setPanning(true);
    const onMove = (ev) => {
      if (!panDrag.current) return;
      const dx = ev.clientX - panDrag.current.lastX;
      const dy = ev.clientY - panDrag.current.lastY;
      panDrag.current.lastX = ev.clientX;
      panDrag.current.lastY = ev.clientY;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    };
    const onUp = () => {
      panDrag.current = null;
      setPanning(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [enableZoomPan]);

  if (!imageData) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: T.faint, fontSize: 12 }}>{emptyMessage}</div>
    );
  }

  const svgOverlay = (
    <svg
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {zoneList.map((z) => {
        const g = parseZoneGeometry(z);
        if (!g) return null;
        const styles = styleForZone?.(z) || {
          fill: 'rgba(110, 118, 135, 0.18)',
          stroke: 'rgba(35, 40, 52, 0.65)',
          strokeW: 0.55,
        };
        const { fill, stroke, strokeW = 0.55 } = styles;
        const bb = geomBBox(g, z);
        const cx = bb.cx;
        const cy = bb.cy;
        const minDim = Math.min(bb.w, bb.h);
        const fs = zoneLabelFontSize(bb);
        const vertical = bb.h > bb.w * 1.15;
        const shortLabel = labelForZone?.(z) || '';
        const labelLines = String(shortLabel || '').split('\n').filter(Boolean).slice(0, 2);
        const showText = labelLines.length > 0 && minDim >= 1.6;
        const labelActive = labelActiveForZone?.(z) ?? false;
        const clickable = (allowZoneClick || coarsePointer) && typeof onZoneClick === 'function';
        const shape =
          g.kind === 'poly' ? (
            <polygon
              points={svgPolygonPoints(g)}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeW}
              strokeLinejoin="round"
            />
          ) : (
            <rect x={g.x} y={g.y} width={g.w} height={g.h} fill={fill} stroke={stroke} strokeWidth={strokeW} />
          );

        return (
          <g
            key={z.id}
            style={{ cursor: clickable ? 'pointer' : 'default' }}
            onClick={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              onZoneClick(z, e);
            }}
            onKeyDown={(e) => {
              if (!clickable) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onZoneClick(z, e);
              }
            }}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
          >
            {shape}
            {showText && (
              <text
                transform={`translate(${cx},${cy}) rotate(${vertical ? -90 : 0})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={labelActive ? T.text : 'rgba(26,26,46,0.55)'}
                fontSize={fs}
                fontWeight="700"
                stroke="rgba(255,255,255,0.88)"
                strokeWidth={Math.max(0.04, fs * 0.07)}
                paintOrder="stroke fill"
                pointerEvents="none"
              >
                {labelLines.map((line, idx) => (
                  <tspan
                    key={`${line}-${idx}`}
                    x="0"
                    dy={labelLines.length === 1 ? 0 : idx === 0 ? -fs * 0.18 : fs * 0.92}
                    fontSize={idx === 0 ? fs : fs * 0.82}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );

  if (!enableZoomPan) {
    return (
      <div
        className={className}
        style={{ position: 'relative', width: '100%', minHeight, background: '#ececf1' }}
      >
        {/* Inner box is sized by the image itself so the SVG overlay lines up exactly. */}
        <div style={{ position: 'relative', width: '100%' }}>
          <img
            alt="Zone drawing"
            src={`data:image/jpeg;base64,${imageData}`}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
          {svgOverlay}
        </div>
        {legend}
      </div>
    );
  }

  const { scale, tx, ty } = view;

  return (
    <div
      ref={viewportRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        minHeight,
        overflow: 'hidden',
        background: '#ececf1',
        cursor: panning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onMouseDown={onMouseDownViewport}
      onTouchStart={(e) => {
        if (e.touches.length === 2 && viewportRef.current) {
          const [t1, t2] = [e.touches[0], e.touches[1]];
          const vr = viewportRef.current.getBoundingClientRect();
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          pinchRef.current = {
            dist: Math.hypot(dx, dy) || 1,
            v0: { ...view },
            mid: { x: (t1.clientX + t2.clientX) / 2 - vr.left, y: (t1.clientY + t2.clientY) / 2 - vr.top },
          };
          touchStart.current = null;
          return;
        }
        if (e.touches.length === 1) {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY, moved: false };
          panDrag.current = { lastX: t.clientX, lastY: t.clientY };
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2 && pinchRef.current && viewportRef.current) {
          const [t1, t2] = [e.touches[0], e.touches[1]];
          const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
          const ratio = newDist / pinchRef.current.dist;
          const { v0, mid } = pinchRef.current;
          const nextScale = clampScale(v0.scale * ratio);
          const cx = (mid.x - v0.tx) / v0.scale;
          const cy = (mid.y - v0.ty) / v0.scale;
          setView({ scale: nextScale, tx: mid.x - cx * nextScale, ty: mid.y - cy * nextScale });
          return;
        }
        if (e.touches.length === 1 && panDrag.current && touchStart.current) {
          const t = e.touches[0];
          const totalDx = t.clientX - touchStart.current.x;
          const totalDy = t.clientY - touchStart.current.y;
          if (!touchStart.current.moved && Math.hypot(totalDx, totalDy) < 8) return;
          touchStart.current.moved = true;
          const dx = t.clientX - panDrag.current.lastX;
          const dy = t.clientY - panDrag.current.lastY;
          panDrag.current.lastX = t.clientX;
          panDrag.current.lastY = t.clientY;
          setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
        }
      }}
      onTouchEnd={() => {
        pinchRef.current = null;
        panDrag.current = null;
        touchStart.current = null;
      }}
    >
      {/* Plate stays in normal flow so the viewport tracks the image height; the
          transform (zoom/pan) does not change its layout box, so overflow clips cleanly. */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          transform: `translate(${tx}px,${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        <img
          alt="Zone drawing"
          draggable={false}
          src={`data:image/jpeg;base64,${imageData}`}
          style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none', pointerEvents: 'none' }}
        />
        {svgOverlay}
      </div>
      <div
        className="zone-drawing-zoom-controls"
        style={{ position: 'absolute', top: 10, left: 10, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <button type="button" title="Zoom in" style={zoomBtnStyle} onClick={(e) => { e.stopPropagation(); zoomBy(0.2); }}>+</button>
        <button type="button" title="Zoom out" style={zoomBtnStyle} onClick={(e) => { e.stopPropagation(); zoomBy(-0.2); }}>−</button>
        <button type="button" title="Reset view" style={{ ...zoomBtnStyle, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); resetView(); }}>Reset</button>
      </div>
      {legend}
    </div>
  );
}
