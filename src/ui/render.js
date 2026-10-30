// Renderizado con pdf.js: miniaturas en caché, cola con concurrencia limitada y texto por página.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
// Un solo worker de pdf.js compartido por todos los documentos abiertos.
let sharedWorker = null;
const pdfWorker = () => (sharedWorker ??= new pdfjs.PDFWorker({ name: 'pdf-studio' }));

const docs = new Map(); // clave → Promise<PDFDocumentProxy>
const bitmaps = new Map(); // clave de miniatura → ImageBitmap
const MAX_BITMAPS = 600;

export function openDoc(key, bytes) {
  if (!docs.has(key)) {
    // pdf.js transfiere el buffer al worker: le damos una copia para conservar el original.
    const task = pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false, verbosity: 0, worker: pdfWorker() });
    docs.set(key, task.promise);
  }
  return docs.get(key);
}

export async function closeDoc(key) {
  const p = docs.get(key);
  docs.delete(key);
  for (const k of bitmaps.keys()) if (k.startsWith(`${key}|`)) bitmaps.delete(k);
  if (p) (await p.catch(() => null))?.destroy();
}

// Cola sencilla para no lanzar cientos de renderizados a la vez.
let running = 0;
const queue = [];
function schedule(job) {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < 3 && queue.length) {
    const { job, resolve, reject } = queue.shift();
    running++;
    job().then(resolve, reject).finally(() => { running--; pump(); });
  }
}

// Renderiza una página a un canvas con la rotación adicional indicada.
export async function renderPage(key, index, { width, scale, extraRotation = 0, canvas } = {}) {
  const doc = await docs.get(key);
  const page = await doc.getPage(index + 1);
  const rotation = (page.rotate + extraRotation + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = globalThis.devicePixelRatio || 1;
  const s = scale || width / base.width;
  const vp = page.getViewport({ scale: s * dpr, rotation });
  const cv = canvas || document.createElement('canvas');
  cv.width = Math.ceil(vp.width);
  cv.height = Math.ceil(vp.height);
  cv.style.width = `${Math.round(vp.width / dpr)}px`;
  cv.style.height = `${Math.round(vp.height / dpr)}px`;
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  return { canvas: cv, cssWidth: vp.width / dpr, cssHeight: vp.height / dpr, ptWidth: base.width, ptHeight: base.height };
}

export function thumbnail(key, index, width, extraRotation = 0) {
  const id = `${key}|${index}|${extraRotation}|${width}`;
  if (bitmaps.has(id)) return Promise.resolve(bitmaps.get(id));
  return schedule(async () => {
    if (bitmaps.has(id)) return bitmaps.get(id);
    const { canvas } = await renderPage(key, index, { width, extraRotation });
    const bmp = await createImageBitmap(canvas);
    if (bitmaps.size > MAX_BITMAPS) bitmaps.delete(bitmaps.keys().next().value);
    bitmaps.set(id, bmp);
    return bmp;
  });
}

export function paintBitmap(target, bmp) {
  const dpr = globalThis.devicePixelRatio || 1;
  target.width = bmp.width;
  target.height = bmp.height;
  target.style.width = `${Math.round(bmp.width / dpr)}px`;
  target.style.height = `${Math.round(bmp.height / dpr)}px`;
  target.getContext('2d').drawImage(bmp, 0, 0);
}

// Texto de la página en coordenadas visuales (origen abajo-izquierda) + indicios de escaneo.
export async function pageText(key, index) {
  const doc = await docs.get(key);
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  let chars = 0;
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    chars += it.str.trim().length;
    const [x, yTop] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    items.push({ str: it.str, x, y: vp.height - yTop });
  }
  return { width: vp.width, height: vp.height, items, chars };
}

export async function pageHasImage(key, index) {
  const doc = await docs.get(key);
  const page = await doc.getPage(index + 1);
  const ops = await page.getOperatorList();
  const img = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);
  return ops.fnArray.some((f) => img.has(f));
}
