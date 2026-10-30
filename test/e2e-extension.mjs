// Prueba de extremo a extremo: carga dist/extension en Chromium como extensión real
// (Manifest V3), abre el editor en chrome-extension:// y ejecuta el flujo completo:
// recorrido → abrir PDF e imágenes → organizar → corregir texto del PDF → foliar →
// exportar → reabrir y verificar → OCR → ayuda → panel lateral.
//
//   CHROMIUM=/ruta/a/chrome node test/e2e-extension.mjs
//
// Chrome estable ≥ 137 ignora --load-extension; usa Chromium o Chrome for Testing.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readTexts, makePdf, makeForm, makeDemo } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'dist', 'extension');
const bin = process.env.CHROMIUM;
if (!bin) { console.error('Define CHROMIUM con la ruta de Chromium o Chrome for Testing.'); process.exit(2); }
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'pdf-studio-e2e-'));
const proc = spawn(bin, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${ext}`,
  `--disable-extensions-except=${ext}`, '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path, method = 'GET') {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}${path}`, { method })).json(); } catch { await sleep(200); }
  }
  throw new Error('No responde el puerto de depuración');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else events.push(msg);
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    const res = await new Promise((r) => waiting.set(n, r));
    if (res.error) throw new Error(`${method}: ${res.error.message}`);
    return res.result;
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, events, close: () => ws.close() };
}

