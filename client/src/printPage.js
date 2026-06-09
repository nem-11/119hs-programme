const PRINT_PAGE_STYLE_ID = 'app-print-page-style';

/** CSS / browser print layout uses 96 CSS px per inch (same basis as Zone setup A3 print). */
export const PRINT_DPI = 96;
export const PRINT_MARGIN_MM = 10;

export function mmToPrintPx(mm) {
  return (mm * PRINT_DPI) / 25.4;
}

/**
 * Printable area inside @page margins, in physical CSS pixels (not getBoundingClientRect).
 */
export function printableAreaPx(paper, orientation) {
  const p = String(paper || 'A3').toUpperCase();
  const o = String(orientation || 'landscape').toLowerCase();
  const dims = PAPER_DIMS_MM[p] || PAPER_DIMS_MM.A3;
  const [shortSide, longSide] = dims;
  const portrait = o === 'portrait';
  const widthMm = portrait ? shortSide : longSide;
  const heightMm = portrait ? longSide : shortSide;
  const marginPx = mmToPrintPx(PRINT_MARGIN_MM);
  return {
    widthPx: mmToPrintPx(widthMm) - 2 * marginPx,
    heightPx: mmToPrintPx(heightMm) - 2 * marginPx,
  };
}

/**
 * ISO paper dimensions in millimetres, expressed as [shortSide, longSide].
 * CSS `@page { size: <name> }` only recognises A5/A4/A3, so for A2/A1/A0 we
 * must emit explicit physical dimensions to get a correctly sized sheet.
 */
export const PAPER_DIMS_MM = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
};

export function setPrintPageSize({ paper = 'A3', orientation = 'landscape', margin = `${PRINT_MARGIN_MM}mm` } = {}) {
  const p = String(paper || 'A3').toUpperCase();
  const o = String(orientation || 'landscape').toLowerCase();
  const dims = PAPER_DIMS_MM[p];

  let sizeRule;
  if (dims) {
    const [shortSide, longSide] = dims;
    const widthMm = o === 'portrait' ? shortSide : longSide;
    const heightMm = o === 'portrait' ? longSide : shortSide;
    sizeRule = `${widthMm}mm ${heightMm}mm`;
  } else {
    sizeRule = `${p} ${o}`;
  }

  let el = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = PRINT_PAGE_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `@media print { @page { size: ${sizeRule}; margin: ${margin}; } }`;
  return { paper: p, orientation: o };
}

export function clearPrintPageSize() {
  const el = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (el) el.remove();
}
