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
