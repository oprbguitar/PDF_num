// Análisis previo de un PDF para advertir al usuario antes de modificarlo.
import { PDFName, PDFDict, PDFArray, PDFSignature } from 'pdf-lib';
import { loadSource, EncryptedPdfError } from './organize.js';

export async function analyzePdf(bytes, name) {
  const info = {
    name, size: bytes.byteLength, encrypted: false, pageCount: 0,
    fieldCount: 0, hasSignatures: false, hasJavaScript: false, hasOutline: false,
    warnings: [],
  };
  let doc;
  try {
    doc = await loadSource(bytes, name);
  } catch (err) {
    if (err instanceof EncryptedPdfError) {
      info.encrypted = true;
      info.warnings.push('Documento cifrado o con permisos restringidos: solo se puede visualizar.');
      return { info, doc: null };
    }
    throw err;
  }
  info.pageCount = doc.getPageCount();
  const catalog = doc.catalog;
  const acro = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (acro) {
    try {
      const fields = doc.getForm().getFields();
      info.fieldCount = fields.length;
      info.hasSignatures = fields.some((f) => f instanceof PDFSignature);
    } catch {
      const arr = acro.lookupMaybe(PDFName.of('Fields'), PDFArray);
      info.fieldCount = arr ? arr.size() : 0;
    }
    if (acro.get(PDFName.of('XFA'))) info.warnings.push('Contiene formularios XFA: Chrome y esta extensión solo conservan la parte AcroForm.');
  }
  info.hasOutline = Boolean(catalog.get(PDFName.of('Outlines')));
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  info.hasJavaScript = Boolean(names && names.get(PDFName.of('JavaScript'))) || Boolean(catalog.get(PDFName.of('OpenAction')));
  if (info.hasSignatures) info.warnings.push('Tiene firmas digitales: cualquier modificación las invalidará (la firma visible se conserva como imagen).');
  if (info.fieldCount) info.warnings.push(`Tiene ${info.fieldCount} campo(s) de formulario: se conservan al combinar; los nombres repetidos se renombran.`);
  if (info.hasOutline) info.warnings.push('Tiene marcadores (índice): no se trasladan al documento combinado.');
  if (info.hasJavaScript) info.warnings.push('Contiene acciones o JavaScript a nivel de documento: no se trasladan.');
  return { info, doc };
}

// Página "escaneada": sin texto extraíble y con al menos una imagen. textItems lo calcula pdf.js.
export function looksScanned(textCharCount, hasImage) {
  return textCharCount < 8 && hasImage;
}

// Detección de foliación previa a partir del texto de cada página (pdf.js getTextContent).
// pageTexts: [{ width, height, items: [{ str, x, y }] }] en coordenadas visuales.
const FOLIO_RE = /^(?:(?:folio|fol\.|f\.|p[aá]g(?:ina)?\.?|p\.)\s*[:#nº°.-]*\s*)?([0-9]{1,6}|[ivxlcdm]{1,8})(?:\s*(?:de|\/)\s*\d+)?$/i;

export function detectExistingFolio(pageTexts) {
  const hits = [];
  pageTexts.forEach((pt, i) => {
    if (!pt) return;
    const band = pt.height * 0.12;
    for (const it of pt.items) {
      const s = it.str.trim();
      if (!s || s.length > 24) continue;
      const inBand = it.y > pt.height - band || it.y < band;
      if (inBand && FOLIO_RE.test(s)) { hits.push({ page: i + 1, text: s }); break; }
    }
  });
  const withText = pageTexts.filter((p) => p && p.items.length).length;
  const ratio = withText ? hits.length / withText : 0;
  return {
    likely: hits.length >= 2 && ratio >= 0.4,
    ratio,
    hits: hits.slice(0, 12),
    pagesWithoutText: pageTexts.length - withText,
  };
}
