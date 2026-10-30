import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readBlocks, applyTextEdits, blockBox, fallbackFace } from '../src/core/textedit.js';
import { tokenize } from '../src/core/content.js';
import { exportWorkspace } from '../src/core/pipeline.js';
import { applyEdits } from '../src/core/edit.js';
import { fixture, readTexts } from './helpers.mjs';

const nodeFonts = async ({ family, bold, italic }) => new Uint8Array(readFileSync(
  `node_modules/@fontsource/${family}/files/${family}-latin-${bold ? 700 : 400}-${italic ? 'italic' : 'normal'}.woff`));

const textOf = (p) => p.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');

test('tokenizador: cadenas con escapes, hex, arrays, imagen en línea', () => {
  const src = 'BT /F1 12 Tf (a\\(b\\)\\101) Tj [<0041> -250 (x)] TJ ET BI /W 1 /H 1 ID \x00\xffEI\x01 EI Q';
  const ops = tokenize(new Uint8Array([...src].map((c) => c.charCodeAt(0))));
  assert.deepEqual(ops.map((o) => o.op), ['BT', 'Tf', 'Tj', 'TJ', 'ET', 'BI', 'ID', 'EI', 'Q']);
  assert.equal(new TextDecoder().decode(ops[2].args[0].bytes), 'a(b)A');
  assert.equal(ops[3].args[0].length, 3);
});

test('PDF real (Chromium): detecta título, párrafo de 3 líneas y firma', async () => {
  const doc = await PDFDocument.load(fixture('chrome-carta.pdf'));
  const { blocks } = readBlocks(doc.getPage(0));
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].text, 'Solicitud de copia certificada');
  assert.equal(blocks[2].lines.length, 3);
  assert.match(blocks[2].text, /^Señor Jefe de la Mesa de Partes/);
  assert.ok(blocks.every((b) => b.editable));
  const box = blockBox(doc.getPage(0), blocks[0]);
  assert.ok(box.x > 0.1 && box.x < 0.15 && box.y > 0.08 && box.y < 0.12, JSON.stringify(box));
});

test('PDF real: borrar letras y escribir de corrido en el mismo PDF', async () => {
  const doc = await PDFDocument.load(fixture('chrome-carta.pdf'));
  const { blocks } = readBlocks(doc.getPage(0));
  const para = blocks[2];
  const nuevo = 'Señor Jefe de la Mesa de Partes: solicito la expedición de dos copias certificadas del expediente 1234-2026 y de su resolución final, que fueron tramitados ante esta oficina durante el presente año, para presentarlas ante el juzgado correspondiente.';
  await applyTextEdits(doc, 0, [
    { blockIndex: 0, originalText: blocks[0].text, text: 'Solicitud de copias' },
    { blockIndex: 2, originalText: para.text, text: nuevo },
  ], { fontProvider: nodeFonts });
  const [p] = await readTexts(await doc.save());
  const all = textOf(p);
  assert.ok(!all.includes('certificada Lima'), 'el título original debe desaparecer');
  assert.ok(!all.includes('por medio de la presente'), 'el texto original del párrafo debe desaparecer');
  assert.ok(all.includes('Solicitud de copias'));
  assert.ok(all.includes('resolución final'));
  // El resto del documento no se mueve.
  const before = await readTexts(fixture('chrome-carta.pdf'));
  const firma0 = before[0].items.find((i) => i.str.includes('Atentamente'));
  const firma1 = p.items.find((i) => i.str.includes('Atentamente'));
  assert.ok(firma1 && Math.abs(firma1.x - firma0.x) < 0.01 && Math.abs(firma1.y - firma0.y) < 0.01);
  // El párrafo nuevo, más largo, se reparte en más líneas a la misma posición inicial.
  const line1 = p.items.find((i) => i.str.startsWith('Señor Jefe'));
  const orig1 = before[0].items.find((i) => i.str.startsWith('Señor Jefe'));
  assert.ok(Math.abs(line1.x - orig1.x) < 0.5 && Math.abs(line1.y - orig1.y) < 0.5, `${JSON.stringify(line1)} vs ${JSON.stringify(orig1)}`);
  const reopened = await PDFDocument.load(await doc.save());
  assert.equal(reopened.getPageCount(), 1);
});

test('reutiliza la fuente original si tiene los glifos; si no, usa una compatible', () => {
  assert.deepEqual(fallbackFace({ baseFont: 'TimesNewRomanPSMT' }), { family: 'tinos', bold: false, italic: false });
  assert.deepEqual(fallbackFace({ baseFont: 'Arial-BoldMT' }), { family: 'arimo', bold: true, italic: false });
  assert.deepEqual(fallbackFace({ baseFont: 'Calibri-Italic' }), { family: 'carlito', bold: false, italic: true });
  assert.deepEqual(fallbackFace({ baseFont: 'CourierNewPSMT' }), { family: 'cousine', bold: false, italic: false });
});

