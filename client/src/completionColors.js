const COMPLETION_GREEN = [46, 178, 96];
const COMPLETION_GREEN_DARK = [25, 118, 66];

export const COMPLETION_BUCKETS = [
  { min: 0, label: '0%', fill: 'rgba(46,178,96,0)', stroke: 'rgba(46,178,96,0.28)' },
  { min: 0.01, label: '1-24%', fill: 'rgba(46,178,96,0.14)', stroke: 'rgba(46,178,96,0.42)' },
  { min: 0.25, label: '25-49%', fill: 'rgba(46,178,96,0.26)', stroke: 'rgba(46,178,96,0.56)' },
  { min: 0.5, label: '50-74%', fill: 'rgba(46,178,96,0.42)', stroke: 'rgba(46,178,96,0.70)' },
  { min: 0.75, label: '75-99%', fill: 'rgba(46,178,96,0.62)', stroke: 'rgba(46,178,96,0.86)' },
  { min: 1, label: '100%', fill: `rgb(${COMPLETION_GREEN_DARK.join(',')})`, stroke: `rgb(${COMPLETION_GREEN.join(',')})` },
];

export function greenShadeForPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) {
    return {
      fill: 'rgba(46,178,96,0)',
      stroke: 'rgba(35,40,52,0.35)',
      strokeW: 0.55,
    };
  }

  const v = Math.max(0, Math.min(1, Number(pct)));
  const bucket = [...COMPLETION_BUCKETS].reverse().find((b) => v >= b.min) || COMPLETION_BUCKETS[0];
  return {
    fill: bucket.fill,
    stroke: bucket.stroke,
    strokeW: v > 0 ? 1.05 : 0.55,
  };
}
