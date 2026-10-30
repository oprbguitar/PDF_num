// Edición del texto existente dentro del PDF.
// 1) Interpreta el flujo de contenido de la página y localiza cada operador que dibuja
//    texto (Tj, TJ, ', "), con su posición, fuente, tamaño, color y texto Unicode.
// 2) Agrupa esos trazos en líneas y párrafos que la persona puede editar.
// 3) Al aplicar una edición, borra de verdad los glifos originales (el operador se
//    sustituye por un desplazamiento equivalente, así el resto del texto no se mueve)
//    y escribe el texto nuevo en la misma posición, tamaño, color e inclinación.
//    Si la fuente incrustada del documento tiene todos los caracteres se reutiliza;
//    si es un subconjunto incompleto se usa una fuente métricamente compatible.
// Mismo enfoque que PDFcraft (docs/editing-existing-text.md), reimplementado en JS.
import {
  PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFNumber,
  rgb, degrees, StandardFonts, decodePDFRawStream,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Font as StdFont, Encodings } from '@pdf-lib/standard-fonts';
import { tokenize, PdfName, PdfStr, mul, apply, IDENTITY, fmt } from './content.js';
import { pageBox, visualSize } from './geometry.js';

// ---------------------------------------------------------------- fuentes
const STD14 = {
  Helvetica: 'Helvetica', 'Helvetica-Bold': 'Helvetica-Bold', 'Helvetica-Oblique': 'Helvetica-Oblique', 'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
  'Times-Roman': 'Times-Roman', 'Times-Bold': 'Times-Bold', 'Times-Italic': 'Times-Italic', 'Times-BoldItalic': 'Times-BoldItalic',
  Courier: 'Courier', 'Courier-Bold': 'Courier-Bold', 'Courier-Oblique': 'Courier-Oblique', 'Courier-BoldOblique': 'Courier-BoldOblique',
  Symbol: 'Symbol', ZapfDingbats: 'ZapfDingbats', Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', TimesNewRoman: 'Times-Roman', 'TimesNewRoman,Bold': 'Times-Bold',
};

// código (0–255) → [unicode, nombre de glifo] según WinAnsi
const winAnsi = (() => {
  const byCode = new Map();
  const enc = Encodings.WinAnsi;
  for (const cp of enc.supportedCodePoints) {
    const { code, name } = enc.encodeUnicodeCodePoint(cp);
    if (!byCode.has(code)) byCode.set(code, [String.fromCodePoint(cp), name]);
  }
  const byName = new Map([...byCode.values()].map(([u, nm]) => [nm, u]));
  return { byCode, byName };
})();

const lookup = (ctx, v) => (v instanceof PDFRef ? ctx.lookup(v) : v);
const num = (v) => (v instanceof PDFNumber ? v.asNumber() : typeof v === 'number' ? v : 0);
const nameOf = (v) => (v instanceof PDFName ? v.decodeText() : null);

function streamBytes(ctx, s) {
  const st = lookup(ctx, s);
  if (st instanceof PDFRawStream) return decodePDFRawStream(st).decode();
  if (st instanceof PDFStream) return st.getContents();
  return null;
}

function parseToUnicode(bytes) {
  const map = new Map();
  const src = new TextDecoder('latin1').decode(bytes);
  const hex = (h) => parseInt(h, 16);
  const utf16 = (h) => {
    let s = '';
    for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(hex(h.substr(k, 4)));
    if (h.length % 4 === 2) s += String.fromCharCode(hex(h.slice(-2)));
    return s;
  };
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(m[1]), utf16(m[2]));
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hex(m[1]); const hi = hex(m[2]);
      if (hi - lo > 65535) continue;
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        items.forEach((h, k) => map.set(lo + k, utf16(h)));
      } else {
        const base = m[3].slice(1, -1);
        const lead = base.slice(0, -4); const last = hex(base.slice(-4) || '0');
        for (let c = lo; c <= hi; c++) map.set(c, utf16(lead + (last + c - lo).toString(16).padStart(4, '0')));
      }
    }
  }
  return map;
}

