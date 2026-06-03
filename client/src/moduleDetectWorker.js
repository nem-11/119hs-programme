/* eslint-disable no-restricted-globals */
/**
 * OpenCV box-detection worker for Module Handover auto-detect.
 *
 * Runs entirely off the main thread so the heavy wasm init + contour scan can
 * never freeze the UI ("Page Unresponsive"). The page sends raw image pixels
 * (ImageData) plus tuning options; we return candidate room boxes in pixel
 * space. OCR (Tesseract) stays on the page side in its own worker.
 */

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.10.0/opencv.js';
const READY_TIMEOUT_MS = 60000;

let cvReady = null;
function loadCv() {
  if (cvReady) return cvReady;
  cvReady = new Promise((resolve, reject) => {
    try {
      importScripts(OPENCV_CDN_URL);
    } catch (e) {
      cvReady = null;
      reject(new Error('Could not load the detection library (network blocked?).'));
      return;
    }
    const start = Date.now();
    const t = setInterval(() => {
      if (self.cv && typeof self.cv.Mat === 'function') {
        clearInterval(t);
        resolve(self.cv);
      } else if (Date.now() - start > READY_TIMEOUT_MS) {
        clearInterval(t);
        cvReady = null;
        reject(new Error('Detection library timed out while starting.'));
      }
    }, 100);
  });
  return cvReady;
}

function overlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

function detectBoxes(cv, imageData, opts = {}) {
  const imgW = imageData.width;
  const imgH = imageData.height;
  const imgArea = imgW * imgH;
  const minArea = (opts.minAreaFrac ?? 0.0006) * imgArea;
  const maxArea = (opts.maxAreaFrac ?? 0.06) * imgArea;
  const minAspect = opts.minAspect ?? 0.25;
  const maxAspect = opts.maxAspect ?? 4.0;

  const src = cv.matFromImageData(imageData);
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

  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  const kept = [];
  for (const b of boxes) {
    if (kept.some((k) => overlapRatio(k, b) > 0.6)) continue;
    kept.push(b);
  }
  return kept;
}

self.onmessage = async (e) => {
  const { id, imageData, opts } = e.data || {};
  try {
    const cv = await loadCv();
    const boxes = detectBoxes(cv, imageData, opts);
    self.postMessage({ id, ok: true, boxes });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || 'Detection failed' });
  }
};
