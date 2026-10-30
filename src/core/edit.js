// Editor: aplica objetos añadidos (texto, imagen, rectángulo, trazo a mano, capa OCR)
// y valores de formulario sobre un PDFDocument. Las coordenadas de cada objeto son
// normalizadas (0–1) respecto a la página tal como se ve, origen arriba-izquierda,
// para que la interfaz pueda trabajar a cualquier zoom.
import fontkit from '@pdf-lib/fontkit';
import {
  pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode, setCharacterSpacing,
} from 'pdf-lib';
import { StandardFonts, rgb, degrees, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from 'pdf-lib';
import { pageBox, visualSize, visualToUser, hexToRgb01 } from './geometry.js';
import { FONTS } from './folio.js';

// Convierte un rectángulo normalizado (arriba-izquierda) a coordenadas visuales en puntos.
function toVisual(vis, nx, ny, nw = 0, nh = 0) {
  return { u: nx * vis.width, v: vis.height * (1 - ny - nh), w: nw * vis.width, h: nh * vis.height };
}

// Quita caracteres que las fuentes estándar (WinAnsi) no pueden codificar.
export function winAnsiSafe(text) {
  return String(text).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n€]/g, '?');
}

const FACE = { Helvetica: 'arimo', Times: 'tinos', Courier: 'cousine' };

export async function applyEdits(pdfDoc, edits, { fontProvider } = {}) {
  const pages = pdfDoc.getPages();
  const fontCache = new Map();
  const font = async (name) => {
    if (!fontCache.has(name)) fontCache.set(name, await pdfDoc.embedFont(FONTS[name] || StandardFonts.Helvetica));
    return fontCache.get(name);
  };
  // Fuente con Unicode completo (tildes, ñ, €, comillas) si hay proveedor; si no, estándar.
  const unicodeFont = async (name) => {
    const family = FACE[name.split('-')[0]] || 'arimo';
    const bold = /Bold/.test(name);
    const key = `u:${family}:${bold}`;
    if (!fontCache.has(key)) {
      let entry = null;
      if (fontProvider) {
        const bytes = await fontProvider({ family, bold, italic: false });
        if (bytes) {
          pdfDoc.registerFontkit(fontkit);
          entry = { font: await pdfDoc.embedFont(bytes, { subset: true }), safe: (t) => t };
        }
      }
      fontCache.set(key, entry || { font: await font(name), safe: winAnsiSafe });
    }
    return fontCache.get(key);
  };
  for (const e of edits) {
    const page = pages[e.page];
    if (!page) throw new Error(`La página ${e.page + 1} no existe.`);
    if (!['ink', 'ocr', 'textedit'].includes(e.type) && ![e.x, e.y, e.w ?? 0, e.h ?? 0].every(Number.isFinite)) {
      throw new Error(`Un objeto de la página ${e.page + 1} tiene una posición no válida. Elimínalo y vuelve a crearlo.`);
    }
    const box = pageBox(page);
    const rot = page.getRotation().angle;
    const vis = visualSize(box, rot);
    const r = toVisual(vis, e.x, e.y, e.w, e.h);
    switch (e.type) {
      case 'text': {
        const uf = await unicodeFont(e.font || 'Helvetica');
        const f = uf.font;
        const size = Number(e.size) || 12;
        const { r: cr, g, b } = hexToRgb01(e.color || '#000000');
        const lines = uf.safe(e.text || '').split('\n');
        const lh = size * 1.2;
        const ascent = f.heightAtSize(size, { descender: false });
        lines.forEach((line, k) => {
          const p = visualToUser(box, rot, r.u, vis.height * (1 - e.y) - ascent - k * lh);
          page.drawText(line, { x: p.x, y: p.y, size, font: f, color: rgb(cr, g, b), rotate: degrees(p.angle) });
        });
        break;
      }
      case 'rect':
      case 'cover': {
        const c = visualToUser(box, rot, r.u, r.v);
        const fill = hexToRgb01(e.fill || (e.type === 'cover' ? '#FFFFFF' : '#FFE066'));
        const opts = {
          x: c.x, y: c.y, width: r.w, height: r.h, rotate: degrees(c.angle),
          color: rgb(fill.r, fill.g, fill.b), opacity: e.type === 'cover' ? 1 : (e.opacity ?? 0.35),
        };
        if (e.stroke) {
          const s = hexToRgb01(e.stroke);
          opts.borderColor = rgb(s.r, s.g, s.b);
          opts.borderWidth = e.strokeWidth || 1;
        }
        page.drawRectangle(opts);
        break;
      }
      case 'image': {
        const bytes = e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes);
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
        const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        const c = visualToUser(box, rot, r.u, r.v);
        page.drawImage(img, { x: c.x, y: c.y, width: r.w, height: r.h, rotate: degrees(c.angle), opacity: e.opacity ?? 1 });
        break;
      }
      case 'ink': {
        const { r: cr, g, b } = hexToRgb01(e.color || '#0B2E6B');
        let d = '';
        for (const stroke of e.strokes) {
          stroke.forEach(([nx, ny], k) => {
            const pt = visualToUser(box, rot, nx * vis.width, vis.height * (1 - ny));
            d += `${k ? 'L' : 'M'}${pt.x.toFixed(2)} ${(-pt.y).toFixed(2)} `;
          });
        }
        if (d) page.drawSvgPath(d, { x: 0, y: 0, borderColor: rgb(cr, g, b), borderWidth: e.width || 1.6, borderLineCap: 1 });
        break;
      }
      case 'ocr': {
        // Capa de texto invisible (opacidad 0) para buscar y seleccionar en páginas escaneadas.
        const f = await font('Helvetica');
        for (const w of e.words) {
          const text = winAnsiSafe(w.text).replace(/\n/g, ' ').trim();
          if (!text) continue;
          const wr = toVisual(vis, w.x, w.y, w.w, w.h);
          const unit = f.widthOfTextAtSize(text, 1) || 1;
          const size = Math.max(2, Math.min(wr.h * 1.1, wr.w / unit));
          const p = visualToUser(box, rot, wr.u, wr.v + wr.h * 0.2);
          // Modo de render 3 = invisible: buscable y seleccionable, como las capas OCR estándar.
          // El espaciado de caracteres estira la palabra hasta el ancho reconocido.
          const tc = text.length > 1 ? (wr.w - f.widthOfTextAtSize(text, size)) / (text.length - 1) : 0;
          page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible), setCharacterSpacing(tc));
          page.drawText(text, { x: p.x, y: p.y, size, font: f, rotate: degrees(p.angle) });
          page.pushOperators(popGraphicsState());
        }
        break;
      }
      case 'scantext': {
        // Edición sobre un escaneo: tapa las letras con el color del papel y escribe
        // el texto nuevo con el color de la tinta (ambos muestreados de la imagen).
        const paper = hexToRgb01(e.paper || '#FFFFFF');
        const ink = hexToRgb01(e.ink || '#111111');
        const c = visualToUser(box, rot, r.u, r.v);
        page.drawRectangle({ x: c.x, y: c.y, width: r.w, height: r.h, rotate: degrees(c.angle), color: rgb(paper.r, paper.g, paper.b) });
        const f = await unicodeFont('Helvetica');
        const size = Number(e.size) || r.h * 0.75;
        const lines = String(e.text || '').split('\n');
        const lh = size * 1.2;
        lines.forEach((line, k) => {
          const p = visualToUser(box, rot, r.u, vis.height * (1 - e.y) - size * 0.85 - k * lh);
          page.drawText(f.safe(line), { x: p.x, y: p.y, size, font: f.font, color: rgb(ink.r, ink.g, ink.b), rotate: degrees(p.angle) });
        });
        break;
      }
      case 'textedit':
        break; // se aplica antes, sobre el contenido original (ver textedit.js)
      default:
        throw new Error(`Tipo de edición desconocido: ${e.type}`);
    }
  }
  return pdfDoc;
}