test('fuente estándar sin /Widths (Helvetica) y texto girado 90°', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  page.drawText('Texto horizontal original', { x: 40, y: 300, size: 14, font });
  page.drawText('Margen vertical', { x: 380, y: 60, size: 10, font, rotate: degrees(90), color: rgb(0.8, 0, 0) });
  const d2 = await PDFDocument.load(await doc.save());
  const { blocks } = readBlocks(d2.getPage(0));
  assert.equal(blocks.length, 2);
  assert.ok(Math.abs(blocks[1].angle - 90) < 0.01);
  assert.deepEqual(blocks[1].color.map((c) => Math.round(c * 10) / 10), [0.8, 0, 0]);
  await applyTextEdits(d2, 0, [
    { blockIndex: 0, originalText: blocks[0].text, text: 'Texto horizontal corregido' },
    { blockIndex: 1, originalText: blocks[1].text, text: 'Margen girado' },
  ], { fontProvider: nodeFonts });
  const [p] = await readTexts(await d2.save());
  const all = textOf(p);
  assert.ok(!all.includes('original') && all.includes('corregido') && all.includes('Margen girado') && !all.includes('Margen vertical'));
});

test('subconjunto TrueType incrustado (Type0 / Identity-H): se reutiliza si alcanzan los glifos', async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await nodeFonts({ family: 'arimo' }), { subset: true });
  const page = doc.addPage([400, 200]);
  page.drawText('abcde edcba', { x: 20, y: 100, size: 18, font });
  const d2 = await PDFDocument.load(await doc.save());
  const { blocks } = readBlocks(d2.getPage(0));
  assert.equal(blocks[0].text, 'abcde edcba');
  assert.ok(blocks[0].font.program, 'debe detectar el programa de fuente incrustado');
  await applyTextEdits(d2, 0, [{ blockIndex: 0, originalText: 'abcde edcba', text: 'cabe bebe' }]);
  const [p] = await readTexts(await d2.save());
  assert.equal(textOf(p).trim(), 'cabe bebe');
});

test('texto invisible de OCR: se tapa con el color del papel y se escribe visible', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  await applyEdits(doc, [{ page: 0, type: 'ocr', words: [{ text: 'Expediente', x: 0.1, y: 0.2, w: 0.3, h: 0.06 }, { text: '123', x: 0.42, y: 0.2, w: 0.1, h: 0.06 }] }]);
  const d2 = await PDFDocument.load(await doc.save());
  const { blocks } = readBlocks(d2.getPage(0));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].invisible, true);
  assert.equal(blocks[0].text, 'Expediente 123');
  await applyTextEdits(d2, 0, [{ blockIndex: 0, originalText: 'Expediente 123', text: 'Expediente 456', paper: '#F4F1E8', ink: '#222222' }], { fontProvider: nodeFonts });
  const again = readBlocks((await PDFDocument.load(await d2.save())).getPage(0)).blocks;
  assert.equal(again.length, 1);
  assert.equal(again[0].invisible, false);
  assert.equal(again[0].text, 'Expediente 456');
});

test('si el documento cambió, la edición se rechaza con mensaje claro', async () => {
  const doc = await PDFDocument.load(fixture('chrome-carta.pdf'));
  await assert.rejects(applyTextEdits(doc, 0, [{ blockIndex: 0, originalText: 'otro texto', text: 'x' }]), /cambió/);
});

test('flujo completo: editar texto existente + foliar + páginas duplicadas independientes', async () => {
  const sources = new Map([['c', fixture('chrome-carta.pdf')]]);
  const doc = await PDFDocument.load(fixture('chrome-carta.pdf'));
  const { blocks } = readBlocks(doc.getPage(0));
  const state = {
    pages: [{ uid: 'a', src: 'c', index: 0 }, { uid: 'b', src: 'c', index: 0 }],
    edits: [{ pageUid: 'b', type: 'textedit', blockIndex: 1, originalText: blocks[1].text, text: 'Cusco, 2 de noviembre de 2026' }],
    folio: { format: 'arabic', position: 'top-right' },
  };
  const { bytes } = await exportWorkspace(sources, state, { fontProvider: nodeFonts });
  const pages = await readTexts(bytes);
  assert.ok(textOf(pages[0]).includes('Lima, 30 de octubre'), 'la copia sin editar se conserva');
  assert.ok(!textOf(pages[1]).includes('Lima, 30') && textOf(pages[1]).includes('Cusco, 2 de noviembre'));
  assert.ok(textOf(pages[1]).includes('2'));
});
