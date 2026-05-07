/* Copies pdf.js worker into public/ so CRA can serve it without bundling issues (pdfjs-dist v3). */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const candidates = [
  path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js'),
  path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.js'),
];
const destDir = path.join(root, 'public');
const dest = path.join(destDir, 'pdf.worker.min.js');
const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
  console.warn('[copy-pdf-worker] pdfjs-dist worker not found; run npm install in client/.');
  process.exit(0);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-pdf-worker] copied to public/pdf.worker.min.js');
