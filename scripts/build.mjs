// Construye la extensión en dist/extension (y opcionalmente un .zip instalable).
//   node scripts/build.mjs          → dist/extension
//   node scripts/build.mjs --zip    → además dist/pdf-studio-<versión>.zip
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, deflateSync, crc32 } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'extension');
const nm = (p) => join(root, 'node_modules', p);
const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1) Estáticos
cpSync(join(root, 'extension'), out, { recursive: true });

// 2) Fuentes (OFL), pdf.js worker y OCR local
mkdirSync(join(out, 'fonts', 'pdf'), { recursive: true });
for (const w of [400, 500, 600]) cpSync(nm(`@fontsource/figtree/files/figtree-latin-${w}-normal.woff2`), join(out, 'fonts', `figtree-${w}.woff2`));
// Fuentes para escribir dentro del PDF, métricamente compatibles con Arial, Times, Courier y Calibri.
export const PDF_FAMILIES = ['arimo', 'tinos', 'cousine', 'carlito'];
for (const fam of PDF_FAMILIES) {
  for (const w of [400, 700]) for (const s of ['normal', 'italic']) {
    cpSync(nm(`@fontsource/${fam}/files/${fam}-latin-${w}-${s}.woff`), join(out, 'fonts', 'pdf', `${fam}-${w}-${s}.woff`));
  }
}
mkdirSync(join(out, 'vendor', 'tesseract'), { recursive: true });
cpSync(nm('pdfjs-dist/build/pdf.worker.min.mjs'), join(out, 'vendor', 'pdf.worker.min.mjs'));
cpSync(nm('tesseract.js/dist/worker.min.js'), join(out, 'vendor', 'tesseract', 'worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) cpSync(nm(`tesseract.js-core/${f}`), join(out, 'vendor', 'tesseract', f));
cpSync(nm('@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'), join(out, 'vendor', 'tesseract', 'spa.traineddata.gz'));

// Licencias de terceros que viajan dentro del paquete
mkdirSync(join(out, 'licenses'), { recursive: true });
for (const [name, file] of [
  ['pdf-lib', 'pdf-lib/LICENSE.md'], ['pdfjs-dist', 'pdfjs-dist/LICENSE'], ['tesseract.js', 'tesseract.js/LICENSE.md'],
  ['tesseract.js-core', 'tesseract.js-core/LICENSE'], ['pdf-lib-fontkit', '@pdf-lib/fontkit/LICENSE'],
  ['figtree', '@fontsource/figtree/LICENSE'], ['arimo', '@fontsource/arimo/LICENSE'], ['tinos', '@fontsource/tinos/LICENSE'],
  ['cousine', '@fontsource/cousine/LICENSE'], ['carlito', '@fontsource/carlito/LICENSE'],
]) if (existsSync(nm(file))) cpSync(nm(file), join(out, 'licenses', `${name}.txt`));
cpSync(join(root, 'LICENSE'), join(out, 'licenses', 'pdf-studio.txt'));
cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(out, 'licenses', 'THIRD_PARTY_NOTICES.md'));

// 3) Código
await build({
  entryPoints: {
    editor: join(root, 'src/ui/editor.js'),
    sidepanel: join(root, 'src/ui/sidepanel.js'),
    'export-worker': join(root, 'src/ui/export-worker.js'),
    background: join(root, 'src/background.js'),
  },
  outdir: join(out, 'js'),
  bundle: true,
  format: 'esm',
  splitting: false,
  target: 'chrome116',
  minify: true,
  sourcemap: false,
  legalComments: 'external',
  logLevel: 'warning',
});

// 4) Locales (default_locale exige la carpeta _locales)
mkdirSync(join(out, '_locales', 'es'), { recursive: true });
writeFileSync(join(out, '_locales', 'es', 'messages.json'), JSON.stringify({ name: { message: manifest.short_name } }, null, 2));

// 5) Iconos generados (sin dependencias): hoja con esquina verde sobre fondo acero.
for (const size of [16, 32, 48, 128]) {
  mkdirSync(join(out, 'icons'), { recursive: true });
  writeFileSync(join(out, 'icons', `icon-${size}.png`), drawIcon(size));
}

console.log(`Extensión lista en ${relative(root, out)}`);

if (process.argv.includes('--zip')) {
  const zipPath = join(root, 'dist', `pdf-studio-${manifest.version}.zip`);
  writeFileSync(zipPath, zipDir(out));
  console.log(`Paquete: ${relative(root, zipPath)} (${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

// ---------------------------------------------------------------- utilidades
function drawIcon(n) {
  const px = Buffer.alloc(n * n * 4);
  const set = (x, y, [r, g, b]) => { const i = (y * n + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  const steel = [0x16, 0x1A, 0x1D]; const white = [0xFF, 0xFF, 0xFF]; const green = [0x2F, 0x9E, 0x44]; const grey = [0x9A, 0xA4, 0xAB];
  const s = n / 16;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / s; const v = y / s;
    let c = steel;
    if (u >= 3.5 && u < 12.5 && v >= 2 && v < 14.5) c = white; // hoja
    if (u >= 5 && u < 11 && ((v >= 6 && v < 6.8) || (v >= 8 && v < 8.8) || (v >= 10 && v < 10.8))) c = grey; // líneas de texto
    if (u >= 9.5 && u < 14 && v >= 1 && v < 5.5) c = green; // folio
    set(x, y, c);
  }
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) { raw[y * (n * 4 + 1)] = 0; px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function zipDir(dir) {
  const locals = []; const centrals = []; let offset = 0;
  for (const file of walk(dir)) {
    const name = Buffer.from(relative(dir, file).split('\\').join('/'));
    const data = readFileSync(file);
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

if (!existsSync(join(out, 'js', 'editor.js'))) process.exit(1);