let failed = false;
try {
  // 1) ID de la extensión a partir de su service worker
  let extId;
  for (let i = 0; i < 50 && !extId; i++) {
    const targets = await json('/json/list');
    const sw = targets.find((t) => t.type === 'service_worker' && t.url.endsWith('/js/background.js'));
    if (sw) extId = new URL(sw.url).host; else await sleep(200);
  }
  assert.ok(extId, 'La extensión no se cargó (sin service worker)');
  console.log('✔ extensión cargada:', extId);

  // 2) Editor
  const target = await json(`/json/new?chrome-extension://${extId}/editor.html`, 'PUT');
  const page = cdp(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate("location.protocol === 'chrome-extension:' && !!document.querySelector('#stage') && document.readyState === 'complete'").catch(() => false);
    if (ok) break;
    await sleep(150);
  }
  await sleep(800);
  const errors = () => page.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));


  const helpers = `
    const wait = async (c, ms = 20000) => { const t = Date.now(); while (!c()) { if (Date.now() - t > ms) throw new Error('timeout: ' + c); await new Promise(r => setTimeout(r, 100)); } };
    const st = () => document.querySelector('#status').textContent;
    const q = (s) => document.querySelector(s);
    const drop = async (files) => {
      const dt = new DataTransfer();
      for (const [n, b64, type] of files) dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n, { type }));
      const before = document.querySelectorAll('#page-grid .tile').length;
      q('#tab-organize').click();
      q('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await wait(() => /abiertos/.test(st()) && document.querySelectorAll('#page-grid .tile').length > before);
    };`;
  const b64 = (u8) => Buffer.from(u8).toString('base64');

  // 2b) Recorrido inicial visible la primera vez; «Saltar» lo cierra
  const tour = await page.evaluate(`(async () => { ${helpers}
    await wait(() => !q('#tour').hidden, 5000);
    const title = q('#tour-title').textContent;
    q('#tour-skip').click();
    return { title, hidden: q('#tour').hidden };
  })()`);
  assert.equal(tour.hidden, true);
  console.log('✔ recorrido inicial mostrado y saltado:', tour.title);

  // 3) Abrir PDF real (Chromium), sintéticos, formulario y una imagen PNG
  const png = readFileSync(join(ext, 'icons', 'icon-128.png'));
  await page.evaluate(`(async () => { ${helpers}
    await drop(${JSON.stringify([
    ['carta.pdf', b64(readFileSync(join(root, 'test', 'fixtures', 'chrome-carta.pdf'))), 'application/pdf'],
    ['a.pdf', b64(await makePdf('A', 3)), 'application/pdf'],
    ['r.pdf', b64(await makePdf('R', 2, { rotate: 90 })), 'application/pdf'],
    ['f.pdf', b64(await makeForm('')), 'application/pdf'],
    ['foto.png', b64(png), 'image/png'],
  ])});
  })()`);
  const meta = await page.evaluate("document.querySelector('#meta').textContent");
  assert.match(meta, /^8 páginas/);
  console.log('✔ 4 PDF y 1 imagen abiertos:', meta);

  // 4) Organizar: mover la página de la imagen al inicio y rotarla
  await page.evaluate(`(async () => { ${helpers}
    const tiles = [...document.querySelectorAll('#page-grid .tile')];
    tiles[tiles.length - 1].click();
    await wait(() => !q('#sel-bar').hidden);
    q('[data-act="rotate-right"]').click();
    await new Promise(r => setTimeout(r, 300));
    const t2 = [...document.querySelectorAll('#page-grid .tile')];
    t2[t2.length - 1].click();
    // Alt+← lleva la página hacia el inicio
    for (let k = 0; k < 7; k++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
  })()`);
  console.log('✔ organizar: rotar y mover con el teclado');

  // 5) Editar el texto existente del PDF real (página 2 = carta)
  const edit = await page.evaluate(`(async () => { ${helpers}
    document.querySelectorAll('#page-grid .tile')[1].click();
    q('#tab-edit').click();
    await wait(() => document.querySelectorAll('.tblock').length >= 4);
    const para = document.querySelectorAll('.tblock')[2];
    const r = para.getBoundingClientRect();
    para.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4, button: 0, pointerId: 1 }));
    await wait(() => q('.text-editor'));
    const ta = q('.text-editor');
    const before = ta.value;
    ta.value = 'Señor Jefe de la Mesa de Partes: solicito dos copias certificadas del expediente 1234-2026 y de su resolución final, para presentarlas ante el juzgado que corresponda. Agradezco su atención.';
    ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelectorAll('.tblock.edited').length === 1);
    // Corregir también la fecha (bloque de una línea)
    const fecha = document.querySelectorAll('.tblock')[1];
    const r2 = fecha.getBoundingClientRect();
    fecha.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r2.left + 4, clientY: r2.top + 4, button: 0, pointerId: 1 }));
    await wait(() => q('.text-editor'));
    q('.text-editor').value = 'Cusco, 2 de noviembre de 2026';
    q('.text-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelectorAll('.tblock.edited').length === 2);
    await new Promise(r => setTimeout(r, 1500));
    return { before };
  })()`);
  assert.match(edit.before, /^Señor Jefe de la Mesa de Partes: por medio/);
  console.log('✔ editar texto: párrafo y fecha corregidos en la página');

  // 6) Añadir texto en una página sintética y rellenar el formulario
  await page.evaluate(`(async () => { ${helpers}
    const strip = [...document.querySelectorAll('#edit-strip .tile')];
    strip[2].click();
    await wait(() => q('#overlay').getBoundingClientRect().height > 200);
    await new Promise(r => setTimeout(r, 400));
    q('[data-tool="text"]').click();
    const ov = q('#overlay'); const r = ov.getBoundingClientRect();
    const ev = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, button: 0, pointerId: 1 }));
    ev('pointerdown', 0.1, 0.2); ev('pointerup', 0.1, 0.2);
    const ta = q('#prop-text'); ta.value = 'Sello de recepción · N.º 45'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new Event('change'));
    q('[data-tool="edittext"]').click();
    const strip2 = [...document.querySelectorAll('#edit-strip .tile')];
    strip2[strip2.length - 1].click();
    await wait(() => !q('#form-box').hidden);
    const input = q('#form-fields input[type="text"]'); input.value = 'Rosa Quispe'; input.dispatchEvent(new Event('change'));
  })()`);
  console.log('✔ texto añadido (con «º» y «·») y formulario rellenado');

  // 7) Ayuda: F1 abre el tema del modo actual; la búsqueda filtra
  const help = await page.evaluate(`(async () => { ${helpers}
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
    await wait(() => !q('#help').hidden);
    const topic = q('#help-topic h2')?.textContent;
    q('#help-topic [data-back]').click();
    q('#help-q').value = 'bates'; q('#help-q').dispatchEvent(new Event('input'));
    const hits = [...document.querySelectorAll('#help-index [data-topic]')].map(b => b.dataset.topic);
    q('#help-q').value = 'zzzz'; q('#help-q').dispatchEvent(new Event('input'));
    const empty = !!q('.help-empty');
    q('#help-q').value = ''; q('#help-q').dispatchEvent(new Event('input'));
    q('#help-close').click();
    return { topic, hits, empty, closed: q('#help').hidden };
  })()`);
  assert.equal(help.topic, 'Corregir el texto del PDF');
  assert.ok(help.hits.includes('foliar-avanzado') && help.empty && help.closed);
  console.log('✔ ayuda contextual, búsqueda y estado sin resultados');

  // 8) Foliar y exportar (se intercepta la descarga para leer los bytes)
  const out = await page.evaluate(`(async () => { ${helpers}
    q('#tab-folio').click();
    q('[data-preset="A-001"]').click();
    await wait(() => /Vista previa real/.test(q('#folio-info').textContent), 30000);
    let blobUrl = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { blobUrl = this.href; return; } return orig.call(this); };
    q('#btn-export').click();
    await wait(() => /Exportado y verificado|No se pudo/.test(st()), 30000);
    if (!blobUrl) return { status: st() };
    const b = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { status: st(), b64: btoa(s) };
  })()`);
  assert.ok(out.b64, `No hubo descarga: ${out.status}`);
  const bytes = Buffer.from(out.b64, 'base64');
  const pages = await readTexts(bytes);
  assert.equal(pages.length, 8);
  const texts = pages.map((p) => p.items.map((i) => i.str).join(' ').replace(/\s+/g, ' '));
  assert.ok(texts[0].includes('A-001'), texts[0]);
  assert.ok(!texts[1].includes('por medio de la presente') && !texts[1].includes('Lima, 30'), 'el texto original debe desaparecer');
  assert.ok(texts[1].includes('resolución final') && texts[1].includes('Cusco, 2 de noviembre') && texts[1].includes('A-002'), texts[1]);
  assert.ok(texts[1].includes('Atentamente'), 'el resto de la carta se conserva');
  assert.ok(texts[2].includes('Sello de recepción · N.º 45'), texts[2]);
  assert.ok(texts[7].includes('A-008'));
  const { PDFDocument } = await import('pdf-lib');
  const form = (await PDFDocument.load(bytes)).getForm();
  assert.equal(form.getTextField('nombre').getText(), 'Rosa Quispe');
  console.log(`✔ exportado y verificado: ${pages.length} páginas, texto corregido dentro del PDF, folios A-001…A-008, formulario conservado`);

  // 9) «Escaneo»: una captura PNG de un texto impreso → OCR → corregir una línea → exportar
  const scanTab = await json('/json/new?about:blank', 'PUT');
  const scan = cdp(scanTab.webSocketDebuggerUrl);
  await scan.send('Emulation.setDeviceMetricsOverride', { width: 850, height: 1100, deviceScaleFactor: 1, mobile: false });
  await scan.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent('<body style="margin:90px;font:30px Georgia,serif;color:#222;background:#f6f3ea"><p>ACTA DE ENTREGA</p><p>Se entrega el expediente 2041 completo.</p><p>Recibido por la oficina de archivo.</p></body>')}` });
  await sleep(1200);
  const scanPng = Buffer.from((await scan.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  scan.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${scanTab.id}`).catch(() => {});
  await page.send('Page.bringToFront');
  const ocr = await page.evaluate(`(async () => { ${helpers}
    await drop([['escaneo.png', '${b64(scanPng)}', 'image/png']]);
    q('#tab-edit').click();
    const strip = [...document.querySelectorAll('#edit-strip .tile')];
    strip[strip.length - 1].click();
    await wait(() => /Escaneada/.test(q('#page-kind').textContent));
    q('#btn-ocr').click();
    await wait(() => /OCR terminado|OCR no disponible/.test(st()), 90000);
    const status = st();
    await wait(() => [...document.querySelectorAll('.tblock')].length >= 3);
    const line = document.querySelectorAll('.tblock')[1];
    const r = line.getBoundingClientRect();
    line.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4, button: 0, pointerId: 1 }));
    await wait(() => q('.text-editor'));
    const recognized = q('.text-editor').value;
    q('.text-editor').value = 'Se entrega el expediente 2042 completo.';
    q('.text-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelectorAll('.tblock.edited').length === 1);
    let blobUrl = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { blobUrl = this.href; return; } return orig.call(this); };
    q('#btn-export').click();
    await wait(() => /Exportado y verificado|No se pudo/.test(st()), 30000);
    const b = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { status, recognized, b64: btoa(s) };
  })()`);
  assert.match(ocr.status, /OCR terminado/);
  assert.match(ocr.recognized, /expediente 2041/);
  const scanned = await readTexts(Buffer.from(ocr.b64, 'base64'));
  assert.ok(scanned[scanned.length - 1].items.some((i) => i.str.includes('expediente 2042')), 'la línea corregida debe estar en el PDF');
  console.log(`✔ escaneo: ${ocr.status.split(':')[0]}, reconocido «${ocr.recognized}», corregido y exportado`);

  // 10) Panel lateral
  const sp = await json(`/json/new?chrome-extension://${extId}/sidepanel.html`, 'PUT');
  const side = cdp(sp.webSocketDebuggerUrl);
  await sleep(1000);
  const sideCount = await side.evaluate("document.querySelector('#count').textContent");
  assert.equal(sideCount, '6');
  console.log('✔ panel lateral comparte la biblioteca:', sideCount, 'documentos');
  if (process.env.SCREENSHOTS) {
    await side.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 760, deviceScaleFactor: 2, mobile: false });
    await side.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await sleep(500);
    const { data } = await side.send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(join(root, 'docs', 'img', 'sidepanel.png'), Buffer.from(data, 'base64'));
  }
  side.close();

  // Capturas para la documentación (SCREENSHOTS=1)
  if (process.env.SCREENSHOTS) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dir = join(root, 'docs', 'img');
    await page.send("Page.bringToFront");
    mkdirSync(dir, { recursive: true });
    await page.evaluate(`(async () => { ${helpers}
      await drop([['expediente-ejemplo.pdf', '${b64(await makeDemo())}', 'application/pdf']]);
      const t = [...document.querySelectorAll('#page-grid .tile')];
      t[9].click();
      t[10].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    })()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const shot = async (name, js) => {
      await page.evaluate(`(async () => { ${helpers} ${js}; await new Promise(r => setTimeout(r, 2500)); })()`);
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
    };
    await shot('organize', "q('#tab-organize').click()");
    await shot('edit', `q('#tab-edit').click(); document.querySelectorAll('#edit-strip .tile')[1].click();
      await wait(() => document.querySelectorAll('.tblock').length >= 4); await new Promise(r => setTimeout(r, 800));
      const tb = document.querySelectorAll('.tblock')[3]; const r = tb.getBoundingClientRect();
      tb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4, button: 0, pointerId: 1 }))`);
    await shot('folio', "document.querySelector('.text-editor') && document.querySelector('.text-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); q('#tab-folio').click()");
    await shot('help', "q('#tab-edit').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))");
    await page.evaluate("document.querySelector('#help-close').click()");
    await page.send('Emulation.clearDeviceMetricsOverride');
    console.log('✔ capturas guardadas en docs/img');
  }

  const errs = errors();
  assert.equal(errs.length, 0, `Errores en consola: ${JSON.stringify(errs.map((e) => e.params), null, 1)}`);
  console.log('✔ sin errores en consola');
  page.close();
} catch (err) {
  failed = true;
  console.error('✖', err.message);
} finally {
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* perfil en uso */ }
}
process.exit(failed ? 1 : 0);