export function listFormFields(pdfDoc) {
  let fields;
  try { fields = pdfDoc.getForm().getFields(); } catch { return []; }
  return fields.map((f) => {
    const base = { name: f.getName(), readOnly: f.isReadOnly() };
    if (f instanceof PDFTextField) return { ...base, kind: 'text', value: f.getText() || '', multiline: f.isMultiline() };
    if (f instanceof PDFCheckBox) return { ...base, kind: 'checkbox', value: f.isChecked() };
    if (f instanceof PDFDropdown) return { ...base, kind: 'choice', options: f.getOptions(), value: f.getSelected()[0] || '' };
    if (f instanceof PDFOptionList) return { ...base, kind: 'choice', options: f.getOptions(), value: f.getSelected()[0] || '' };
    if (f instanceof PDFRadioGroup) return { ...base, kind: 'choice', options: f.getOptions(), value: f.getSelected() || '' };
    return { ...base, kind: 'other' };
  });
}

export function fillForm(pdfDoc, values, { flatten = false } = {}) {
  const form = pdfDoc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f || f.isReadOnly()) continue;
    if (f instanceof PDFTextField) f.setText(String(value ?? ''));
    else if (f instanceof PDFCheckBox) (value ? f.check() : f.uncheck());
    else if ((f instanceof PDFDropdown || f instanceof PDFOptionList) && value) f.select(String(value));
    else if (f instanceof PDFRadioGroup && value) f.select(String(value));
  }
  form.updateFieldAppearances();
  if (flatten) form.flatten();
  return pdfDoc;
}
