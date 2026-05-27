const PRINT_PAGE_STYLE_ID = 'app-print-page-style';

export function setPrintPageSize({ paper = 'A3', orientation = 'landscape', margin = '10mm' } = {}) {
  const p = String(paper || 'A3').toUpperCase();
  const o = String(orientation || 'landscape').toLowerCase();
  let el = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = PRINT_PAGE_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `@media print { @page { size: ${p} ${o}; margin: ${margin}; } }`;
  return { paper: p, orientation: o };
}

export function clearPrintPageSize() {
  const el = document.getElementById(PRINT_PAGE_STYLE_ID);
  if (el) el.remove();
}
