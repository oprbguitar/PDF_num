import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRoman, toAlpha, toSpanishWords } from '../src/core/numerals.js';
import { computeLabels, parsePageList, applyFolio } from '../src/core/folio.js';
import { buildDocument, splitRanges } from '../src/core/organize.js';
import { exportWorkspace, docStarts } from '../src/core/pipeline.js';
import { analyzePdf, detectExistingFolio } from '../src/core/inspect.js';
import { listFormFields } from '../src/core/edit.js';
import { makePdf, makeForm, makeScanned, readTexts, fixture, PDFDocument } from './helpers.mjs';

const PNG_1PX = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

// ---------- Numerales ----------
test('romanos', () => {
  assert.equal(toRoman(1), 'I');
  assert.equal(toRoman(4), 'IV');
  assert.equal(toRoman(1994), 'MCMXCIV');
  assert.throws(() => toRoman(0));
});

test('alfabéticos al estilo de etiquetas PDF', () => {
  assert.equal(toAlpha(1), 'A');
  assert.equal(toAlpha(26), 'Z');
  assert.equal(toAlpha(27), 'AA');
  assert.equal(toAlpha(53), 'AAA');
});

test('números en letras (español)', () => {
  const cases = { 1: 'uno', 16: 'dieciséis', 21: 'veintiuno', 22: 'veintidós', 31: 'treinta y uno', 100: 'cien',
    101: 'ciento uno', 115: 'ciento quince', 500: 'quinientos', 1000: 'mil', 1001: 'mil uno',
    2021: 'dos mil veintiuno', 21000: 'veintiún mil', 31000: 'treinta y un mil', 1000000: 'un millón',
    2500000: 'dos millones quinientos mil' };
  for (const [n, w] of Object.entries(cases)) assert.equal(toSpanishWords(Number(n)), w, `n=${n}`);
});

// ---------- Etiquetas de foliación ----------
test('formatos y rellenos', () => {
  assert.deepEqual(computeLabels(3, { format: 'arabic' }), ['1', '2', '3']);
  assert.deepEqual(computeLabels(3, { format: 'roman-lower' }), ['i', 'ii', 'iii']);
  assert.deepEqual(computeLabels(2, { format: 'alpha-upper' }), ['A', 'B']);
  assert.deepEqual(computeLabels(2, { format: 'arabic', prefix: 'A-', padding: 3 }), ['A-001', 'A-002']);
  assert.deepEqual(computeLabels(2, { format: 'arabic', suffix: '-A', padding: 3 }), ['001-A', '002-A']);
  assert.deepEqual(computeLabels(2, { format: 'arabic', prefix: 'FOLIO-', padding: 3 }), ['FOLIO-001', 'FOLIO-002']);
  assert.deepEqual(computeLabels(2, { format: 'arabic', prefix: 'EXP', padding: 6, start: 120 }), ['EXP000120', 'EXP000121']);
  assert.deepEqual(computeLabels(3, { format: 'num-words' }), ['1 - uno', '2 - dos', '3 - tres']);
});

test('exclusión, reinicios y numeración por documento', () => {
  assert.deepEqual(computeLabels(4, { exclude: '1' }), [null, '1', '2', '3']);
  assert.deepEqual(computeLabels(4, { exclude: '1', excludedConsume: true }), [null, '2', '3', '4']);
  assert.deepEqual(computeLabels(5, { resets: '3, 5:10' }), ['1', '2', '1', '2', '10']);
  assert.deepEqual(computeLabels(5, { continuous: false }, { docStarts: [0, 2] }), ['1', '2', '1', '2', '3']);
  assert.throws(() => parsePageList('1-x', 3), /Rango no válido/);
  assert.throws(() => parsePageList('9', 3), /no existe/);
});

test('docStarts ignora páginas en blanco intercaladas', () => {
  assert.deepEqual(docStarts([{ src: 'a' }, { blank: {} }, { src: 'a' }, { src: 'b' }]), [0, 3]);
});

// ---------- Foliación visible sobre PDFs reales y sintéticos ----------
const positions = { 'top-right': (p, it) => it.x > p.width * 0.75 && it.y > p.height * 0.9,
  'bottom-center': (p, it) => Math.abs(it.x - p.width / 2) < 40 && it.y < p.height * 0.1,
  'top-left': (p, it) => it.x < p.width * 0.15 && it.y > p.height * 0.9 };

