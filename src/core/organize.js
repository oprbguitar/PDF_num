// Organizador / combinador: construye un PDF nuevo a partir de una lista ordenada de
// referencias a páginas de documentos fuente. Los documentos originales nunca se modifican.
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, degrees } from 'pdf-lib';
import { normRotation } from './geometry.js';

export const A4 = [595.28, 841.89];

export class EncryptedPdfError extends Error {
  constructor(name) {
    super(`"${name}" está cifrado o tiene restricciones de edición. No se puede modificar sin la contraseña de propietario.`);
    this.name = 'EncryptedPdfError';
  }
}

export async function loadSource(bytes, name = 'documento.pdf') {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) throw new EncryptedPdfError(name);
    throw new Error(`"${name}" no es un PDF válido o está dañado (${err.message}).`);
  }
}

// spec.pages: [{ src, index, rotate }] o [{ blank: { width, height } }]
// sources: Map<src, PDFDocument | Uint8Array>
export async function buildDocument(sources, spec, { onProgress, signal } = {}) {
  const out = await PDFDocument.create();
  out.setProducer('PDF Studio');
  out.setCreator('PDF Studio (extensión de Chrome)');
  const loaded = new Map();
  const getSrc = async (id) => {
    if (!loaded.has(id)) {
      const s = sources.get(id);
      if (!s) throw new Error(`Documento fuente no encontrado: ${id}`);
      loaded.set(id, s instanceof PDFDocument ? s : await loadSource(s, id));
    }
    return loaded.get(id);
  };
  // Copiamos página a página en el orden pedido. copyPages por lote de un mismo
  // documento consecutivo para no duplicar recursos compartidos innecesariamente.
  const runs = [];
  for (const p of spec.pages) {
    const last = runs[runs.length - 1];
    if (!p.blank && last && !last.blank && last.src === p.src) last.items.push(p);
    else runs.push(p.blank ? { blank: p.blank, items: [p] } : { src: p.src, items: [p] });
  }
  let done = 0;
  const fieldNames = new Set();
  for (const run of runs) {
    if (signal && signal.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    if (run.blank) {
      out.addPage([run.blank.width || A4[0], run.blank.height || A4[1]]);
      done++;
      continue;
    }
    const src = await getSrc(run.src);
    const count = src.getPageCount();
    for (const it of run.items) {
      if (it.index < 0 || it.index >= count) throw new Error(`La página ${it.index + 1} no existe en ${run.src}`);
    }
    const copied = await out.copyPages(src, run.items.map((it) => it.index));
    copied.forEach((page, k) => {
      const extra = run.items[k].rotate || 0;
      if (extra) page.setRotation(degrees(normRotation(page.getRotation().angle + extra)));
      out.addPage(page);
      collectFormFields(out, page, fieldNames);
    });
    done += run.items.length;
    if (onProgress) onProgress(done / spec.pages.length);
    // Cede el hilo para no bloquear la interfaz en documentos grandes.
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

// Los widgets se copian con la página, pero el diccionario /AcroForm no. Lo reconstruimos
// para que los campos sigan siendo editables. Si dos documentos tienen un campo con el mismo
// nombre se renombra el segundo (sufijo _2, _3…) para que no se fusionen sin querer.
function collectFormFields(doc, page, names) {
  const annots = page.node.Annots();
  if (!annots) return;
  const ctx = doc.context;
  const roots = new Set();
  for (let i = 0; i < annots.size(); i++) {
    let ref = annots.get(i);
    let dict = ctx.lookup(ref);
    if (!(dict instanceof PDFDict) || dict.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
    // Sube por /Parent hasta el campo raíz.
    let guard = 0;
    while (dict.get(PDFName.of('Parent')) && guard++ < 32) {
      ref = dict.get(PDFName.of('Parent'));
      dict = ctx.lookup(ref);
    }
    if (dict.get(PDFName.of('T')) || dict.get(PDFName.of('FT'))) roots.add(ref);
  }
  if (!roots.size) return;
  let acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acro) {
    acro = ctx.obj({ Fields: [] });
    doc.catalog.set(PDFName.of('AcroForm'), ctx.register(acro));
  }
  let fields = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) { fields = ctx.obj([]); acro.set(PDFName.of('Fields'), fields); }
  const present = new Set(fields.asArray().map(String));
  for (const ref of roots) {
    if (present.has(String(ref))) continue;
    const dict = ctx.lookup(ref);
    const t = dict.get(PDFName.of('T'));
    if (t instanceof PDFString || t instanceof PDFHexString) {
      const base = t.decodeText();
      let name = base;
      for (let k = 2; names.has(name); k++) name = `${base}_${k}`;
      if (name !== base) dict.set(PDFName.of('T'), PDFHexString.fromText(name));
      names.add(name);
    }
    fields.push(ref);
    present.add(String(ref));
  }
}

// Divide una lista de páginas (base 1) en grupos según "1-3, 4-8".
export function splitRanges(text, pageCount) {
  const groups = [];
  for (const raw of String(text || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(raw);
    if (!m) throw new Error(`Rango no válido: "${raw}"`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > pageCount) throw new Error(`Rango fuera del documento: "${raw}"`);
    groups.push({ label: a === b ? `${a}` : `${a}-${b}`, from: a - 1, to: b - 1 });
  }
  if (!groups.length) throw new Error('Indica al menos un rango.');
  return groups;
}

export async function saveDocument(doc) {
  return doc.save({ useObjectStreams: true });
}