function loadFont(ctx, ref, cache) {
  const key = String(ref);
  if (cache.has(key)) return cache.get(key);
  const dict = lookup(ctx, ref);
  const f = {
    key, ok: true, reason: '', twoByte: false, widths: new Map(), dw: 1000, missing: 0,
    toUnicode: null, encodingMap: null, baseFont: '', program: null, programType: null,
    ascent: 0.8, descent: -0.22, scale: 0.001, std: null,
  };
  cache.set(key, f);
  if (!(dict instanceof PDFDict)) { f.ok = false; f.reason = 'Fuente no válida'; return f; }
  const subtype = nameOf(dict.get(PDFName.of('Subtype')));
  f.baseFont = (nameOf(dict.get(PDFName.of('BaseFont'))) || '').replace(/^[A-Z]{6}\+/, '');
  let desc = null;
  if (subtype === 'Type0') {
    f.twoByte = true;
    const enc = nameOf(dict.get(PDFName.of('Encoding')));
    if (enc && /-V$/.test(enc)) { f.ok = false; f.reason = 'Texto vertical'; }
    const desc0 = lookup(ctx, lookup(ctx, dict.get(PDFName.of('DescendantFonts')))?.get?.(0));
    if (desc0 instanceof PDFDict) {
      f.dw = num(desc0.get(PDFName.of('DW'))) || 1000;
      const W = lookup(ctx, desc0.get(PDFName.of('W')));
      if (W instanceof PDFArray) {
        const a = W.asArray().map((x) => lookup(ctx, x));
        for (let k = 0; k < a.length;) {
          const first = num(a[k]);
          if (a[k + 1] instanceof PDFArray) {
            a[k + 1].asArray().forEach((w, j) => f.widths.set(first + j, num(lookup(ctx, w))));
            k += 2;
          } else { const last = num(a[k + 1]); const w = num(a[k + 2]); for (let c = first; c <= last; c++) f.widths.set(c, w); k += 3; }
        }
      }
      desc = lookup(ctx, desc0.get(PDFName.of('FontDescriptor')));
    }
  } else {
    const first = num(dict.get(PDFName.of('FirstChar')));
    const W = lookup(ctx, dict.get(PDFName.of('Widths')));
    if (W instanceof PDFArray) W.asArray().forEach((w, j) => f.widths.set(first + j, num(lookup(ctx, w))));
    desc = lookup(ctx, dict.get(PDFName.of('FontDescriptor')));
    if (subtype === 'Type3') {
      const fm = lookup(ctx, dict.get(PDFName.of('FontMatrix')));
      f.scale = fm instanceof PDFArray ? num(fm.get(0)) : 0.001;
    }
    // Codificación simple: WinAnsi por defecto + /Differences
    const encMap = new Map(winAnsi.byCode);
    const enc = lookup(ctx, dict.get(PDFName.of('Encoding')));
    if (enc instanceof PDFDict) {
      const diffs = lookup(ctx, enc.get(PDFName.of('Differences')));
      if (diffs instanceof PDFArray) {
        let code = 0;
        for (const it of diffs.asArray()) {
          if (it instanceof PDFNumber) code = it.asNumber();
          else if (it instanceof PDFName) { const nm = it.decodeText(); encMap.set(code, [winAnsi.byName.get(nm) || glyphNameToUnicode(nm), nm]); code++; }
        }
      }
    }
    f.encodingMap = encMap;
    if (!W && STD14[f.baseFont]) {
      // Fuentes estándar sin /Widths: métricas AFM.
      const std = StdFont.load(STD14[f.baseFont]);
      f.std = std;
      for (const [code, [, nm]] of encMap) f.widths.set(code, std.getWidthOfGlyph(nm) ?? 0);
    }
  }
  if (desc instanceof PDFDict) {
    f.missing = num(desc.get(PDFName.of('MissingWidth')));
    const asc = num(desc.get(PDFName.of('Ascent'))); const dsc = num(desc.get(PDFName.of('Descent')));
    if (asc > 0) f.ascent = asc / 1000;
    if (dsc < 0) f.descent = dsc / 1000;
    const ff2 = desc.get(PDFName.of('FontFile2'));
    const ff3 = desc.get(PDFName.of('FontFile3'));
    if (ff2) { f.program = ff2; f.programType = 'TrueType'; }
    else if (ff3) {
      const s3 = lookup(ctx, ff3);
      const st = s3 && s3.dict ? nameOf(s3.dict.get(PDFName.of('Subtype'))) : null;
      if (st === 'OpenType') { f.program = ff3; f.programType = 'OpenType'; }
    }
    const flags = num(desc.get(PDFName.of('Flags')));
    f.serif = Boolean(flags & 2); f.fixed = Boolean(flags & 1); f.italicFlag = Boolean(flags & 64);
  }
  const tu = dict.get(PDFName.of('ToUnicode'));
  if (tu) { const b = streamBytes(ctx, tu); if (b) f.toUnicode = parseToUnicode(b); }
  if (f.twoByte && !f.toUnicode) { f.ok = false; f.reason = 'La fuente no indica qué letras contiene (sin ToUnicode)'; }
  return f;
}

