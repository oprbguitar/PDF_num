// Utilidades de prueba: generación de PDFs sintéticos y lectura de verificación con pdf.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFNumber } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => new Uint8Array(readFileSync(join(here, 'fixtures', name)));

// Documento con N páginas; cada página lleva el texto "DOC<tag> P<n>" en el centro.
export async function makePdf(tag, n, { size = [595.28, 841.89], rotate = 0, crop = null, unbalanced = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage(size);
    page.drawText(`DOC${tag} P${i}`, { x: 100, y: size[1] / 2, size: 20, font });
    if (rotate) page.setRotation(degrees(rotate));
    if (crop) page.setCropBox(...crop);
  }
  if (unbalanced) {
    // Contenido que deja una matriz de transformación sin restaurar (q sin Q),
    // caso real en PDFs de algunos escáneres: lo añadido después no debe heredarla.
    const page = doc.getPage(0);
    const ctx = doc.context;
    const stream = ctx.flateStream('2 0 0 2 300 300 cm 0 0 1 rg 0 0 20 20 re f');
    const ref = ctx.register(stream);
    const raw = page.node.get(PDFName.of('Contents'));
    const resolved = raw ? ctx.lookup(raw) : null;
    const existing = resolved && resolved.asArray ? resolved.asArray() : raw ? [raw] : [];
    page.node.set(PDFName.of('Contents'), ctx.obj([...existing, ref]));
  }
  return doc.save();
}

// Documento de ejemplo con aspecto de expediente (solo para capturas de la documentación).
export async function makeDemo() {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const lines = [
    'Por medio del presente se remite la documentación solicitada,',
    'debidamente ordenada, para su evaluación y trámite correspondiente.',
    'Se adjuntan los anexos señalados en el índice, en copia simple.',
  ];
  const titles = ['ESCRITO DE PRESENTACIÓN (EJEMPLO)', 'ANEXO 1 — INFORME TÉCNICO', 'ANEXO 2 — CONSTANCIA', 'ANEXO 3 — ACTA'];
  for (const [k, title] of titles.entries()) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(title, { x: 72, y: 760, size: 15, font: bold });
    page.drawLine({ start: { x: 72, y: 748 }, end: { x: 523, y: 748 }, thickness: 1 });
    for (let p = 0; p < 9; p++) {
      lines.forEach((l, i) => page.drawText(l, { x: 72, y: 715 - p * 62 - i * 16, size: 11.5, font }));
    }
    page.drawText(`Documento de ejemplo · página ${k + 1}`, { x: 72, y: 60, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return doc.save();
}

// "Escaneo" sintético: página con solo una imagen, sin texto.
export async function makeScanned(pngBytes) {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(pngBytes);
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return doc.save();
}

export async function makeForm(prefix) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const name = form.createTextField('nombre');
  name.setText(`${prefix}`);
  name.addToPage(page, { x: 50, y: 300, width: 200, height: 24 });
  const ok = form.createCheckBox('acepto');
  ok.addToPage(page, { x: 50, y: 250, width: 16, height: 16 });
  return doc.save();
}

// Texto visible por página en coordenadas visuales (origen abajo-izquierda), vía pdf.js.
export async function readTexts(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
      const [x, yTop] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { str: it.str, x, y: vp.height - yTop };
    });
    pages.push({ width: vp.width, height: vp.height, rotation: page.rotate, items });
  }
  await doc.destroy();
  return pages;
}

export { PDFDocument, rgb, PDFNumber };