for (const rotate of [0, 90, 180, 270]) {
  for (const [pos, check] of Object.entries(positions)) {
    test(`folio visible en ${pos} con /Rotate ${rotate}`, async () => {
      const bytes = await makePdf('R', 2, { rotate, size: [612, 792] });
      const doc = await PDFDocument.load(bytes);
      await applyFolio(doc, computeLabels(2, { prefix: 'F-', padding: 3 }), { prefix: 'F-', position: pos });
      const pages = await readTexts(await doc.save());
      pages.forEach((p, i) => {
        const it = p.items.find((x) => x.str === `F-00${i + 1}`);
        assert.ok(it, `no aparece el folio en la página ${i + 1}`);
        assert.ok(check(p, it), `posición incorrecta ${JSON.stringify(it)} en ${p.width}x${p.height}`);
      });
    });
  }
}

test('folio respeta CropBox desplazado y CTM sin restaurar', async () => {
  const bytes = await makePdf('C', 1, { crop: [50, 60, 400, 500], unbalanced: true });
  const doc = await PDFDocument.load(bytes);
  await applyFolio(doc, ['7'], { position: 'top-right', marginXmm: 10, marginYmm: 10 });
  const [p] = await readTexts(await doc.save());
  assert.equal(p.width, 400);
  const it = p.items.find((x) => x.str === '7');
  assert.ok(it, 'el folio no aparece');
  assert.ok(it.x > 340 && it.x < 400 && it.y > 440 && it.y < 500, JSON.stringify(it));
});

test('folio en letras con tildes (WinAnsi) y fondo blanco', async () => {
  const doc = await PDFDocument.load(await makePdf('W', 16));
  const labels = computeLabels(16, { format: 'num-words' });
  await applyFolio(doc, labels, { format: 'num-words', background: true, position: 'bottom-right' });
  const pages = await readTexts(await doc.save());
  assert.ok(pages[15].items.some((x) => x.str.includes('dieciséis')));
});

// ---------- Organizador ----------
test('combinar, reordenar, rotar, duplicar e insertar en blanco', async () => {
  const sources = new Map([['a', await makePdf('A', 3)], ['b', await makePdf('B', 2, { size: [300, 300] })]]);
  const spec = { pages: [
    { src: 'b', index: 1 }, { src: 'a', index: 0, rotate: 90 }, { blank: { width: 300, height: 400 } },
    { src: 'a', index: 2 }, { src: 'a', index: 2 }, { src: 'b', index: 0 },
  ] };
  const doc = await buildDocument(sources, spec);
  const pages = await readTexts(await doc.save());
  const first = (p) => (p.items[0] || {}).str || '';
  assert.deepEqual(pages.map(first), ['DOCB P2', 'DOCA P1', '', 'DOCA P3', 'DOCA P3', 'DOCB P1']);
  assert.equal(pages[1].rotation, 90);
  assert.equal(pages[2].width, 300);
  assert.equal(pages[2].height, 400);
  assert.equal(pages[0].width, 300);
});

test('dividir por rangos', () => {
  assert.deepEqual(splitRanges('1-2, 3', 4).map((g) => [g.from, g.to]), [[0, 1], [2, 2]]);
  assert.throws(() => splitRanges('5', 4), /fuera/);
});

test('combinar formularios conserva campos y renombra duplicados', async () => {
  const sources = new Map([['x', await makeForm('Ana')], ['y', await makeForm('Luis')]]);
  const doc = await buildDocument(sources, { pages: [{ src: 'x', index: 0 }, { src: 'y', index: 0 }] });
  const reopened = await PDFDocument.load(await doc.save());
  const fields = listFormFields(reopened).map((f) => `${f.name}=${f.value}`).sort();
  assert.deepEqual(fields, ['acepto=false', 'acepto_2=false', 'nombre=Ana', 'nombre_2=Luis']);
});

test('formulario real (fixture PDFcraft) se conserva al reorganizar', async () => {
  const src = fixture('form.pdf');
  const before = listFormFields(await PDFDocument.load(src)).length;
  const doc = await buildDocument(new Map([['f', src]]), { pages: [{ src: 'f', index: 0 }] });
  const after = listFormFields(await PDFDocument.load(await doc.save())).length;
  assert.ok(before > 0);
  assert.equal(after, before);
});

