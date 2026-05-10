import { actColor } from './constants';

export const T = {
  bg: '#f4f3ef',
  surface: '#ffffff',
  text: '#1a1a2e',
  muted: 'rgba(26,26,46,0.52)',
  faint: 'rgba(26,26,46,0.38)',
  hairline: 'rgba(26,26,46,0.1)',
  nav: '#ebeae4',
};

/** Consistent card elevation (polish pass). */
export const shadowCard = '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)';

export const grad = {
  cardSurface: 'linear-gradient(180deg, #ffffff 0%, #f4f4f6 100%)',
  pageHeader: 'linear-gradient(180deg, #e8e8ea 0%, #f7f7f8 48%, #ffffff 100%)',
};

export const S = {
  btn: {
    background: 'rgba(26,26,46,0.06)',
    border: 'none',
    color: T.text,
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnAct: { background: 'rgba(66,133,244,0.22)' },
  btnPrimary: {
    background: 'linear-gradient(180deg, #1d4ed8 0%, #2563eb 100%)',
    color: '#fff',
    border: 'none',
    boxShadow: '0 1px 2px rgba(37,99,235,0.22)',
  },
  btnDanger: {
    background: 'linear-gradient(180deg, #dc2626 0%, #ef4444 100%)',
    color: '#fff',
    border: 'none',
    boxShadow: '0 1px 2px rgba(220,38,38,0.18)',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: T.surface,
    border: `1px solid ${T.hairline}`,
    borderRadius: 8,
    color: T.text,
    fontSize: 14,
    outline: 'none',
  },
  pill: (a) => ({
    padding: '3px 8px',
    borderRadius: 5,
    background: actColor(a, 0.15),
    color: actColor(a, 0.95),
    fontSize: 10,
    fontWeight: 600,
    display: 'inline-block',
  }),
  section: {
    fontSize: 13,
    fontWeight: 700,
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    margin: '16px 0 8px',
  },
};
