import React from 'react';
import { T } from './uiTheme';
import { parseZoneGeometry, svgPolygonPoints, geomBBox, zoneLabelFontSize } from './zoneGeom';

/**
 * Base drawing image + SVG zone overlays (shared by Plan → Drawing and Dashboard completion).
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
  emptyMessage = 'No drawing selected.',
  className = '',
}) {
  const imageData = drawing?.image_data;
  const zoneList = Array.isArray(zones) ? zones : [];

  if (!imageData) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: T.faint, fontSize: 12 }}>{emptyMessage}</div>
    );
  }

  return (
    <div
      className={className}
      style={{ position: 'relative', minHeight, background: '#ececf1' }}
    >
      <img
        alt="Zone drawing"
        src={`data:image/jpeg;base64,${imageData}`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      <svg
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
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
          const showText = shortLabel && minDim >= 1.6;
          const labelActive = labelActiveForZone?.(z) ?? false;
          const clickable = coarsePointer && typeof onZoneClick === 'function';
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
                  {shortLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {legend}
    </div>
  );
}