function glyphNameToUnicode(nm) {
  if (/^uni([0-9A-F]{4})$/i.test(nm)) return String.fromCharCode(parseInt(nm.slice(3), 16));
  if (/^u([0-9A-F]{4,6})$/i.test(nm)) return String.fromCodePoint(parseInt(nm.slice(1), 16));
  if (nm.length === 1) return nm;
  return '';
}

function decodeString(f, bytes) {
  const glyphs = [];
  if (f.twoByte) {
    for (let k = 0; k + 1 < bytes.length; k += 2) {
      const code = (bytes[k] << 8) | bytes[k + 1];
      glyphs.push({ code, uni: f.toUnicode?.get(code) ?? '', single: false, w: f.widths.has(code) ? f.widths.get(code) : f.dw });
    }
  } else {
    for (const code of bytes) {
      const uni = f.toUnicode?.get(code) ?? f.encodingMap?.get(code)?.[0] ?? '';
      glyphs.push({ code, uni, single: true, w: f.widths.has(code) ? f.widths.get(code) : f.missing });
    }
  }
  return glyphs;
}

// ---------------------------------------------------------------- análisis
function contentRefs(page) {
  const raw = page.node.get(PDFName.of('Contents'));
  if (!raw) return [];
  const ctx = page.doc.context;
  const v = lookup(ctx, raw);
  if (v instanceof PDFArray) return v.asArray();
  return [raw];
}

