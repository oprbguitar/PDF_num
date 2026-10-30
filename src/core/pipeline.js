// Orquestación: del estado del espacio de trabajo a un PDF final verificado.
import { PDFDocument } from 'pdf-lib';
import { buildDocument, saveDocument, loadSource } from './organize.js';
import { applyEdits, fillForm } from './edit.js';
import { computeLabels, applyFolio } from './folio.js';

// state.pages: [{ uid, src, index, rotate } | { uid, blank }]
// state.edits: [{ pageUid, type, … }]
// state.formValues: { idFuente: { nombreCampo: valor } }
// state.folio: configuración o null
export async function exportWorkspace(sources, state, { onProgress, signal, flattenForms = false } = {}) {
  if (!state.pages.length) throw new Error('No hay páginas para exportar.');
  // Los formularios se rellenan sobre una copia en memoria de cada documento fuente,
  // antes de combinar, para que los nombres de campo coincidan con los originales.
  const srcs = new Map(sources);
  for (const [id, values] of Object.entries(state.formValues || {})) {
    if (!srcs.has(id) || !values || !Object.keys(values).length) continue;
    const filled = await loadSource(srcs.get(id), id);
    fillForm(filled, values, { flatten: flattenForms });
    srcs.set(id, filled);
  }
  const doc = await buildDocument(srcs, state, {
    signal, onProgress: (f) => onProgress && onProgress(f * 0.7),
  });
  const indexOf = new Map(state.pages.map((p, i) => [p.uid, i]));
  const edits = (state.edits || [])
    .filter((e) => indexOf.has(e.pageUid))
    .map((e) => ({ ...e, page: indexOf.get(e.pageUid) }));
  if (edits.length) await applyEdits(doc, edits);
  let labels = null;
  if (state.folio && state.folio.enabled !== false) {
    labels = computeLabels(state.pages.length, state.folio, { docStarts: docStarts(state.pages) });
    await applyFolio(doc, labels, state.folio);
  }
  if (onProgress) onProgress(0.9);
  const bytes = await saveDocument(doc);
  await verifyOutput(bytes, state.pages.length);
  if (onProgress) onProgress(1);
  return { bytes, labels };
}

// Índices donde empieza cada documento fuente distinto (para reinicio por documento).
export function docStarts(pages) {
  const starts = [];
  let prev;
  pages.forEach((p, i) => {
    const key = p.blank ? prev : p.src;
    if (i === 0 || key !== prev) starts.push(i);
    prev = key;
  });
  return starts;
}

// Reabre el resultado y comprueba que es un PDF válido con el número de páginas esperado.
export async function verifyOutput(bytes, expectedPages) {
  const doc = await PDFDocument.load(bytes);
  const n = doc.getPageCount();
  if (n !== expectedPages) throw new Error(`Verificación fallida: se esperaban ${expectedPages} páginas y hay ${n}.`);
  return true;
}
