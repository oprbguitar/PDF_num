// Panel lateral: recibe PDFs, los deja en la biblioteca temporal y abre el editor.
import * as store from './store.js';
import * as jobs from './jobs.js';

const $ = (s) => document.querySelector(s);
let files = [];

const setStatus = (msg, kind = '') => { const el = $('#status'); el.textContent = msg; el.className = `msg ${kind}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function refresh() {
  files = (await store.getFiles()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  $('#count').textContent = files.length;
  $('#empty').hidden = files.length > 0;
  $('#quick-merge').disabled = !files.some((f) => !f.info?.encrypted);
  $('#list').innerHTML = files.map((f, i) => `
    <li data-id="${f.id}">
      <div><p class="name">${esc(f.name)}</p>
        <p class="meta">${f.pageCount ?? '?'} pág · ${store.formatBytes(f.size)}${f.pendingAdd ? ' · nuevo' : ''}</p>
        ${f.info?.encrypted ? '<p class="flag danger">Cifrado: solo lectura</p>' : ''}
        ${f.info?.hasSignatures ? '<p class="flag">Firma digital: se invalidará al modificar</p>' : ''}
      </div>
      <div class="order">
        <button data-move="-1" aria-label="Subir ${esc(f.name)}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-move="1" aria-label="Bajar ${esc(f.name)}" ${i === files.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </li>`).join('');
}

async function add(list) {
  const pdfs = [...list].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { setStatus('Solo se aceptan archivos PDF.', 'error'); return; }
  $('#progress').hidden = false;
  let k = 0;
  for (const f of pdfs) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { info, fields } = await jobs.run('analyze', { bytes, name: f.name });
      await store.putFile({ id: store.newId(), name: f.name, size: f.size, bytes, info, fields, pageCount: info.pageCount, pendingAdd: true, order: Date.now() + k });
    } catch (err) {
      setStatus(err.message, 'error');
    }
    $('#progress > i').style.width = `${(++k / pdfs.length) * 100}%`;
  }
  $('#progress').hidden = true;
  store.channel?.postMessage({ type: 'files-added' });
  setStatus(`${pdfs.length} archivo(s) en la biblioteca.`, 'ok');
  refresh();
}

async function move(id, dir) {
  const i = files.findIndex((f) => f.id === id);
  const j = i + dir;
  if (j < 0 || j >= files.length) return;
  [files[i], files[j]] = [files[j], files[i]];
  for (const [n, f] of files.entries()) { f.order = n; await store.putFile(f); }
  refresh();
}

// Abre (o enfoca) la pestaña del editor en el modo pedido.
async function openEditor(mode) {
  let answered = false;
  const onPong = ({ data }) => { if (data?.type === 'pong') answered = true; };
  store.channel?.addEventListener('message', onPong);
  store.channel?.postMessage({ type: 'ping' });
  await new Promise((r) => setTimeout(r, 250));
  store.channel?.removeEventListener('message', onPong);
  if (answered) store.channel.postMessage({ type: 'focus', mode });
  else chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html#mode=${mode}`) });
}

async function quickMerge() {
  const usable = files.filter((f) => !f.info?.encrypted);
  if (!usable.length) return;
  $('#progress').hidden = false;
  $('#quick-merge').disabled = true;
  setStatus('Combinando y verificando…');
  try {
    const pages = usable.flatMap((f) => Array.from({ length: f.pageCount }, (_, i) => ({ uid: `${f.id}-${i}`, src: f.id, index: i })));
    const { bytes } = await jobs.run('export', { sources: usable.map((f) => [f.id, f.bytes]), state: { pages, edits: [] } }, {
      onProgress: (p) => { $('#progress > i').style.width = `${p * 100}%`; },
    });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'combinado.pdf' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(`Listo: ${pages.length} páginas, ${store.formatBytes(bytes.byteLength)}.`, 'ok');
  } catch (err) {
    setStatus(`No se pudo combinar: ${err.message}`, 'error');
  } finally {
    $('#progress').hidden = true;
    $('#quick-merge').disabled = false;
  }
}

const drop = $('#drop');
drop.addEventListener('click', () => $('#file-input').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-input').click(); } });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('#file-input').addEventListener('change', (e) => { add(e.target.files); e.target.value = ''; });
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-move]');
  if (b) move(b.closest('li').dataset.id, Number(b.dataset.move));
});
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.mode)));
$('#quick-merge').addEventListener('click', quickMerge);
store.channel?.addEventListener('message', ({ data }) => { if (data?.type === 'library-changed') refresh(); });
refresh();