// Recorre la página y devuelve los trazos de texto.
export function readRuns(page) {
  const ctx = page.doc.context;
  const res = page.node.Resources();
  const fontsDict = res ? lookup(ctx, res.get(PDFName.of('Font'))) : null;
  const cache = new Map();
  const streams = contentRefs(page).map((ref) => {
    const bytes = streamBytes(ctx, ref) || new Uint8Array();
    return { ref, bytes, ops: tokenize(bytes) };
  });
  const runs = [];
  let gs = { ctm: IDENTITY, fill: [0, 0, 0], fillCS: 1 };
  const gstack = [];
  let ts = { font: null, fs: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, rise: 0, mode: 0 };
  let Tm = IDENTITY; let Tlm = IDENTITY;
  let hasFormText = false;
  const csComps = { DeviceGray: 1, DeviceRGB: 3, DeviceCMYK: 4, G: 1, RGB: 3, CMYK: 4 };
  const setFill = (vals) => {
    if (vals.length === 1) gs.fill = [vals[0], vals[0], vals[0]];
    else if (vals.length === 3) gs.fill = vals;
    else if (vals.length === 4) { const [c, m, y, k] = vals; gs.fill = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; }
  };
  const fontFor = (resName) => {
    const ref = fontsDict instanceof PDFDict ? fontsDict.get(PDFName.of(resName)) : null;
    return ref ? loadFont(ctx, ref, cache) : null;
  };
  const show = (si, oi, op, items) => {
    const f = ts.font;
    const start = mul([ts.fs * ts.Th, 0, 0, ts.fs, 0, ts.rise], mul(Tm, gs.ctm));
    let tx = 0;
    let text = '';
    let unknown = false;
    for (const it of items) {
      if (typeof it === 'number') { tx += (-it / 1000) * ts.fs * ts.Th; continue; }
      if (!(it instanceof PdfStr)) continue;
      const gl = f ? decodeString(f, it.bytes) : [];
      for (const g of gl) {
        const w0 = f ? g.w * f.scale : 0;
        tx += (w0 * ts.fs + ts.Tc + (g.single && g.code === 32 ? ts.Tw : 0)) * ts.Th;
        if (!g.uni) unknown = true;
        text += g.uni || '�';
      }
    }
    const trm = mul([1, 0, 0, 1, 0, ts.rise], mul(Tm, gs.ctm));
    const scaleY = Math.hypot(start[2], start[3]);
    const [x0, y0] = apply(trm, 0, 0);
    const [x1, y1] = apply(trm, tx, 0);
    runs.push({
      si, oi, op, items, text, unknown, fontKey: f?.key, font: f, size: scaleY,
      x0, y0, x1, y1, advance: tx, fs: ts.fs, Th: ts.Th,
      angle: Math.atan2(trm[1], trm[0]) * 180 / Math.PI,
      color: [...gs.fill], invisible: ts.mode === 3 || ts.mode === 7,
    });
    Tm = mul([1, 0, 0, 1, tx, 0], Tm);
  };
  streams.forEach((s, si) => {
    s.ops.forEach((o, oi) => {
      const a = o.args;
      switch (o.op) {
        // El estado de texto (Tf, Tc, Tw, Tz, TL, Ts, Tr) forma parte del estado gráfico.
        case 'q': gstack.push({ gs: { ...gs, fill: [...gs.fill] }, ts: { ...ts } }); break;
        case 'Q': if (gstack.length) ({ gs, ts } = gstack.pop()); break;
        case 'cm': if (a.length === 6) gs.ctm = mul(a, gs.ctm); break;
        case 'BT': Tm = IDENTITY; Tlm = IDENTITY; break;
        case 'Tf': ts.font = a[0] instanceof PdfName ? fontFor(a[0].name) : null; ts.fs = Number(a[1]) || 0; break;
        case 'Tc': ts.Tc = Number(a[0]) || 0; break;
        case 'Tw': ts.Tw = Number(a[0]) || 0; break;
        case 'Tz': ts.Th = (Number(a[0]) || 100) / 100; break;
        case 'TL': ts.TL = Number(a[0]) || 0; break;
        case 'Ts': ts.rise = Number(a[0]) || 0; break;
        case 'Tr': ts.mode = Number(a[0]) || 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, a[0], a[1]], Tlm); Tm = Tlm; break;
        case 'TD': ts.TL = -a[1]; Tlm = mul([1, 0, 0, 1, a[0], a[1]], Tlm); Tm = Tlm; break;
        case 'Tm': if (a.length === 6) { Tlm = [...a]; Tm = Tlm; } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -ts.TL], Tlm); Tm = Tlm; break;
        case 'Tj': show(si, oi, 'Tj', [a[0]]); break;
        case 'TJ': show(si, oi, 'TJ', Array.isArray(a[0]) ? a[0] : []); break;
        case "'": Tlm = mul([1, 0, 0, 1, 0, -ts.TL], Tlm); Tm = Tlm; show(si, oi, "'", [a[0]]); break;
        case '"': ts.Tw = Number(a[0]) || 0; ts.Tc = Number(a[1]) || 0; Tlm = mul([1, 0, 0, 1, 0, -ts.TL], Tlm); Tm = Tlm; show(si, oi, '"', [a[2]]); runs[runs.length - 1].quote = [ts.Tw, ts.Tc]; break;
        case 'g': setFill(a.map(Number)); gs.fillCS = 1; break;
        case 'rg': setFill(a.map(Number)); gs.fillCS = 3; break;
        case 'k': setFill(a.map(Number)); gs.fillCS = 4; break;
        case 'cs': gs.fillCS = csComps[a[0]?.name] || 0; break;
        case 'sc': case 'scn': { const nums = a.filter((x) => typeof x === 'number'); if (nums.length && (!gs.fillCS || nums.length === gs.fillCS)) setFill(nums); break; }
        case 'Do': hasFormText = true; break;
        default: break;
      }
    });
  });
  return { runs, streams, hasForms: hasFormText };
}

// Agrupa trazos en líneas y luego en párrafos.
export function groupBlocks(runs) {
  const lines = [];
  for (const r of runs) {
    if (!r.text.trim() && !r.advance) continue;
    const L = lines[lines.length - 1];
    if (L && sameLine(L, r)) { addToLine(L, r); continue; }
    lines.push(newLine(r));
  }
  const usable = lines.filter((l) => l.text.trim());
  // Párrafos: líneas consecutivas alineadas con interlineado regular.
  const blocks = [];
  for (const l of usable) {
    const B = blocks[blocks.length - 1];
    if (B && !l.invisible && !B.invisible && fitsBlock(B, l)) { B.lines.push(l); continue; }
    blocks.push({ lines: [l], invisible: l.invisible });
  }
  return blocks.map((b, i) => finishBlock(b, i));
}

