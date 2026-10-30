// Prueba de extremo a extremo: carga dist/extension en Chromium como extensión real
// (Manifest V3), abre el editor en chrome-extension:// y ejecuta el flujo completo:
// añadir PDFs → organizar → editar → foliar → exportar → reabrir y verificar.
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

  // Archivos de prueba inyectados como si se soltaran sobre el escenario.
  const files = { 'a.pdf': await makePdf('A', 3), 'r.pdf': await makePdf('R', 2, { rotate: 90 }), 'f.pdf': await makeForm('') };
  const payload = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
  const helpers = `
    const wait = async (c, ms = 20000) => { const t = Date.now(); while (!c()) { if (Date.now() - t > ms) throw new Error('timeout: ' + c); await new Promise(r => setTimeout(r, 100)); } };
    const st = () => document.querySelector('#status').textContent;
    const q = (s) => document.querySelector(s);`;
  await page.evaluate(`(async () => { ${helpers}
    const dt = new DataTransfer();
    for (const [n, b64] of Object.entries(${JSON.stringify(payload)})) dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n, { type: 'application/pdf' }));
    q('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await wait(() => /añadidos/.test(st()));
  })()`);
  const meta = await page.evaluate("document.querySelector('#meta').textContent");
  assert.match(meta, /^6 páginas/);
  console.log('✔ 3 PDFs añadidos:', meta);

  // 3) Organizar: mover la última página al inicio y rotarla
  await page.evaluate(`(async () => { ${helpers}
    const tiles = [...document.querySelectorAll('#page-grid .tile')];
    tiles[tiles.length - 1].click();
    document.querySelector('[data-act="move-start"]').click();
    document.querySelector('[data-act="rotate-right"]').click();
    await new Promise(r => setTimeout(r, 500));
  })()`);
  console.log('✔ organizar: mover y rotar');

  // 4) Editar: texto en la página 2 y relleno del formulario
  await page.evaluate(`(async () => { ${helpers}
    document.querySelectorAll('#page-grid .tile')[1].click();
    q('#tab-edit').click();
    await wait(() => q('#overlay').getBoundingClientRect().height > 200);
    await new Promise(r => setTimeout(r, 300));
    q('[data-tool="text"]').click();
    const ov = q('#overlay'); const r = ov.getBoundingClientRect();
    const ev = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, button: 0, pointerId: 1 }));
    ev('pointerdown', 0.1, 0.2); ev('pointerup', 0.1, 0.2);
    const ta = q('#prop-text'); ta.value = 'Sello de recepción'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new Event('change'));
    q('#btn-prev').click();
    await wait(() => !q('#form-box').hidden);
    const input = q('#form-fields input[type="text"]'); input.value = 'Rosa Quispe'; input.dispatchEvent(new Event('change'));
  })()`);
  console.log('✔ editar: texto añadido y formulario rellenado');

  // 5) Foliar y exportar (se intercepta la descarga para leer los bytes)
  const out = await page.evaluate(`(async () => { ${helpers}
    q('#tab-folio').click();
    q('[data-preset="A-001"]').click();
    await wait(() => /Vista previa real/.test(q('#folio-info').textContent));
    let blobUrl = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { blobUrl = this.href; return; } return orig.call(this); };
    q('#btn-export').click();
    await wait(() => /Exportado y verificado|No se pudo/.test(st()));
    if (!blobUrl) return { status: st() };
    const b = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { status: st(), b64: btoa(s) };
  })()`);
  assert.ok(out.b64, `No hubo descarga: ${out.status}`);
  const bytes = Buffer.from(out.b64, 'base64');
  const pages = await readTexts(bytes);
  assert.equal(pages.length, 6);
  const texts = pages.map((p) => p.items.map((i) => i.str).join('|'));
  assert.ok(texts[0].includes('A-001'), texts[0]);
  assert.ok(texts[1].includes('Sello de recepción') && texts[1].includes('A-002'), texts[1]);
  assert.ok(texts[5].includes('A-006'));
  const { PDFDocument } = await import('pdf-lib');
  const form = (await PDFDocument.load(bytes)).getForm();
  assert.equal(form.getTextField('nombre').getText(), 'Rosa Quispe');
  console.log(`✔ exportado y verificado: ${pages.length} páginas, ${bytes.length} bytes, folios A-001…A-006, formulario conservado`);

  // 6) OCR sin conexión dentro de la extensión
  const ocr = await page.evaluate(`(async () => { ${helpers}
    q('#tab-edit').click();
    await wait(() => q('#overlay').getBoundingClientRect().height > 200);
    q('#btn-ocr').click();
    await wait(() => /OCR terminado|OCR no disponible/.test(st()), 60000);
    return st();
  })()`);
  assert.match(ocr, /OCR terminado/);
  console.log('✔', ocr);

  // 7) Panel lateral
  const sp = await json(`/json/new?chrome-extension://${extId}/sidepanel.html`, 'PUT');
  const side = cdp(sp.webSocketDebuggerUrl);
  await sleep(800);
  const sideCount = await side.evaluate("document.querySelector('#count').textContent");
  assert.equal(sideCount, '3');
  console.log('✔ panel lateral comparte la biblioteca:', sideCount, 'documentos');
  side.close();

  // Capturas para la documentación (SCREENSHOTS=1)
  if (process.env.SCREENSHOTS) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dir = join(root, 'docs', 'img');
    mkdirSync(dir, { recursive: true });
    const demo = Buffer.from(await makeDemo()).toString('base64');
    await page.evaluate(`(async () => { ${helpers}
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob('${demo}'), c => c.charCodeAt(0))], 'expediente-ejemplo.pdf', { type: 'application/pdf' }));
      q('#tab-organize').click();
      q('#stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await wait(() => /expediente|añadidos/.test(st()) && document.querySelectorAll('#page-grid .tile').length > 6);
      const t = [...document.querySelectorAll('#page-grid .tile')];
      t[7].click();
      t[8].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    })()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
    for (const mode of ['organize', 'edit', 'folio']) {
      await page.evaluate(`(async () => { document.querySelector('#tab-${mode}').click(); await new Promise(r => setTimeout(r, 2500)); })()`);
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(dir, `${mode}.png`), Buffer.from(data, 'base64'));
    }
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
