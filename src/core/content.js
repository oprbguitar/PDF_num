// Lector de flujos de contenido PDF: convierte los bytes en una lista de operadores con
// sus operandos y su posición exacta, para poder reescribir operadores concretos sin
// tocar el resto del flujo.

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isReg = (c) => !WS.has(c) && !DELIM.has(c);

export class PdfName { constructor(name) { this.name = name; } }
export class PdfStr { constructor(bytes, hex = false) { this.bytes = bytes; this.hex = hex; } }

export function tokenize(buf) {
  const ops = [];
  let i = 0;
  const n = buf.length;
  let stack = [];
  let opStart = -1;
  const containers = [];

  const push = (v, start) => {
    if (containers.length) containers[containers.length - 1].items.push(v);
    else { if (opStart < 0) opStart = start; stack.push(v); }
  };

  while (i < n) {
    const c = buf[i];
    if (WS.has(c)) { i++; continue; }
    const start = i;
    if (c === 0x25) { while (i < n && buf[i] !== 10 && buf[i] !== 13) i++; continue; } // comentario
    if (c === 0x2f) { // nombre
      i++;
      let s = '';
      while (i < n && isReg(buf[i])) {
        if (buf[i] === 0x23 && i + 2 < n) { s += String.fromCharCode(parseInt(String.fromCharCode(buf[i + 1], buf[i + 2]), 16)); i += 3; } else s += String.fromCharCode(buf[i++]);
      }
      push(new PdfName(s), start);
      continue;
    }
    if (c === 0x28) { // cadena literal
      i++;
      let depth = 1;
      const out = [];
      while (i < n && depth > 0) {
        const b = buf[i];
        if (b === 0x5c) {
          const e = buf[i + 1];
          const map = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
          if (e in map) { out.push(map[e]); i += 2; } else if (e >= 0x30 && e <= 0x37) {
            let k = 0; let v = 0;
            while (k < 3 && buf[i + 1 + k] >= 0x30 && buf[i + 1 + k] <= 0x37) { v = v * 8 + (buf[i + 1 + k] - 0x30); k++; }
            out.push(v & 255); i += 1 + k;
          } else if (e === 13) { i += buf[i + 2] === 10 ? 3 : 2; } else if (e === 10) { i += 2; } else { i += 1; }
          continue;
        }
        if (b === 0x28) depth++;
        if (b === 0x29) { depth--; if (depth === 0) { i++; break; } }
        out.push(b); i++;
      }
      push(new PdfStr(Uint8Array.from(out)), start);
      continue;
    }
    if (c === 0x3c && buf[i + 1] === 0x3c) { containers.push({ type: 'dict', items: [], start }); i += 2; continue; }
    if (c === 0x3e && buf[i + 1] === 0x3e) {
      i += 2;
      const d = containers.pop();
      const obj = {};
      for (let k = 0; k + 1 < d.items.length; k += 2) if (d.items[k] instanceof PdfName) obj[d.items[k].name] = d.items[k + 1];
      push(obj, d.start);
      continue;
    }
    if (c === 0x3c) { // cadena hexadecimal
      i++;
      let hex = '';
      while (i < n && buf[i] !== 0x3e) { if (!WS.has(buf[i])) hex += String.fromCharCode(buf[i]); i++; }
      i++;
      if (hex.length % 2) hex += '0';
      const bytes = new Uint8Array(hex.length / 2);
      for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16);
      push(new PdfStr(bytes, true), start);
      continue;
    }
    if (c === 0x5b) { containers.push({ type: 'array', items: [], start }); i++; continue; }
    if (c === 0x5d) { i++; const a = containers.pop(); push(a ? a.items : [], a ? a.start : start); continue; }
    if (c === 0x7b || c === 0x7d) { i++; continue; }
    // número u operador
    let w = '';
    while (i < n && isReg(buf[i])) w += String.fromCharCode(buf[i++]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { push(Number(w), start); continue; }
    if (w === 'true' || w === 'false') { push(w === 'true', start); continue; }
    if (w === 'null') { push(null, start); continue; }
    if (!w) { i++; continue; }
    if (containers.length) { containers[containers.length - 1].items.push(w); continue; }
    ops.push({ op: w, args: stack, start: opStart < 0 ? start : opStart, end: i });
    stack = [];
    opStart = -1;
    if (w === 'ID') { // datos binarios de imagen en línea hasta EI
      i++;
      while (i < n) {
        if (buf[i] === 0x45 && buf[i + 1] === 0x49 && WS.has(buf[i - 1]) && (i + 2 >= n || WS.has(buf[i + 2]))) { i += 2; break; }
        i++;
      }
      ops.push({ op: 'EI', args: [], start: i - 2, end: i });
    }
  }
  return ops;
}

// Matrices PDF [a b c d e f] (convención de vector fila).
export const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function fmt(v) {
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10000) / 10000).toString();
}