const rad = (d) => d * Math.PI / 180;
function along(angle, x, y) { const c = Math.cos(rad(angle)); const s = Math.sin(rad(angle)); return [x * c + y * s, -x * s + y * c]; }

function newLine(r) {
  return { runs: [r], text: r.text, angle: r.angle, size: r.size, invisible: r.invisible, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
}
function sameLine(L, r) {
  if (Math.abs(L.angle - r.angle) > 1 || L.invisible !== r.invisible) return false;
  const [, perpL] = along(L.angle, L.x0, L.y0);
  const [startR, perpR] = along(L.angle, r.x0, r.y0);
  const [endL] = along(L.angle, L.x1, L.y1);
  const size = Math.max(L.size, r.size) || 1;
  if (Math.abs(perpR - perpL) > size * 0.35) return false;
  const gap = startR - endL;
  return gap > -size * 0.6 && gap < size * (L.invisible ? 0.6 : 2.2);
}
function addToLine(L, r) {
  const [endL] = along(L.angle, L.x1, L.y1);
  const [startR] = along(L.angle, r.x0, r.y0);
  const size = Math.max(L.size, r.size) || 1;
  const needsSpace = startR - endL > size * 0.2 && !/\s$/.test(L.text) && !/^\s/.test(r.text);
  L.text += (needsSpace ? ' ' : '') + r.text;
  L.runs.push(r);
  L.x1 = r.x1; L.y1 = r.y1;
  L.size = Math.max(L.size, r.size);
}
function fitsBlock(B, l) {
  const prev = B.lines[B.lines.length - 1];
  if (Math.abs(prev.angle - l.angle) > 1) return false;
  if (Math.abs(prev.size - l.size) > prev.size * 0.15) return false;
  const [s0, p0] = along(prev.angle, prev.x0, prev.y0);
  const [s1, p1] = along(prev.angle, l.x0, l.y0);
  const lead = p0 - p1;
  if (Math.abs(s1 - s0) > prev.size * 1.5) return false;
  if (lead < prev.size * 0.9 || lead > prev.size * 2.2) return false;
  if (B.lead && Math.abs(lead - B.lead) > B.lead * 0.3) return false;
  B.lead = B.lead || lead;
  return true;
}
function finishBlock(b, index) {
  const first = b.lines[0];
  const runs = b.lines.flatMap((l) => l.runs);
  const fonts = runs.map((r) => r.font).filter(Boolean);
  const main = fonts[0] || null;
  const reasons = [...new Set(fonts.filter((f) => !f.ok).map((f) => f.reason))];
  if (runs.some((r) => r.unknown)) reasons.push('Contiene caracteres que no se pueden leer');
  const leads = b.lines.slice(1).map((l, k) => along(first.angle, b.lines[k].x0, b.lines[k].y0)[1] - along(first.angle, l.x0, l.y0)[1]);
  let width = 0;
  for (const l of b.lines) width = Math.max(width, Math.hypot(l.x1 - l.x0, l.y1 - l.y0));
  return {
    index, runs, lines: b.lines, text: b.lines.map((l) => l.text).join('\n'), invisible: b.invisible,
    angle: first.angle, size: first.size, origin: [first.x0, first.y0], width,
    lead: leads.length ? leads.reduce((a, c) => a + c, 0) / leads.length : first.size * 1.2,
    color: runs[0].color, font: main, editable: reasons.length === 0, reason: reasons.join('; '),
  };
}

export function readBlocks(page) {
  const { runs, hasForms } = readRuns(page);
  return { blocks: groupBlocks(runs), hasForms };
}

// Caja del bloque en coordenadas visuales normalizadas (0–1, origen arriba-izquierda).
export function blockBox(page, block) {
  const box = pageBox(page);
  const rot = page.getRotation().angle;
  const vis = visualSize(box, rot);
  const pts = [];
  const asc = block.font ? block.font.ascent : 0.8;
  const dsc = block.font ? block.font.descent : -0.22;
  const ox = Math.cos(rad(block.angle + 90)); const oy = Math.sin(rad(block.angle + 90));
  for (const l of block.lines) {
    for (const [x, y] of [[l.x0, l.y0], [l.x1, l.y1]]) {
      pts.push([x + ox * asc * l.size, y + oy * asc * l.size], [x + ox * dsc * l.size, y + oy * dsc * l.size]);
    }
  }
  const vpts = pts.map(([x, y]) => userToVisual(box, rot, x, y));
  const us = vpts.map((p) => p[0]); const vs = vpts.map((p) => p[1]);
  const u0 = Math.min(...us); const u1 = Math.max(...us); const v0 = Math.min(...vs); const v1 = Math.max(...vs);
  return { x: u0 / vis.width, y: 1 - v1 / vis.height, w: (u1 - u0) / vis.width, h: (v1 - v0) / vis.height };
}

export function userToVisual(box, rotation, x, y) {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const dx = x - box.x; const dy = y - box.y;
  switch (r) {
    case 90: return [dy, box.width - dx];
    case 180: return [box.width - dx, box.height - dy];
    case 270: return [box.height - dy, dx];
    default: return [dx, dy];
  }
}

// ---------------------------------------------------------------- aplicar
const FAMILY_RULES = [
  [/calibri|carlito/i, 'carlito'],
  [/times|tinos|serif|georgia|cambria|garamond|book|minion|roman/i, 'tinos'],
  [/courier|cousine|mono|consol|code/i, 'cousine'],
];
export function fallbackFace(font) {
  const name = font?.baseFont || '';
  let family = 'arimo';
  for (const [re, fam] of FAMILY_RULES) if (re.test(name)) { family = fam; break; }
  if (family === 'arimo' && font && !/arial|helvet|sans|arimo|verdana|tahoma|segoe/i.test(name)) {
    if (font.fixed) family = 'cousine'; else if (font.serif) family = 'tinos';
  }
  const bold = /bold|black|heavy|semibold|demi/i.test(name);
  const italic = /italic|oblique/i.test(name) || Boolean(font?.italicFlag);
  return { family, bold, italic };
}

// Sustituto que conserva el avance horizontal del operador eliminado.
function blankOp(run) {
  const k = run.fs * run.Th;
  const n = k ? -(run.advance / k) * 1000 : 0;
  const tj = `[${fmt(n)}] TJ`;
  if (run.op === "'") return `T* ${tj}`;
  if (run.op === '"') return `${fmt(run.quote[0])} Tw ${fmt(run.quote[1])} Tc T* ${tj}`;
  return tj;
}

function wrap(font, text, size, width) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!width) { out.push(para); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (line && font.widthOfTextAtSize(cand.trimEnd(), size) > width) { out.push(line.trimEnd()); line = w.trimStart(); } else line = cand;
    }
    out.push(line);
  }
  return out;
}

