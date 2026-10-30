// Conversión de números a romanos, alfabéticos (estilo de etiquetas PDF) y palabras en español.
// La semántica romano/alfabético sigue crates/organize/src/labels.rs de PDFcraft (MIT OR Apache-2.0):
// alfabético repite la letra: A…Z, AA…ZZ, AAA…

const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Los romanos requieren un entero ≥ 1');
  if (n > 39999) throw new RangeError('Número romano demasiado grande (máx. 39 999)');
  let out = '';
  let rest = n;
  for (const [v, s] of ROMAN) {
    while (rest >= v) { out += s; rest -= v; }
  }
  return out;
}

export function toAlpha(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Los alfabéticos requieren un entero ≥ 1');
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  const times = Math.floor((n - 1) / 26) + 1;
  if (times > 200) throw new RangeError('Etiqueta alfabética demasiado larga');
  return letter.repeat(times);
}

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function below1000(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 30) parts.push(UNITS[r]);
    else {
      const t = Math.floor(r / 10);
      const u = r % 10;
      parts.push(u ? `${TENS[t]} y ${UNITS[u]}` : TENS[t]);
    }
  }
  return parts.join(' ');
}

// Forma cardinal usada en foliación ("uno", "veintiuno", "ciento uno").
export function toSpanishWords(n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('Se requiere un entero ≥ 0');
  if (n > 999999999) throw new RangeError('Número demasiado grande para escribir en letras');
  if (n === 0) return 'cero';
  const millions = Math.floor(n / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (millions) parts.push(millions === 1 ? 'un millón' : `${apocope(below1000(millions))} millones`);
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${apocope(below1000(thousands))} mil`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

// "veintiuno mil" → "veintiún mil", "treinta y uno mil" → "treinta y un mil"
function apocope(s) {
  return s.replace(/veintiuno$/, 'veintiún').replace(/(^|\s)uno$/, '$1un');
}

export function pad(numStr, width) {
  return width > 0 ? numStr.padStart(width, '0') : numStr;
}
