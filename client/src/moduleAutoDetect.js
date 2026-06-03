/**
 * Module auto-detection for the Module Handover page.
 *
 * Heavy CV/OCR libraries (OpenCV.js + Tesseract.js) are dynamically imported so
 * they are code-split out of the main bundle and only fetched when the user runs
 * a detection. Detection is best-effort and always followed by a manual review
 * step — see ModuleHandoverPage.
 */

const DETECT_TIMEOUT_MS = 90000;

let detectWorker = null;
let detectSeq = 0;

/**
 * OpenCV box detection runs in a dedicated Web Worker (moduleDetectWorker.js) so
 * the heavy wasm init + contour scan never block the main thread / freeze the UI.
 * The worker loads OpenCV from CDN itself; here we just ship pixels and get boxes.
 */
function getDetectWorker() {
  if (!detectWorker) {
    detectWorker = new Worker(new URL('./moduleDetectWorker.js', import.meta.url));
  }
  return detectWorker;
}

function killDetectWorker() {
  if (detectWorker) {
    try {
      detectWorker.terminate();
    } catch (_) {}
    detectWorker = null;
  }
}

function detectBoxesViaWorker(imageData, opts = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = getDetectWorker();
    } catch (_) {
      reject(new Error('Could not start the detection engine in this browser.'));
      return;
    }
    const id = ++detectSeq;
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
    };
    const timer = setTimeout(() => {
      cleanup();
      killDetectWorker(); // a stuck worker is dead to us; next run starts fresh
      reject(new Error('Detection timed out. Try a cleaner plan or use the manual Box/Polygon tools.'));
    }, DETECT_TIMEOUT_MS);
    const onMsg = (e) => {
      if (!e.data || e.data.id !== id) return;
      cleanup();
      if (e.data.ok) resolve(e.data.boxes || []);
      else reject(new Error(e.data.error || 'Detection failed'));
    };
    const onErr = () => {
      cleanup();
      killDetectWorker();
      reject(new Error('Detection engine error. Use the manual Box/Polygon tools.'));
    };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
    // Transfer the pixel buffer (zero-copy); the source canvas keeps its own pixels.
    worker.postMessage({ id, imageData, opts }, [imageData.data.buffer]);
  });
}

/** Reject after `ms` so a stuck CDN download (worker core / lang data) can't hang detection. */
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg || 'Timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
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
    })().catch((e) => {
      workerPromise = null; // allow retry on next run
      throw e;
    });
  }
  return workerPromise;
}

export async function terminateAutoDetect() {
  killDetectWorker();
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

/**
 * Detect candidate room rectangles. Returns boxes in pixel space plus image
 * dimensions. Tuned for clean line plans: keeps 4-sided contours within a size
 * band and drops the page border / title block (too big) and furniture (too small).
 */
async function detectBoxesPx(img, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Snapshot pixels for the worker (its buffer is transferred); the canvas keeps
  // its own pixels for OCR crops afterwards.
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const boxes = await detectBoxesViaWorker(imageData, opts);
  return { boxes, canvas, imgW: canvas.width, imgH: canvas.height };
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
    worker = await withTimeout(getWorker(), 30000, 'OCR engine timed out');
  } catch (_) {
    worker = null; // detection still returns boxes; numbers are filled in during review
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
          const { data } = await withTimeout(worker.recognize(ocrCanvas), 8000, 'OCR timed out');
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