async function pickFont(doc, block, text, fontProvider, cache) {
  const f = block.font;
  // 1) Fuente original incrustada, si contiene todos los caracteres nuevos.
  if (f && f.program) {
    try {
      const bytes = streamBytes(doc.context, f.program);
      const fk = fontkit.create(bytes);
      const needed = [...new Set([...text.replace(/\s/g, '')])];
      if (needed.every((ch) => fk.hasGlyphForCodePoint(ch.codePointAt(0)))) {
        const key = `orig:${f.key}`;
        if (!cache.has(key)) cache.set(key, await doc.embedFont(bytes, { subset: true }));
        return { font: cache.get(key), source: 'original' };
      }
    } catch { /* programa no legible: se usa la alternativa */ }
  }
  // 2) Fuente métricamente compatible (Arimo≈Arial, Tinos≈Times, Cousine≈Courier, Carlito≈Calibri).
  const face = fallbackFace(f);
  if (fontProvider) {
    const key = `fb:${face.family}:${face.bold}:${face.italic}`;
    if (!cache.has(key)) {
      const bytes = await fontProvider(face);
      cache.set(key, bytes ? await doc.embedFont(bytes, { subset: true }) : null);
    }
    if (cache.get(key)) return { font: cache.get(key), source: face.family };
  }
  // 3) Último recurso: fuentes estándar (solo Latin-1).
  const std = face.family === 'tinos' ? (face.bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman)
    : face.family === 'cousine' ? (face.bold ? StandardFonts.CourierBold : StandardFonts.Courier)
      : (face.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  if (!cache.has(std)) cache.set(std, await doc.embedFont(std));
  return { font: cache.get(std), source: 'estándar' };
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// edits: [{ blockIndex, originalText, text, paper?: '#hex', ink?: '#hex' }]
export async function applyTextEdits(doc, pageIndex, edits, { fontProvider } = {}) {
  if (!edits.length) return { applied: 0 };
  doc.registerFontkit(fontkit);
  const page = doc.getPage(pageIndex);
  const { runs, streams } = readRuns(page);
  const blocks = groupBlocks(runs);
  const replace = new Map(); // si → Map(oi → texto)
  const draws = [];
  for (const e of edits) {
    const b = blocks[e.blockIndex];
    if (!b || norm(b.text) !== norm(e.originalText)) {
      throw new Error(`La página ${pageIndex + 1} cambió desde que se editó el texto «${String(e.originalText).slice(0, 40)}». Deshaz esa edición y vuelve a hacerla.`);
    }
    if (!b.editable) throw new Error(`No se puede editar «${b.text.slice(0, 40)}»: ${b.reason}.`);
    for (const r of b.runs) {
      if (!replace.has(r.si)) replace.set(r.si, new Map());
      replace.get(r.si).set(r.oi, blankOp(r));
    }
    draws.push({ b, e });
  }
  // Reescribe solo los flujos afectados, como objetos nuevos (las páginas duplicadas
  // pueden compartir el mismo flujo y no deben cambiar).
  const ctx = doc.context;
  const enc = new TextEncoder();
  const refs = contentRefs(page);
  replace.forEach((map, si) => {
    const s = streams[si];
    const parts = [];
    let pos = 0;
    s.ops.forEach((o, oi) => {
      if (!map.has(oi)) return;
      parts.push(s.bytes.subarray(pos, o.start), enc.encode(map.get(oi)));
      pos = o.end;
    });
    parts.push(s.bytes.subarray(pos));
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let k = 0;
    for (const p of parts) { out.set(p, k); k += p.length; }
    refs[si] = ctx.register(ctx.flateStream(out));
  });
  page.node.set(PDFName.of('Contents'), ctx.obj(refs));
  // Escribe el texto nuevo.
  const cache = new Map();
  for (const { b, e } of draws) {
    const text = String(e.text ?? '');
    if (!text.trim()) continue;
    const { font } = await pickFont(doc, b, text, fontProvider, cache);
    const color = e.ink ? hex(e.ink) : b.color;
    const size = b.size;
    const multi = b.lines.length > 1;
    const lines = wrap(font, text, size, multi ? b.width * 1.02 : 0);
    const [ox, oy] = b.origin;
    const dx = Math.sin(rad(b.angle)); const dy = -Math.cos(rad(b.angle));
    if (b.invisible) {
      // Texto reconocido sobre un escaneo: tapar las palabras con el color del papel.
      // Rectángulo en el sistema local de la línea (u a lo largo, v hacia arriba).
      const paper = hex(e.paper || '#FFFFFF');
      const longest = Math.max(b.width, ...lines.map((l) => font.widthOfTextAtSize(l, size)));
      const pad = size * 0.15;
      const nLines = Math.max(lines.length, b.lines.length);
      const u0 = -pad; const v0 = -(nLines - 1) * b.lead - size * 0.3 - pad;
      const height = (nLines - 1) * b.lead + size * 1.2 + 2 * pad;
      const c = Math.cos(rad(b.angle)); const s = Math.sin(rad(b.angle));
      page.drawRectangle({
        x: ox + u0 * c - v0 * s, y: oy + u0 * s + v0 * c, width: longest + 2 * pad, height,
        rotate: degrees(b.angle), color: rgb(...paper),
      });
    }
    lines.forEach((line, i) => {
      if (!line) return;
      page.drawText(line, { x: ox + dx * b.lead * i, y: oy + dy * b.lead * i, size, font, color: rgb(...color), rotate: degrees(b.angle) });
    });
  }
  return { applied: draws.length };
}

function hex(h) {
  const n = parseInt(String(h).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

