// OCR opcional con tesseract.js, completamente local: worker, núcleo WASM y datos de
// idioma español se empaquetan con la extensión (no se descarga nada en tiempo de uso).
import { createWorker } from 'tesseract.js';

let workerP = null;

function getWorker(onProgress) {
  if (!workerP) {
    const base = new URL('../vendor/tesseract/', import.meta.url).href;
    workerP = createWorker('spa', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: (m) => onProgress && m.status === 'recognizing text' && onProgress(m.progress),
    });
  }
  return workerP;
}

// canvas: página renderizada (orientación visual). Devuelve palabras normalizadas 0–1.
export async function recognize(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const W = canvas.width;
  const H = canvas.height;
  const words = [];
  for (const block of data.blocks || []) {
    for (const par of block.paragraphs) {
      for (const line of par.lines) {
        for (const w of line.words) {
          if (!w.text.trim() || w.confidence < 30) continue;
          words.push({
            text: w.text, conf: Math.round(w.confidence),
            x: w.bbox.x0 / W, y: w.bbox.y0 / H, w: (w.bbox.x1 - w.bbox.x0) / W, h: (w.bbox.y1 - w.bbox.y0) / H,
          });
        }
      }
    }
  }
  return { text: data.text, confidence: Math.round(data.confidence), words };
}

export async function terminateOcr() {
  if (workerP) (await workerP).terminate();
  workerP = null;
}
