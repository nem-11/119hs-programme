/**
 * Module auto-detection for the Module Handover page.
 *
 * Heavy CV/OCR libraries (OpenCV.js + Tesseract.js) are dynamically imported so
 * they are code-split out of the main bundle and only fetched when the user runs
 * a detection. Detection is best-effort and always followed by a manual review
 * step — see ModuleHandoverPage.
 */

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let cvPromise = null;
/**
 * Load OpenCV.js from CDN at runtime (script tag) rather than bundling it — the
 * npm builds require Node core modules that CRA/webpack 5 will not polyfill, and
 * the wasm payload is large, so on-demand loading keeps the app bundle lean.
 */
function getCv() {
  if (!cvPromise) {
    cvPromise = new Promise((resolve, reject) => {
      const ready = (cv) => cv && typeof cv.Mat === 'function';
      if (typeof window !== 'undefined' && ready(window.cv)) {
        resolve(window.cv);
        return;
      }
      const finish = () => {
        const cv = window.cv;
        if (ready(cv)) resolve(cv);
        else if (cv) cv.onRuntimeInitialized = () => resolve(cv);
        else reject(new Error('OpenCV failed to initialise'));
      };
      let script = document.getElementById('opencv-js-cdn');
      if (script) {
        if (window.cv) finish();
        else script.addEventListener('load', finish, { once: true });
        return;
      }
      script = document.createElement('script');
      script.id = 'opencv-js-cdn';
      script.src = OPENCV_CDN_URL;
      script.async = true;
      script.onload = finish;
      script.onerror = () => reject(new Error('Could not load the detection library (network blocked?)'));
      document.body.appendChild(script);
    });
  }
  return cvPromise;
}

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.',
        tessedit_pageseg_mode: '7', // treat the crop as a single text line
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function terminateAutoDetect() {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch (_) {}
    workerPromise = null;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Intersection-over-smaller-area — high when one box mostly sits inside another. */
function overlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Detect candidate room rectangles. Returns boxes in pixel space plus image
 * dimensions. Tuned for clean line plans: keeps 4-sided contours within a size
 * band and drops the page border / title block (too big) and furniture (too small).
 */
async function detectBoxesPx(img, opts = {}) {
  const cv = await getCv();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

  const imgArea = canvas.width * canvas.height;
  const minArea = (opts.minAreaFrac ?? 0.0006) * imgArea;
  const maxArea = (opts.maxAreaFrac ?? 0.06) * imgArea;
  const minAspect = opts.minAspect ?? 0.25;
  const maxAspect = opts.maxAspect ?? 4.0;

  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const dil = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const boxes = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 40, 120);
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, dil, kernel, new cv.Point(-1, -1), 1);
    kernel.delete();
    cv.findContours(dil, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.03 * peri, true);
      const isQuad = approx.rows === 4 && cv.isContourConvex(approx);
      if (isQuad) {
        const r = cv.boundingRect(approx);
        const area = r.width * r.height;
        const aspect = r.width / Math.max(1, r.height);
        if (area >= minArea && area <= maxArea && aspect >= minAspect && aspect <= maxAspect) {
          boxes.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        }
      }
      approx.delete();
      cnt.delete();
    }
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    dil.delete();
    contours.delete();
    hierarchy.delete();
  }

  // Dedupe near-duplicate / nested rectangles (keep the larger of an overlapping pair).
  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  const kept = [];
  for (const b of boxes) {
    if (kept.some((k) => overlapRatio(k, b) > 0.6)) continue;
    kept.push(b);
  }
  return { boxes: kept, canvas, imgW: canvas.width, imgH: canvas.height };
}

function pickModuleNumber(text) {
  const raw = String(text || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  // Prefer a 2–4 digit run (room numbers like 501); else an alphanumeric token.
  const digits = raw.match(/\d{2,4}/g);
  if (digits && digits.length) return digits.sort((a, b) => b.length - a.length)[0];
  const token = raw.match(/[A-Z0-9-]{2,}/);
  return token ? token[0] : '';
}

/**
 * Full pipeline: detect boxes then OCR a number inside each.
 * Returns modules as percentage geometry: [{ x, y, w, h, name }] (0–100 space).
 * onProgress(phase, current, total) — phase is 'detect' | 'ocr'.
 */
export async function autoDetectModules(imageDataBase64, { onProgress } = {}) {
  const report = (phase, cur, total) => {
    if (typeof onProgress === 'function') onProgress(phase, cur, total);
  };
  report('detect', 0, 1);
  const img = await loadImage(`data:image/jpeg;base64,${imageDataBase64}`);
  const { boxes, canvas, imgW, imgH } = await detectBoxesPx(img);
  report('detect', 1, 1);

  const result = [];
  if (!boxes.length) return result;

  let worker = null;
  try {
    worker = await getWorker();
  } catch (_) {
    worker = null;
  }

  const ocrCanvas = document.createElement('canvas');
  const octx = ocrCanvas.getContext('2d');
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    report('ocr', i, boxes.length);
    let name = '';
    if (worker) {
      try {
        const scale = 3;
        const pad = Math.round(Math.min(b.w, b.h) * 0.08);
        const sx = Math.max(0, b.x + pad);
        const sy = Math.max(0, b.y + pad);
        const sw = Math.min(imgW - sx, b.w - 2 * pad);
        const sh = Math.min(imgH - sy, b.h - 2 * pad);
        if (sw > 4 && sh > 4) {
          ocrCanvas.width = Math.round(sw * scale);
          ocrCanvas.height = Math.round(sh * scale);
          octx.fillStyle = '#fff';
          octx.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);
          octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, ocrCanvas.width, ocrCanvas.height);
          const { data } = await worker.recognize(ocrCanvas);
          name = pickModuleNumber(data?.text);
        }
      } catch (_) {
        name = '';
      }
    }
    result.push({
      x: (b.x / imgW) * 100,
      y: (b.y / imgH) * 100,
      w: (b.w / imgW) * 100,
      h: (b.h / imgH) * 100,
      name,
    });
  }
  report('ocr', boxes.length, boxes.length);

  // Order top-to-bottom, left-to-right so the review list reads naturally.
  result.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));
  return result;
}