// ---------- Flujo completo: organizar + editar + formulario + foliar ----------
test('exportación completa verificada', async () => {
  const sources = new Map([['a', await makePdf('A', 2)], ['s', await makeScanned(PNG_1PX)]]);
  const state = {
    pages: [{ uid: 'u1', src: 'a', index: 0 }, { uid: 'u2', src: 's', index: 0 }, { uid: 'u3', src: 'a', index: 1, rotate: 180 }],
    edits: [
      { pageUid: 'u2', type: 'text', x: 0.1, y: 0.1, text: 'Recibido: Mesa de Partes\nOficina N.º 3', size: 12 },
      { pageUid: 'u2', type: 'rect', x: 0.1, y: 0.3, w: 0.3, h: 0.05 },
      { pageUid: 'u2', type: 'image', x: 0.5, y: 0.5, w: 0.1, h: 0.1, bytes: PNG_1PX },
      { pageUid: 'u2', type: 'ink', strokes: [[[0.2, 0.8], [0.3, 0.82], [0.4, 0.79]]] },
      { pageUid: 'u2', type: 'ocr', words: [{ text: 'Expediente', x: 0.1, y: 0.6, w: 0.2, h: 0.03 }] },
      { pageUid: 'u3', type: 'cover', x: 0.05, y: 0.05, w: 0.2, h: 0.05 },
      { pageUid: 'borrada', type: 'text', x: 0, y: 0, text: 'no debe aparecer' },
    ],
    folio: { format: 'arabic', prefix: 'FOLIO-', padding: 3, exclude: '1', position: 'top-right' },
  };
  const { bytes, labels } = await exportWorkspace(sources, state);
  assert.deepEqual(labels, [null, 'FOLIO-001', 'FOLIO-002']);
  const pages = await readTexts(bytes);
  assert.equal(pages.length, 3);
  const all = pages.map((p) => p.items.map((i) => i.str).join('|'));
  assert.ok(!all[0].includes('FOLIO'));
  assert.ok(all[1].includes('FOLIO-001') && all[1].includes('Recibido: Mesa de Partes') && all[1].includes('Expediente'));
  assert.ok(all[2].includes('FOLIO-002') && all[2].includes('DOCA P2'));
  assert.ok(!all.join('').includes('no debe aparecer'));
  assert.equal(pages[2].rotation, 180);
});

test('rellenar formulario y combinar con otro documento', async () => {
  const sources = new Map([['f', await makeForm('')], ['a', await makePdf('A', 1)]]);
  const state = {
    pages: [{ uid: '1', src: 'a', index: 0 }, { uid: '2', src: 'f', index: 0 }],
    formValues: { f: { nombre: 'María Pérez', acepto: true } },
  };
  const { bytes } = await exportWorkspace(sources, state);
  const fields = listFormFields(await PDFDocument.load(bytes));
  assert.equal(fields.find((x) => x.name === 'nombre').value, 'María Pérez');
  assert.equal(fields.find((x) => x.name === 'acepto').value, true);
});

test('exportar con formulario aplanado deja el texto como contenido', async () => {
  const sources = new Map([['f', await makeForm('')]]);
  const { bytes } = await exportWorkspace(sources, {
    pages: [{ uid: '1', src: 'f', index: 0 }], formValues: { f: { nombre: 'Aplanado' } },
  }, { flattenForms: true });
  assert.equal(listFormFields(await PDFDocument.load(bytes)).length, 0);
  const [p] = await readTexts(bytes);
  assert.ok(p.items.some((i) => i.str.includes('Aplanado')));
});

test('PDF cifrado se reconoce y no se intenta modificar', async () => {
  const doc = await PDFDocument.load(await makePdf('E', 1));
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 2, R: 3 });
  const { info, doc: loaded } = await analyzePdf(await doc.save(), 'cifrado.pdf');
  assert.equal(info.encrypted, true);
  assert.equal(loaded, null);
});

test('cancelación de una exportación', async () => {
  const sources = new Map([['a', await makePdf('A', 3)]]);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(exportWorkspace(sources, { pages: [{ uid: '1', src: 'a', index: 0 }] }, { signal: ctrl.signal }), /cancelada/);
});

// ---------- Inspección ----------
test('analiza un PDF firmado real y advierte', async () => {
  const { info } = await analyzePdf(fixture('openssl-signed.pdf'), 'firmado.pdf');
  assert.equal(info.hasSignatures, true);
  assert.ok(info.warnings.some((w) => /firmas digitales/.test(w)));
});

test('rechaza datos que no son PDF con mensaje claro', async () => {
  await assert.rejects(analyzePdf(new TextEncoder().encode('hola'), 'x.pdf'), /no es un PDF válido/);
});

test('detecta foliación previa', async () => {
  const doc = await PDFDocument.load(await makePdf('F', 4));
  await applyFolio(doc, computeLabels(4, {}), { position: 'bottom-center' });
  const res = detectExistingFolio(await readTexts(await doc.save()));
  assert.equal(res.likely, true);
  const clean = detectExistingFolio(await readTexts(await makePdf('N', 4)));
  assert.equal(clean.likely, false);
});
