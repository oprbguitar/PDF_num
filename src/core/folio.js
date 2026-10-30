// Foliador: calcula las etiquetas de cada página y las estampa como contenido visible del PDF.
import { StandardFonts, rgb, degrees } from 'pdf-lib';
import { toRoman, toAlpha, toSpanishWords, pad } from './numerals.js';
import { MM_TO_PT, pageBox, visualSize, visualToUser, hexToRgb01 } from './geometry.js';

export const FORMATS = {
  arabic: 'Arábigos (1, 2, 3)',
  'roman-upper': 'Romanos (I, II, III)',
  'roman-lower': 'Romanos (i, ii, iii)',
  'alpha-upper': 'Alfabéticos (A, B, C)',
  'alpha-lower': 'Alfabéticos (a, b, c)',
  'num-words': 'Número y letras (1 - uno)',
  words: 'Solo letras (uno, dos)',
};

export const FONTS = {
  Helvetica: StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
};

export const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

// Plantillas rápidas: solo rellenan campos del formulario, el usuario puede ajustarlos.
export const PRESETS = {
  simple: { format: 'arabic', prefix: '', suffix: '', padding: 0 },
  'A-001': { format: 'arabic', prefix: 'A-', suffix: '', padding: 3 },
  '001-A': { format: 'arabic', prefix: '', suffix: '-A', padding: 3 },
  'FOLIO-001': { format: 'arabic', prefix: 'FOLIO-', suffix: '', padding: 3 },
  bates: { format: 'arabic', prefix: 'EXP', suffix: '', padding: 6, continuous: true },
  'num-words': { format: 'num-words', prefix: '', suffix: '', padding: 0 },
};

export const DEFAULT_FOLIO = Object.freeze({
  format: 'arabic',
  start: 1,
  padding: 0,
  prefix: '',
  suffix: '',
  position: 'top-right',
  marginXmm: 12,
  marginYmm: 10,
  font: 'Helvetica',
  size: 11,
  color: '#000000',
  exclude: '',
  excludedConsume: false,
  resets: '',
  continuous: true,
  background: false,
});

// "1, 3-5" → Set de páginas (base 1). Lanza error con mensaje en español si no es válido.
export function parsePageList(text, pageCount) {
  const out = new Set();
  const src = String(text || '').trim();
  if (!src) return out;
  for (const raw of src.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(raw);
    if (!m) throw new Error(`Rango no válido: "${raw}". Usa el formato 1, 3-5.`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a) throw new Error(`Rango no válido: "${raw}".`);
    if (b > pageCount) throw new Error(`La página ${b} no existe (el documento tiene ${pageCount}).`);
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

// "10, 25:100" → Map(página → número inicial). Sin ":n" reinicia en `start`.
export function parseResets(text, pageCount, start) {
  const out = new Map();
  const src = String(text || '').trim();
  if (!src) return out;
  for (const raw of src.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?::(\d+))?$/.exec(raw);
    if (!m) throw new Error(`Reinicio no válido: "${raw}". Usa 10 o 10:1.`);
    const page = Number(m[1]);
    if (page < 1 || page > pageCount) throw new Error(`La página ${page} no existe para reiniciar.`);
    out.set(page, m[2] ? Number(m[2]) : start);
  }
  return out;
}

export function formatNumber(n, cfg) {
  switch (cfg.format) {
    case 'arabic': return pad(String(n), cfg.padding);
    case 'roman-upper': return toRoman(n);
    case 'roman-lower': return toRoman(n).toLowerCase();
    case 'alpha-upper': return toAlpha(n);
    case 'alpha-lower': return toAlpha(n).toLowerCase();
    case 'num-words': return `${pad(String(n), cfg.padding)} - ${toSpanishWords(n)}`;
    case 'words': return toSpanishWords(n);
    default: throw new Error(`Formato desconocido: ${cfg.format}`);
  }
}

// Devuelve un arreglo con la etiqueta de cada página (o null si la página se excluye).
// docStarts: índices (base 0) donde empieza cada documento en el resultado consolidado.
export function computeLabels(pageCount, config, { docStarts = [0] } = {}) {
  const cfg = { ...DEFAULT_FOLIO, ...config };
  const start = Number(cfg.start);
  if (!Number.isInteger(start) || start < 0) throw new Error('El número inicial debe ser un entero ≥ 0.');
  if (start === 0 && cfg.format !== 'arabic') throw new Error('Ese formato empieza en 1 como mínimo.');
  const excluded = parsePageList(cfg.exclude, pageCount);
  const resets = parseResets(cfg.resets, pageCount, start);
  if (!cfg.continuous) for (const s of docStarts) if (s > 0 && !resets.has(s + 1)) resets.set(s + 1, start);
  const labels = [];
  let n = start;
  for (let p = 1; p <= pageCount; p++) {
    if (resets.has(p)) n = resets.get(p);
    if (excluded.has(p)) {
      labels.push(null);
      if (cfg.excludedConsume) n++;
      continue;
    }
    labels.push(`${cfg.prefix}${formatNumber(n, cfg)}${cfg.suffix}`);
    n++;
  }
  return labels;
}

// Posición visual (baseline izquierda) del texto dentro de la página vista.
export function placeLabel(vis, textWidth, ascent, cfg) {
  const mx = cfg.marginXmm * MM_TO_PT;
  const my = cfg.marginYmm * MM_TO_PT;
  const [vpos, hpos] = cfg.position.split('-');
  const u = hpos === 'left' ? mx : hpos === 'center' ? (vis.width - textWidth) / 2 : vis.width - mx - textWidth;
  const v = vpos === 'top' ? vis.height - my - ascent : vpos === 'middle' ? (vis.height - ascent) / 2 : my;
  return { u, v };
}

// Estampa las etiquetas en un PDFDocument de pdf-lib (lo modifica en sitio).
export async function applyFolio(pdfDoc, labels, config) {
  const cfg = { ...DEFAULT_FOLIO, ...config };
  if (!POSITIONS.includes(cfg.position)) throw new Error(`Posición no válida: ${cfg.position}`);
  const font = await pdfDoc.embedFont(FONTS[cfg.font] || StandardFonts.Helvetica);
  const { r, g, b } = hexToRgb01(cfg.color);
  const size = Number(cfg.size);
  if (!(size >= 4 && size <= 72)) throw new Error('El tamaño de fuente debe estar entre 4 y 72 pt.');
  const pages = pdfDoc.getPages();
  if (labels.length !== pages.length) throw new Error('El número de etiquetas no coincide con las páginas.');
  const ascent = font.heightAtSize(size, { descender: false });
  const descent = font.heightAtSize(size) - ascent;
  pages.forEach((page, i) => {
    const text = labels[i];
    if (text == null) return;
    let width;
    try {
      width = font.widthOfTextAtSize(text, size);
    } catch {
      throw new Error(`La fuente ${cfg.font} no puede escribir "${text}". Usa caracteres latinos básicos.`);
    }
    const box = pageBox(page);
    const rot = page.getRotation().angle;
    const vis = visualSize(box, rot);
    const { u, v } = placeLabel(vis, width, ascent, cfg);
    if (cfg.background) {
      const padPt = size * 0.25;
      const c = visualToUser(box, rot, u - padPt, v - descent - padPt);
      page.drawRectangle({
        x: c.x, y: c.y, width: width + 2 * padPt, height: ascent + descent + 2 * padPt,
        rotate: degrees(c.angle), color: rgb(1, 1, 1),
      });
    }
    const p = visualToUser(box, rot, u, v);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(r, g, b), rotate: degrees(p.angle) });
  });
  return pdfDoc;
}
