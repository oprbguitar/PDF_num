// Worker de exportación: todo el trabajo pesado con pdf-lib ocurre fuera del hilo de la
// interfaz. Cancelar = terminar el worker (el hilo principal crea uno nuevo).
import { PDFDocument } from 'pdf-lib';
import { exportWorkspace } from '../core/pipeline.js';
import { analyzePdf } from '../core/inspect.js';
import { listFormFields } from '../core/edit.js';
import { buildDocument, saveDocument, loadSource } from '../core/organize.js';
import { readBlocks, blockBox } from '../core/textedit.js';

// Fuentes métricamente compatibles empaquetadas en fonts/pdf/ (OFL).
const fontCache = new Map();
async function fontProvider({ family, bold, italic }) {
  const file = `${family}-${bold ? 700 : 400}-${italic ? 'italic' : 'normal'}.woff`;
  if (!fontCache.has(file)) {
    fontCache.set(file, fetch(new URL(`../fonts/pdf/${file}`, import.meta.url)).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null));
  }
  return fontCache.get(file);
}

const docs = new Map(); // fuente → Promise<PDFDocument> (solo lectura, para analizar texto)
const sourceDoc = (id, bytes) => {
  if (!docs.has(id)) docs.set(id, loadSource(bytes, id));
  return docs.get(id);
};
const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  const progress = (f) => self.postMessage({ id, progress: f });
  try {
    if (cmd === 'analyze') {
      const { info, doc } = await analyzePdf(data.bytes, data.name);
      const fields = doc ? listFormFields(doc) : [];
      self.postMessage({ id, result: { info, fields } });
    } else if (cmd === 'export') {
      const sources = new Map(data.sources);
      const { bytes, labels } = await exportWorkspace(sources, data.state, { onProgress: progress, flattenForms: data.flattenForms, fontProvider });
      self.postMessage({ id, result: { bytes, labels } }, [bytes.buffer]);
    } else if (cmd === 'pages') {
      // Extraer/separar: construye un PDF solo con las páginas indicadas.
      const doc = await buildDocument(new Map(data.sources), { pages: data.pages }, { onProgress: progress });
      const bytes = await saveDocument(doc);
      self.postMessage({ id, result: { bytes } }, [bytes.buffer]);
    } else if (cmd === 'textblocks') {
      // Párrafos editables de una página fuente, con su caja en coordenadas visuales.
      const doc = await sourceDoc(data.src, data.bytes);
      const page = doc.getPage(data.index);
      const { blocks } = readBlocks(page);
      const out = blocks.map((b) => ({
        index: b.index, text: b.text, editable: b.editable, reason: b.reason, invisible: b.invisible,
        lines: b.lines.length, size: b.size, lead: b.lead, angle: b.angle, color: hex(b.color),
        font: b.font ? b.font.baseFont : '', box: blockBox(page, b),
      }));
      const { width, height } = page.getSize();
      self.postMessage({ id, result: { blocks: out, size: { width, height } } });
    } else if (cmd === 'preview') {
      // Una sola página con sus correcciones de texto aplicadas (sin objetos añadidos).
      const state = { pages: [{ uid: 'p', src: data.src, index: data.index, rotate: 0 }], edits: data.edits.map((e) => ({ ...e, pageUid: 'p' })) };
      const { bytes } = await exportWorkspace(new Map([[data.src, data.bytes]]), state, { fontProvider });
      self.postMessage({ id, result: { bytes } }, [bytes.buffer]);
    } else if (cmd === 'images') {
      // Cada imagen se convierte en un PDF de una página con su tamaño (96 ppp → puntos).
      const out = [];
      for (const img of data.images) {
        const doc = await PDFDocument.create();
        const embedded = img.png ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        const w = embedded.width * 0.75; const h = embedded.height * 0.75;
        const scale = Math.min(1, 1190 / Math.max(w, h));
        const page = doc.addPage([w * scale, h * scale]);
        page.drawImage(embedded, { x: 0, y: 0, width: w * scale, height: h * scale });
        out.push(await doc.save());
      }
      self.postMessage({ id, result: { pdfs: out } }, out.map((b) => b.buffer));
    } else if (cmd === 'forget') {
      docs.delete(data.src);
      self.postMessage({ id, result: true });
    } else {
      throw new Error(`Orden desconocida: ${cmd}`);
    }
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
