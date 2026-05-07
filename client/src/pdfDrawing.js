/**
 * PDF → JPEG rasterization using pdfjs-dist **v3** (CommonJS build) + worker file in `public/`.
 * CRA/webpack 5 often breaks on pdfjs-dist v4 `*.mjs` entry points; v3 + copied worker is reliable.
 */
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  const prefix = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const rel = prefix ? `${prefix}/pdf.worker.min.js` : '/pdf.worker.min.js';
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(rel, window.location.href).href;
}

/**
 * Rasterize PDF page 1 to JPEG base64 (no data: prefix), max width like image uploads.
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ maxWidth?: number, jpegQuality?: number }} [options]
 * @returns {Promise<{ width: number, height: number, base64: string }>}
 */
export async function rasterizePdfFirstPageToJpeg(arrayBuffer, options = {}) {
  const maxWidth = options.maxWidth ?? 1920;
  const jpegQuality = options.jpegQuality ?? 0.85;

  let pdf;
  try {
    const task = pdfjsLib.getDocument({ data: arrayBuffer });
    pdf = await task.promise;
  } catch {
    throw new Error(
      'Could not open this PDF. It may be corrupted, empty, or password-protected.'
    );
  }

  if (!pdf || pdf.numPages < 1) {
    try {
      pdf?.destroy?.();
    } catch {
      /* ignore */
    }
    throw new Error('This PDF has no pages to display.');
  }

  let page;
  try {
    page = await pdf.getPage(1);
  } catch {
    try {
      pdf.destroy?.();
    } catch {
      /* ignore */
    }
    throw new Error('Could not read the first page of this PDF.');
  }

  const baseVp = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / baseVp.width, 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    try {
      page.cleanup?.();
      pdf.destroy?.();
    } catch {
      /* ignore */
    }
    throw new Error('Could not prepare the drawing preview.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
  } catch {
    try {
      page.cleanup?.();
      pdf.destroy?.();
    } catch {
      /* ignore */
    }
    throw new Error(
      'Could not render this PDF. Try exporting page 1 as PNG or JPEG and upload that instead.'
    );
  }

  try {
    page.cleanup?.();
    pdf.destroy?.();
  } catch {
    /* ignore */
  }

  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
  const base64 = dataUrl.split(',')[1];
  return { width: canvas.width, height: canvas.height, base64 };
}

export function isPdfFile(file) {
  if (!file) return false;
  const t = (file.type || '').toLowerCase();
  if (t === 'application/pdf') return true;
  const n = file.name || '';
  return /\.pdf$/i.test(n);
}
