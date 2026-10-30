// PDF Studio — controlador del editor de pantalla completa.
import * as store from './store.js';
import * as render from './render.js';
import * as jobs from './jobs.js';
import { recognize, terminateOcr } from './ocr.js';
import { DEFAULT_FOLIO, FORMATS, PRESETS, computeLabels } from '../core/folio.js';
import { detectExistingFolio, looksScanned } from '../core/inspect.js';
import { docStarts } from '../core/pipeline.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- estado
const S = {
  files: new Map(), // id → { id, name, size, bytes, pageCount, info, fields, color, pendingAdd }
  order: [],
  ws: emptyWorkspace(),
  sel: new Set(),
  anchor: null,
  focusUid: null,
  mode: 'organize',
  editIndex: 0,
  tool: 'select',
  selObj: null,
  inkObj: null,
  busy: false,
  previewKey: null,
  previewLabels: [],
};

function emptyWorkspace() {
  return { pages: [], edits: [], formValues: {}, folio: { ...DEFAULT_FOLIO, enabled: false }, flatten: false, ocr: {}, images: {}, nextUid: 1 };
}

// ---------------------------------------------------------------- historial (deshacer/rehacer)
const hist = { past: [], future: [], current: null };
const snapshot = () => JSON.stringify({
  pages: S.ws.pages, edits: S.ws.edits, formValues: S.ws.formValues, folio: S.ws.folio, flatten: S.ws.flatten,
  ocrEmbed: Object.fromEntries(Object.entries(S.ws.ocr).map(([k, v]) => [k, v.embed])),
});
function restore(snap) {
  const s = JSON.parse(snap);
  Object.assign(S.ws, { pages: s.pages, edits: s.edits, formValues: s.formValues, folio: s.folio, flatten: s.flatten });
  for (const [k, o] of Object.entries(S.ws.ocr)) o.embed = Boolean(s.ocrEmbed[k]);
  const uids = new Set(S.ws.pages.map((p) => p.uid));
  S.sel = new Set([...S.sel].filter((u) => uids.has(u)));
  S.selObj = null;
  S.inkObj = null;
}
function commit() {
  const snap = snapshot();
  if (snap === hist.current) return;
  if (hist.current !== null) hist.past.push(hist.current);
  if (hist.past.length > 150) hist.past.shift();
  hist.current = snap;
  hist.future = [];
  afterChange();
}
function resetHistory() { hist.past = []; hist.future = []; hist.current = snapshot(); }
function undo() {
  if (!hist.past.length) return;
  hist.future.push(hist.current);
  hist.current = hist.past.pop();
  restore(hist.current);
  afterChange();
  setStatus('Deshecho.');
}
function redo() {
  if (!hist.future.length) return;
  hist.past.push(hist.current);
  hist.current = hist.future.pop();
  restore(hist.current);
  afterChange();
  setStatus('Rehecho.');
}

let saveTimer;
function afterChange() {
  $('#btn-undo').disabled = !hist.past.length;
  $('#btn-redo').disabled = !hist.future.length;
  renderAll();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.saveWorkspace({ ws: S.ws, order: S.order }).catch(() => {});
    store.channel?.postMessage({ type: 'library-changed' });
  }, 400);
}

// ---------------------------------------------------------------- estado / progreso
function setStatus(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = `msg ${kind}`;
}
function busy(on, msg) {
  S.busy = on;
  $('#progress').hidden = !on;
  $('#btn-cancel').hidden = !on;
  $('#progress > i').style.width = '0%';
  $('#btn-export').disabled = on || !S.ws.pages.length;
  $('#btn-export').classList.toggle('is-loading', on);
  if (msg) setStatus(msg);
}
const progress = (f) => { $('#progress > i').style.width = `${Math.round(f * 100)}%`; };

// ---------------------------------------------------------------- archivos
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

async function addFiles(fileList, insertAt) {
  const files = [...fileList];
  const bad = files.filter((f) => !isPdf(f));
  if (bad.length) setStatus(`Se ignoraron ${bad.length} archivo(s) que no son PDF.`, 'error');
  const pdfs = files.filter(isPdf);
  if (!pdfs.length) return;
  busy(true, `Leyendo ${pdfs.length} archivo(s)…`);
  const newPages = [];
  const warnings = [];
  try {
    for (const [k, f] of pdfs.entries()) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const rec = { id: store.newId(), name: f.name, size: f.size, bytes, color: store.tagColor(S.order.length) };
      await registerFile(rec);
      await store.putFile(stripRuntime(rec));
      if (rec.info.encrypted) warnings.push(`${f.name}: cifrado, no se puede modificar.`);
      else newPages.push(...pagesOf(rec));
      progress((k + 1) / pdfs.length);
    }
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    busy(false);
  }
  insertPages(newPages, insertAt);
  commit();
  if (warnings.length) setStatus(warnings.join(' '), 'error');
  else setStatus(`${pdfs.length} documento(s) añadidos · ${newPages.length} página(s).`, 'ok');
  refreshFolioWarnings();
}

// Analiza (en el worker) y abre con pdf.js; deja el registro listo en S.files.
async function registerFile(rec) {
  if (!rec.info) {
    const { info, fields } = await jobs.run('analyze', { bytes: rec.bytes, name: rec.name });
    rec.info = info;
    rec.fields = fields;
    rec.pageCount = info.pageCount;
  }
  if (!rec.info.encrypted) {
    const doc = await render.openDoc(rec.id, rec.bytes);
    rec.pageCount = doc.numPages;
  }
  S.files.set(rec.id, rec);
  if (!S.order.includes(rec.id)) S.order.push(rec.id);
}
const stripRuntime = (rec) => ({ id: rec.id, name: rec.name, size: rec.size, bytes: rec.bytes, color: rec.color, info: rec.info, fields: rec.fields, pageCount: rec.pageCount });

function pagesOf(rec) {
  return Array.from({ length: rec.pageCount }, (_, i) => ({ uid: `p${S.ws.nextUid++}`, src: rec.id, index: i, rotate: 0 }));
}

function insertPages(pages, at) {
  if (!pages.length) return;
  let pos = at;
  if (pos == null) {
    if ($('#insert-mode').value === 'after' && S.sel.size) {
      const idx = S.ws.pages.map((p, i) => (S.sel.has(p.uid) ? i : -1)).filter((i) => i >= 0);
      pos = Math.max(...idx) + 1;
    } else pos = S.ws.pages.length;
  }
  S.ws.pages.splice(pos, 0, ...pages);
  S.sel = new Set(pages.map((p) => p.uid));
  S.anchor = pages[0].uid;
}

async function removeFile(id) {
  const rec = S.files.get(id);
  const used = S.ws.pages.filter((p) => p.src === id).length;
  if (used && !(await confirmDlg('Quitar documento', `Se quitarán ${used} página(s) de «${rec.name}» del documento final. Esta acción no se puede deshacer.`))) return;
  S.ws.pages = S.ws.pages.filter((p) => p.src !== id);
  const gone = new Set(S.ws.pages.map((p) => p.uid));
  S.ws.edits = S.ws.edits.filter((e) => gone.has(e.pageUid));
  delete S.ws.formValues[id];
  S.files.delete(id);
  S.order = S.order.filter((x) => x !== id);
  await store.deleteFile(id);
  await render.closeDoc(id);
  resetHistory();
  afterChange();
  setStatus(`«${rec.name}» quitado de la biblioteca. El archivo original no se modificó.`);
}

async function clearLibrary() {
  if (!(await confirmDlg('Vaciar biblioteca', 'Se quitarán todos los documentos y el trabajo en curso de esta extensión. Tus archivos originales no se tocan.'))) return;
  busy(true, 'Vaciando la biblioteca…');
  for (const id of S.order) await render.closeDoc(id);
  S.files.clear();
  S.order = [];
  S.ws = emptyWorkspace();
  S.sel.clear();
  S.selObj = null;
  await store.clearAll();
  busy(false);
  resetHistory();
  afterChange();
  setStatus('Biblioteca vaciada.');
}

// Archivos que el panel lateral dejó pendientes de añadir.
async function absorbPending() {
  const all = await store.getFiles();
  const fresh = all.filter((f) => f.pendingAdd && !S.files.has(f.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!fresh.length) return 0;
  const pages = [];
  for (const f of fresh) {
    f.color = store.tagColor(S.order.length);
    delete f.pendingAdd;
    await registerFile(f);
    await store.putFile(stripRuntime(f));
    if (!f.info.encrypted) pages.push(...pagesOf(f));
  }
  insertPages(pages, S.ws.pages.length);
  commit();
  return fresh.length;
}

// ---------------------------------------------------------------- render general
function renderAll() {
  renderLibrary();
  renderMeta();
  if (S.mode === 'organize') renderGrid();
  if (S.mode === 'edit') renderEdit();
  if (S.mode === 'folio') { syncFolioForm(); scheduleFolioPreview(); }
  $('#empty').hidden = S.ws.pages.length > 0 || S.files.size > 0;
  $('#btn-export').disabled = S.busy || !S.ws.pages.length;
  $('#btn-clear').disabled = !S.files.size;
}

function estimateSize() {
  let total = 0;
  for (const p of S.ws.pages) {
    if (p.blank) { total += 900; continue; }
    const f = S.files.get(p.src);
    if (f) total += f.size / Math.max(1, f.pageCount);
  }
  return total;
}

function renderMeta() {
  const n = S.ws.pages.length;
  const txt = `${n} página${n === 1 ? '' : 's'} · ≈ ${store.formatBytes(estimateSize())}`;
  $('#meta').textContent = txt;
  const blanks = S.ws.pages.filter((p) => p.blank).length;
  const rotated = S.ws.pages.filter((p) => p.rotate).length;
  const docs = new Set(S.ws.pages.filter((p) => !p.blank).map((p) => p.src)).size;
  $('#org-summary').innerHTML = `
    <dt>Documentos</dt><dd>${docs}</dd><dt>Páginas</dt><dd>${n}</dd>
    <dt>En blanco</dt><dd>${blanks}</dd><dt>Rotadas</dt><dd>${rotated}</dd>
    <dt>Ediciones</dt><dd>${S.ws.edits.length}</dd><dt>Tamaño</dt><dd>≈ ${store.formatBytes(estimateSize())}</dd>`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderLibrary() {
  $('#lib-count').textContent = S.files.size;
  const list = $('#file-list');
  list.innerHTML = '';
  for (const id of S.order) {
    const f = S.files.get(id);
    if (!f) continue;
    const used = S.ws.pages.filter((p) => p.src === id).length;
    const li = document.createElement('li');
    li.className = 'file-row';
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.dataset.id = id;
    li.style.setProperty('--src', f.color);
    const flags = [];
    if (f.info.encrypted) flags.push('<p class="file-flag danger">Cifrado: solo lectura</p>');
    if (f.info.hasSignatures) flags.push('<p class="file-flag">Firma digital: se invalidará</p>');
    if (f.info.fieldCount) flags.push(`<p class="file-flag">${f.info.fieldCount} campo(s) de formulario</p>`);
    li.innerHTML = `<span class="src-tag"></span>
      <div><p class="file-name">${esc(f.name)}</p>
      <p class="file-meta">${f.pageCount || 0} pág · ${store.formatBytes(f.size)} · ${used} en uso</p>${flags.join('')}</div>
      <div class="file-actions">
        <button class="icon-btn" data-act="readd" title="Añadir de nuevo sus páginas" aria-label="Añadir de nuevo las páginas de ${esc(f.name)}" ${f.info.encrypted ? 'disabled' : ''}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg></button>
        <button class="icon-btn" data-act="remove" title="Quitar de la biblioteca" aria-label="Quitar ${esc(f.name)}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
      </div>`;
    if (f.info.warnings && f.info.warnings.length) li.title = f.info.warnings.join('\n');
    list.append(li);
  }
}

// ---------------------------------------------------------------- Organizar: rejilla
const tiles = new Map(); // uid → elemento
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { paintTile(e.target); io.unobserve(e.target); }
}, { root: $('#stage'), rootMargin: '400px' });

function thumbWidth() { return Number($('#zoom').value) - 12; }

function tileFor(p) {
  let t = tiles.get(p.uid);
  if (!t) {
    t = document.createElement('div');
    t.className = 'tile';
    t.draggable = true;
    t.tabIndex = -1;
    t.setAttribute('role', 'option');
    t.dataset.uid = p.uid;
    t.innerHTML = '<div class="thumb"><div class="loading"></div></div><div class="tile-cap"><span class="src-tag"></span><span class="n"></span><span class="src"></span></div>';
    tiles.set(p.uid, t);
  }
  const key = `${p.src}|${p.index}|${p.rotate || 0}|${thumbWidth()}`;
  if (t.dataset.key !== key) { t.dataset.key = key; t.dataset.painted = ''; io.observe(t); }
  return t;
}

async function paintTile(t) {
  const p = S.ws.pages.find((x) => x.uid === t.dataset.uid);
  if (!p || t.dataset.painted === t.dataset.key) return;
  const holder = $('.thumb', t);
  const w = thumbWidth();
  if (p.blank) {
    const ratio = (p.blank.height || 842) / (p.blank.width || 595);
    holder.innerHTML = `<div class="blank" style="aspect-ratio:1/${ratio.toFixed(3)}"></div>`;
  } else {
    try {
      const bmp = await render.thumbnail(p.src, p.index, w, p.rotate || 0);
      const cv = document.createElement('canvas');
      render.paintBitmap(cv, bmp);
      cv.setAttribute('aria-hidden', 'true');
      holder.replaceChildren(cv);
    } catch {
      holder.innerHTML = '<div class="blank"></div>';
    }
  }
  t.dataset.painted = t.dataset.key;
}

function renderGrid() {
  const grid = $('#page-grid');
  document.documentElement.style.setProperty('--thumb-w', `${$('#zoom').value}px`);
  const live = new Set();
  const frag = document.createDocumentFragment();
  S.ws.pages.forEach((p, i) => {
    const t = tileFor(p);
    live.add(p.uid);
    const f = S.files.get(p.src);
    t.style.setProperty('--src', p.blank ? 'var(--line-strong)' : f?.color);
    $('.n', t).textContent = String(i + 1);
    $('.src', t).textContent = p.blank ? 'en blanco' : `${f?.name ?? '?'} · p${p.index + 1}`;
    t.setAttribute('aria-label', `Página ${i + 1}: ${p.blank ? 'en blanco' : `${f?.name} página ${p.index + 1}`}${p.rotate ? `, rotada ${p.rotate}°` : ''}`);
    t.setAttribute('aria-selected', S.sel.has(p.uid) ? 'true' : 'false');
    t.tabIndex = p.uid === (S.focusUid || S.ws.pages[0]?.uid) ? 0 : -1;
    let badge = $('.tile-badge', t);
    if (p.rotate) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tile-badge'; t.append(badge); }
      badge.textContent = `${p.rotate}°`;
    } else if (badge) badge.remove();
    frag.append(t);
  });
  grid.replaceChildren(frag);
  for (const uid of [...tiles.keys()]) if (!live.has(uid)) { io.unobserve(tiles.get(uid)); tiles.delete(uid); }
  const n = S.sel.size;
  $('#sel-info').textContent = n ? `${n} página${n === 1 ? '' : 's'} seleccionada${n === 1 ? '' : 's'}` : 'Sin selección';
  $$('#panel-organize [data-act]').forEach((b) => { b.disabled = !n; });
}

function selectedIndexes() {
  return S.ws.pages.map((p, i) => (S.sel.has(p.uid) ? i : -1)).filter((i) => i >= 0);
}

function clickTile(uid, e) {
  if (e.shiftKey && S.anchor) {
    const a = S.ws.pages.findIndex((p) => p.uid === S.anchor);
    const b = S.ws.pages.findIndex((p) => p.uid === uid);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (!(e.ctrlKey || e.metaKey)) S.sel.clear();
    for (let i = lo; i <= hi; i++) S.sel.add(S.ws.pages[i].uid);
  } else if (e.ctrlKey || e.metaKey) {
    S.sel.has(uid) ? S.sel.delete(uid) : S.sel.add(uid);
    S.anchor = uid;
  } else {
    S.sel = new Set([uid]);
    S.anchor = uid;
  }
  S.focusUid = uid;
  renderGrid();
}

function moveSelectedTo(target) {
  const moving = S.ws.pages.filter((p) => S.sel.has(p.uid));
  const before = S.ws.pages.slice(0, target).filter((p) => !S.sel.has(p.uid)).length;
  const rest = S.ws.pages.filter((p) => !S.sel.has(p.uid));
  rest.splice(before, 0, ...moving);
  S.ws.pages = rest;
}

function act(name) {
  const idx = selectedIndexes();
  if (!idx.length) return;
  const pages = S.ws.pages;
  switch (name) {
    case 'rotate-left':
    case 'rotate-right':
      rotatePages(idx.map((i) => pages[i]), name === 'rotate-right');
      return;
    case 'duplicate': {
      const copies = idx.map((i) => {
        const copy = { ...pages[i], uid: `p${S.ws.nextUid++}` };
        // La copia lleva también sus objetos añadidos (texto, firmas, marcas).
        for (const e of S.ws.edits.filter((o) => o.pageUid === pages[i].uid)) {
          S.ws.edits.push({ ...structuredClone(e), id: store.newId(), pageUid: copy.uid });
        }
        return copy;
      });
      pages.splice(Math.max(...idx) + 1, 0, ...copies);
      S.sel = new Set(copies.map((c) => c.uid));
      break;
    }
    case 'delete': {
      const n = idx.length;
      S.ws.pages = pages.filter((p) => !S.sel.has(p.uid));
      S.sel.clear();
      setStatus(`${n} página(s) eliminada(s) del resultado. Ctrl+Z para deshacer.`);
      break;
    }
    case 'move-start': moveSelectedTo(0); break;
    case 'move-end': moveSelectedTo(pages.length); break;
    case 'blank': {
      const ref = pages[Math.max(...idx)];
      const size = ref.blank || sizeOf(ref) || { width: 595.28, height: 841.89 };
      const b = { uid: `p${S.ws.nextUid++}`, blank: { width: size.width, height: size.height } };
      pages.splice(Math.max(...idx) + 1, 0, b);
      S.sel = new Set([b.uid]);
      break;
    }
    case 'extract': extractSelection(); return;
    default: return;
  }
  commit();
}

// Rota páginas y gira con ellas los objetos añadidos, para que sigan sobre el mismo contenido.
// Las coordenadas son normalizadas (0–1, origen arriba-izquierda) de la página vista.
async function rotatePages(list, cw) {
  for (const p of list) {
    if (p.blank) { const { width, height } = p.blank; p.blank = { width: height, height: width }; }
    else await primeSize(p).catch(() => {});
    const base = p.blank ? { width: p.blank.height, height: p.blank.width } : sizeOf(p) || { width: 595, height: 842 };
    const turned = !p.blank && (p.rotate || 0) % 180 !== 0;
    const W = turned ? base.height : base.width; // tamaño visual antes de rotar
    const H = turned ? base.width : base.height;
    const pt = (x, y) => (cw ? [1 - y, x] : [y, 1 - x]);
    for (const e of S.ws.edits.filter((o) => o.pageUid === p.uid)) {
      if (e.type === 'ink') {
        e.strokes = e.strokes.map((s) => s.map(([x, y]) => pt(x, y)));
        inkBounds(e);
      } else if (e.type === 'text') {
        [e.x, e.y] = pt(e.x, e.y);
        if (cw) e.x = clamp(e.x - 0.05, 0, 1); else e.y = clamp(e.y - 0.02, 0, 1);
      } else {
        const cx = e.x + e.w / 2; const cy = e.y + e.h / 2;
        const [ncx, ncy] = pt(cx, cy);
        // Zonas (resaltado/tapado) giran con la página; las imágenes se mantienen derechas.
        const [w, h] = e.type === 'image' ? [e.w * W / H, e.h * H / W] : [e.h, e.w];
        e.w = w; e.h = h;
        e.x = clamp(ncx - w / 2, 0, 1 - w); e.y = clamp(ncy - h / 2, 0, 1 - h);
      }
    }
    if (!p.blank) p.rotate = (((p.rotate || 0) + (cw ? 90 : -90)) % 360 + 360) % 360;
  }
  commit();
}

// Tamaño visual (puntos) de una página fuente, desde la caché de pdf.js si está disponible.
const sizes = new Map();
function sizeOf(p) { return sizes.get(`${p.src}|${p.index}`); }
async function primeSize(p) {
  if (p.blank || sizes.has(`${p.src}|${p.index}`)) return;
  const doc = await render.openDoc(p.src, S.files.get(p.src).bytes);
  const page = await doc.getPage(p.index + 1);
  const vp = page.getViewport({ scale: 1 });
  sizes.set(`${p.src}|${p.index}`, { width: vp.width, height: vp.height });
}

// ---------------------------------------------------------------- arrastrar y soltar
let dragUids = null;
function setupDnD() {
  const grid = $('#page-grid');
  const stage = $('#stage');
  const clearMarks = () => $$('.drop-before, .drop-after', grid).forEach((t) => t.classList.remove('drop-before', 'drop-after'));
  const dropIndex = (e) => {
    const t = e.target.closest('.tile');
    if (!t) return S.ws.pages.length;
    const r = t.getBoundingClientRect();
    const i = S.ws.pages.findIndex((p) => p.uid === t.dataset.uid);
    return e.clientX > r.left + r.width / 2 ? i + 1 : i;
  };
  grid.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    if (!S.sel.has(t.dataset.uid)) { S.sel = new Set([t.dataset.uid]); S.anchor = t.dataset.uid; renderGrid(); }
    dragUids = [...S.sel];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${dragUids.length} páginas`);
    dragUids.forEach((u) => tiles.get(u)?.classList.add('dragging'));
  });
  grid.addEventListener('dragend', () => {
    dragUids = null;
    $$('.dragging', grid).forEach((t) => t.classList.remove('dragging'));
    clearMarks();
  });
  stage.addEventListener('dragover', (e) => {
    const hasFiles = [...(e.dataTransfer?.types || [])].includes('Files');
    if (!dragUids && !hasFiles) return;
    e.preventDefault();
    stage.classList.toggle('drag-over', hasFiles);
    clearMarks();
    const t = e.target.closest?.('.tile');
    if (t && S.mode === 'organize') {
      const r = t.getBoundingClientRect();
      t.classList.add(e.clientX > r.left + r.width / 2 ? 'drop-after' : 'drop-before');
    }
  });
  stage.addEventListener('dragleave', (e) => { if (!stage.contains(e.relatedTarget)) { stage.classList.remove('drag-over'); clearMarks(); } });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drag-over');
    const at = S.mode === 'organize' ? dropIndex(e) : undefined;
    clearMarks();
    if (e.dataTransfer.files.length) { addFiles(e.dataTransfer.files, at); return; }
    if (dragUids) { moveSelectedTo(at); dragUids = null; commit(); }
  });
  // Soltar fuera del escenario no debe abrir el PDF en la pestaña.
  for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => { if (!stage.contains(e.target)) e.preventDefault(); });
  $('.library').addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
}

// ---------------------------------------------------------------- exportación
function exportState({ folio = true } = {}) {
  const edits = S.ws.edits.map((e) => (e.type === 'image' ? { ...e, bytes: S.ws.images[e.imageId] } : e));
  for (const [uid, o] of Object.entries(S.ws.ocr)) if (o.embed) edits.push({ pageUid: uid, type: 'ocr', words: o.words });
  return {
    pages: S.ws.pages.map(({ uid, src, index, rotate, blank }) => (blank ? { uid, blank } : { uid, src, index, rotate })),
    edits,
    formValues: S.ws.formValues,
    folio: folio && S.ws.folio.enabled ? S.ws.folio : null,
  };
}
const sourcesFor = (pages) => [...new Set(pages.filter((p) => !p.blank).map((p) => p.src))].map((id) => [id, S.files.get(id).bytes]);

async function runExport(state = exportState()) {
  return jobs.run('export', { sources: sourcesFor(state.pages), state, flattenForms: S.ws.flatten }, { onProgress: progress });
}

function baseName() {
  const first = S.ws.pages.find((p) => !p.blank);
  const name = first ? S.files.get(first.src).name.replace(/\.pdf$/i, '') : 'documento';
  return name.slice(0, 80);
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function doExport() {
  if (!S.ws.pages.length || S.busy) return;
  const folioErr = folioError();
  if (folioErr) { switchMode('folio'); setStatus(folioErr, 'error'); return; }
  busy(true, 'Generando y verificando el PDF…');
  try {
    const { bytes } = await runExport();
    const suffix = S.ws.folio.enabled ? '-foliado' : '-editado';
    download(bytes, `${baseName()}${suffix}.pdf`);
    setStatus(`Exportado y verificado: ${S.ws.pages.length} página(s), ${store.formatBytes(bytes.byteLength)}. Los originales no se modificaron.`, 'ok');
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'Exportación cancelada.' : `No se pudo exportar: ${err.message}`, 'error');
  } finally {
    busy(false);
  }
}

async function extractSelection() {
  const idx = selectedIndexes();
  if (!idx.length) return;
  busy(true, 'Extrayendo páginas…');
  try {
    const { bytes } = await runExport();
    const out = await jobs.run('pages', { sources: [['r', bytes]], pages: idx.map((i) => ({ src: 'r', index: i })) });
    download(out.bytes, `${baseName()}-extracto.pdf`);
    setStatus(`Extracto descargado: ${idx.length} página(s), con ediciones y foliación incluidas.`, 'ok');
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'Operación cancelada.' : err.message, 'error');
  } finally { busy(false); }
}

async function splitDoc() {
  const input = $('#split-ranges');
  let groups;
  try {
    groups = parseSplit(input.value, S.ws.pages.length);
    input.closest('.field').classList.remove('invalid');
  } catch (err) {
    input.closest('.field').classList.add('invalid');
    setStatus(err.message, 'error');
    return;
  }
  busy(true, 'Separando…');
  try {
    const { bytes } = await runExport();
    for (const [k, g] of groups.entries()) {
      const pages = [];
      for (let i = g.from; i <= g.to; i++) pages.push({ src: 'r', index: i });
      const out = await jobs.run('pages', { sources: [['r', bytes]], pages });
      download(out.bytes, `${baseName()}-${g.label}.pdf`);
      progress((k + 1) / groups.length);
    }
    setStatus(`${groups.length} archivo(s) descargados.`, 'ok');
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'Operación cancelada.' : err.message, 'error');
  } finally { busy(false); }
}

function parseSplit(text, n) {
  const groups = [];
  for (const raw of String(text).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(raw);
    if (!m) throw new Error(`Rango no válido: «${raw}». Usa 1-3, 4-10.`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > n) throw new Error(`Rango fuera del documento (1–${n}): «${raw}».`);
    groups.push({ label: a === b ? `p${a}` : `p${a}-${b}`, from: a - 1, to: b - 1 });
  }
  if (!groups.length) throw new Error('Escribe al menos un rango, por ejemplo 1-3, 4-10.');
  return groups;
}

// ---------------------------------------------------------------- Editar
const editPage = () => S.ws.pages[S.editIndex];
let viewGeom = null; // { ptWidth, ptHeight, cssWidth, cssHeight }
let editToken = 0;

let stripKey = '';
let viewKey = '';
async function renderEdit() {
  const strip = $('#edit-strip');
  const n = S.ws.pages.length;
  S.editIndex = clamp(S.editIndex, 0, Math.max(0, n - 1));
  $('#edit-pos').textContent = n ? `${S.editIndex + 1} / ${n}` : '–';
  $('#btn-prev').disabled = S.editIndex <= 0;
  $('#btn-next').disabled = S.editIndex >= n - 1;
  // Tira de miniaturas (solo se reconstruye si cambian las páginas).
  const sk = S.ws.pages.map((p) => `${p.uid}:${p.rotate || 0}`).join(',');
  if (sk !== stripKey) { stripKey = sk; buildStrip(strip); }
  $$('.tile', strip).forEach((t, i) => t.setAttribute('aria-selected', i === S.editIndex ? 'true' : 'false'));
  strip.children[S.editIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const p = editPage();
  if (!p) { $('#cv-main').width = 0; $('#overlay').replaceChildren(); $('#props').hidden = true; $('#col-original').hidden = true; viewKey = ''; return; }
  const compare = $('#chk-compare').checked;
  const zoom = $('#edit-zoom').value;
  const wrap = $('#viewer-wrap');
  const vk = `${p.uid}|${p.rotate || 0}|${zoom}|${compare}|${wrap.clientWidth}|${compare ? snapshot() : ''}`;
  if (vk !== viewKey) {
    viewKey = vk;
    await paintEditPage(p, compare, zoom, wrap);
    if (editPage() !== p) return;
    renderPageKind(p);
    renderFormBox(p);
  }
  renderOverlay();
  renderProps();
  renderOcrBox();
}

function buildStrip(strip) {
  strip.replaceChildren(...S.ws.pages.map((p, i) => {
    const t = document.createElement('button');
    t.className = 'tile';
    t.type = 'button';
    t.setAttribute('aria-label', `Ir a la página ${i + 1}`);
    t.setAttribute('aria-selected', i === S.editIndex ? 'true' : 'false');
    t.innerHTML = `<div class="thumb"><div class="loading"></div></div><div class="tile-cap"><span class="n">${i + 1}</span></div>`;
    t.addEventListener('click', () => { S.editIndex = i; S.selObj = null; S.inkObj = null; renderEdit(); });
    if (!p.blank) render.thumbnail(p.src, p.index, 80, p.rotate || 0).then((bmp) => {
      const cv = document.createElement('canvas'); render.paintBitmap(cv, bmp); $('.thumb', t).replaceChildren(cv);
    }).catch(() => {});
    else $('.thumb', t).innerHTML = '<div class="blank"></div>';
    return t;
  }));
}

// Pinta la página actual. Siempre renderiza en un canvas nuevo y luego lo copia al visible,
// para que dos renderizados seguidos nunca compitan por el mismo canvas.
async function paintEditPage(p, compare, zoom, wrap) {
  const token = ++editToken;
  $('#col-original').hidden = !compare;
  $('#col-main-title').hidden = !compare;
  $('#overlay').hidden = compare;
  const avail = (compare ? wrap.clientWidth / 2 : wrap.clientWidth) - 48;
  const scale = zoom === 'fit' ? undefined : Number(zoom);
  try {
    if (compare) {
      busy(true, 'Generando el resultado para comparar…');
      const { bytes } = await runExport();
      const key = `cmp-${token}`;
      await render.openDoc(key, bytes);
      const o = await render.renderPage(key, S.editIndex, { width: zoom === 'fit' ? avail : undefined, scale });
      render.closeDoc(key);
      if (token !== editToken) return;
      copyCanvas(o.canvas, $('#cv-main'));
      if (!p.blank) copyCanvas((await render.renderPage(p.src, p.index, { width: o.cssWidth })).canvas, $('#cv-original'));
      else blankCanvas($('#cv-original'), o.cssWidth, o.cssHeight);
      setStatus('Comparación: a la izquierda la página original, a la derecha el PDF tal como se exportará.');
    } else if (p.blank) {
      const w = zoom === 'fit' ? Math.min(avail, 900) : p.blank.width * Number(zoom);
      const h = w * (p.blank.height / p.blank.width);
      blankCanvas($('#cv-main'), w, h);
      viewGeom = { ptWidth: p.blank.width, ptHeight: p.blank.height, cssWidth: w, cssHeight: h };
    } else {
      const o = await render.renderPage(p.src, p.index, { width: zoom === 'fit' ? Math.min(avail, 1100) : undefined, scale, extraRotation: p.rotate || 0 });
      if (token !== editToken) return;
      copyCanvas(o.canvas, $('#cv-main'));
      viewGeom = o;
    }
  } catch (err) {
    if (err.name !== 'AbortError') setStatus(`No se pudo mostrar la página: ${err.message}`, 'error');
  } finally {
    if (compare) busy(false);
  }
}

function copyCanvas(from, to) {
  to.width = from.width; to.height = from.height;
  to.style.width = from.style.width; to.style.height = from.style.height;
  to.getContext('2d').drawImage(from, 0, 0);
}

function blankCanvas(cv, w, h) {
  const dpr = globalThis.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = `${Math.round(w)}px`; cv.style.height = `${Math.round(h)}px`;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height);
}

const PREVIEW_FONTS = { Helvetica: 'Arial, Helvetica, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
const previewFont = (name) => PREVIEW_FONTS[name.split('-')[0]] || PREVIEW_FONTS.Helvetica;

function renderOverlay() {
  const ov = $('#overlay');
  const p = editPage();
  ov.dataset.tool = S.tool;
  if (!p || !viewGeom) { ov.replaceChildren(); return; }
  const scale = viewGeom.cssWidth / viewGeom.ptWidth;
  const objs = S.ws.edits.filter((e) => e.pageUid === p.uid);
  const els = objs.map((o) => {
    const el = document.createElement('div');
    el.className = `obj ${o.type}${S.selObj === o.id ? ' selected' : ''}`;
    el.dataset.id = o.id;
    el.style.left = `${o.x * 100}%`;
    el.style.top = `${o.y * 100}%`;
    if (o.type === 'text') {
      el.textContent = o.text;
      el.style.fontFamily = previewFont(o.font);
      el.style.fontWeight = /Bold/.test(o.font) ? '700' : '400';
      el.style.fontSize = `${o.size * scale}px`;
      el.style.color = o.color;
    } else {
      el.style.width = `${o.w * 100}%`;
      el.style.height = `${o.h * 100}%`;
    }
    if (o.type === 'rect') { el.style.background = o.fill; el.style.opacity = String(o.opacity ?? 0.35); }
    if (o.type === 'cover') el.style.background = o.fill;
    if (o.type === 'image') {
      const img = document.createElement('img');
      img.alt = '';
      img.src = imageUrl(o.imageId);
      el.append(img);
    }
    if (o.type === 'ink') {
      const pts = o.strokes.map((s) => `<polyline points="${s.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${o.color}" stroke-width="${(o.width || 1.6) * scale}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('');
      el.innerHTML = `<svg viewBox="${o.x} ${o.y} ${Math.max(o.w, 1e-4)} ${Math.max(o.h, 1e-4)}" preserveAspectRatio="none" aria-hidden="true">${pts}</svg>`;
    }
    if (['rect', 'cover', 'image'].includes(o.type)) {
      const h = document.createElement('span');
      h.className = 'handle';
      el.append(h);
    }
    return el;
  });
  // Resaltado de búsqueda OCR
  const ocr = S.ws.ocr[p.uid];
  const q = normalize($('#ocr-search').value);
  if (ocr && q) {
    for (const w of ocr.words) {
      if (!normalize(w.text).includes(q)) continue;
      const hit = document.createElement('div');
      hit.className = 'ocr-hit';
      Object.assign(hit.style, { left: `${w.x * 100}%`, top: `${w.y * 100}%`, width: `${w.w * 100}%`, height: `${w.h * 100}%` });
      els.push(hit);
    }
  }
  ov.replaceChildren(...els);
}

const imageUrls = new Map();
function imageUrl(id) {
  if (!imageUrls.has(id)) {
    const bytes = S.ws.images[id];
    const type = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
    imageUrls.set(id, URL.createObjectURL(new Blob([bytes], { type })));
  }
  return imageUrls.get(id);
}
const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function setTool(tool) {
  S.tool = tool;
  if (tool !== 'ink') S.inkObj = null;
  $$('.tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false'));
  const hints = {
    select: 'Haz clic en un objeto para moverlo o cambiar sus propiedades. Supr lo elimina.',
    text: 'Haz clic en la página donde quieras escribir.',
    rect: 'Arrastra para resaltar una zona (color semitransparente).',
    cover: 'Arrastra para tapar una zona con un rectángulo opaco. Ojo: tapa visualmente, pero el contenido original sigue dentro del PDF; no es una censura segura.',
    image: 'Haz clic donde irá la imagen (PNG o JPG), por ejemplo un sello o una firma escaneada.',
    ink: 'Dibuja tu firma o una marca a mano alzada. Cada trazo se suma a la misma firma hasta que cambies de herramienta.',
  };
  $('#tool-hint').textContent = hints[tool];
  $('#overlay').dataset.tool = tool;
}

function objById(id) { return S.ws.edits.find((e) => e.id === id); }

function setupOverlay() {
  const ov = $('#overlay');
  let drag = null;
  const norm = (e) => {
    const r = ov.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  };
  ov.addEventListener('pointerdown', (e) => {
    const p = editPage();
    const box = ov.getBoundingClientRect();
    if (!p || e.button !== 0 || !viewGeom || box.width < 2 || box.height < 2) return;
    const [x, y] = norm(e);
    const objEl = e.target.closest('.obj');
    ov.setPointerCapture(e.pointerId);
    if (S.tool === 'select') {
      if (!objEl) { S.selObj = null; renderOverlay(); renderProps(); return; }
      const o = objById(objEl.dataset.id);
      S.selObj = o.id;
      drag = { mode: e.target.classList.contains('handle') ? 'resize' : 'move', o, x0: x, y0: y, start: JSON.stringify(o) };
      renderOverlay(); renderProps();
      return;
    }
    if (S.tool === 'text') {
      const o = { id: store.newId(), pageUid: p.uid, type: 'text', x, y, text: 'Texto', font: 'Helvetica', size: 12, color: '#000000' };
      S.ws.edits.push(o);
      S.selObj = o.id;
      setTool('select');
      commit();
      const ta = $('#prop-text');
      ta.focus();
      ta.select();
      return;
    }
    if (S.tool === 'image') { pendingImageAt = [x, y]; $('#image-input').click(); return; }
    if (S.tool === 'rect' || S.tool === 'cover') {
      const o = { id: store.newId(), pageUid: p.uid, type: S.tool, x, y, w: 0, h: 0, fill: S.tool === 'cover' ? '#FFFFFF' : '#FFE066', opacity: 0.35 };
      if (S.tool === 'cover') o.stroke = null;
      S.ws.edits.push(o);
      S.selObj = o.id;
      drag = { mode: 'create', o, x0: x, y0: y };
      return;
    }
    if (S.tool === 'ink') {
      if (!S.inkObj || S.inkObj.pageUid !== p.uid || !objById(S.inkObj.id)) {
        S.inkObj = { id: store.newId(), pageUid: p.uid, type: 'ink', strokes: [], color: '#0B2E6B', width: 1.6, x, y, w: 0, h: 0 };
        S.ws.edits.push(S.inkObj);
      }
      S.inkObj.strokes.push([[x, y]]);
      S.selObj = S.inkObj.id;
      drag = { mode: 'ink', o: S.inkObj };
    }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = norm(e);
    const o = drag.o;
    if (drag.mode === 'move') {
      const dx = x - drag.x0; const dy = y - drag.y0;
      const s = JSON.parse(drag.start);
      o.x = clamp(s.x + dx, 0, 1 - (o.w || 0));
      o.y = clamp(s.y + dy, 0, 1 - (o.h || 0));
      if (o.type === 'ink') {
        const mx = o.x - s.x; const my = o.y - s.y;
        o.strokes = s.strokes.map((st) => st.map(([a, b]) => [a + mx, b + my]));
      }
    } else if (drag.mode === 'resize') {
      const s = JSON.parse(drag.start);
      o.w = clamp(s.w + (x - drag.x0), 0.01, 1 - o.x);
      o.h = clamp(s.h + (y - drag.y0), 0.005, 1 - o.y);
    } else if (drag.mode === 'create') {
      o.x = Math.min(x, drag.x0); o.y = Math.min(y, drag.y0);
      o.w = Math.abs(x - drag.x0); o.h = Math.abs(y - drag.y0);
    } else if (drag.mode === 'ink') {
      o.strokes[o.strokes.length - 1].push([x, y]);
      inkBounds(o);
    }
    renderOverlay();
  });
  const end = () => {
    if (!drag) return;
    const o = drag.o;
    if (drag.mode === 'create' && (o.w < 0.01 || o.h < 0.005)) {
      o.w = 0.25; o.h = 0.04;
      o.x = clamp(o.x, 0, 1 - o.w); o.y = clamp(o.y, 0, 1 - o.h);
    }
    if (drag.mode === 'ink' && o.strokes[o.strokes.length - 1].length < 2) o.strokes.pop();
    if (drag.mode === 'ink' && !o.strokes.length) S.ws.edits = S.ws.edits.filter((e) => e !== o);
    drag = null;
    commit();
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);
}

function inkBounds(o) {
  const pts = o.strokes.flat();
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  o.x = Math.min(...xs); o.y = Math.min(...ys);
  o.w = Math.max(...xs) - o.x; o.h = Math.max(...ys) - o.y;
}

let pendingImageAt = null;
async function placeImage(file) {
  const p = editPage();
  if (!file || !p || !pendingImageAt) return;
  let bytes = new Uint8Array(await file.arrayBuffer());
  const bmp = await createImageBitmap(new Blob([bytes]));
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  if (!isPng && !isJpg) {
    // Otros formatos (WebP, GIF…) se convierten a PNG sin pérdida.
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext('2d').drawImage(bmp, 0, 0);
    bytes = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }
  const id = store.newId();
  S.ws.images[id] = bytes;
  const w = 0.25;
  const h = w * (bmp.height / bmp.width) * (viewGeom.ptWidth / viewGeom.ptHeight);
  const [x, y] = pendingImageAt;
  const o = { id: store.newId(), pageUid: p.uid, type: 'image', imageId: id, x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - Math.min(h, 1)), w, h: Math.min(h, 1) };
  S.ws.edits.push(o);
  S.selObj = o.id;
  pendingImageAt = null;
  setTool('select');
  commit();
}

function renderProps() {
  const o = S.selObj && objById(S.selObj);
  $('#props').hidden = !o;
  if (!o) return;
  const isText = o.type === 'text';
  $('#prop-text-wrap').hidden = !isText;
  $('#prop-font-wrap').hidden = !isText;
  $('#prop-color-wrap').hidden = o.type === 'image';
  if (isText) {
    if (document.activeElement !== $('#prop-text')) $('#prop-text').value = o.text;
    $('#prop-font').value = o.font;
    $('#prop-size').value = o.size;
  }
  $('#prop-color').value = o.type === 'text' || o.type === 'ink' ? o.color : o.fill || '#FFFFFF';
}

function setupProps() {
  const live = (fn) => () => { const o = objById(S.selObj); if (!o) return; fn(o); renderOverlay(); };
  $('#prop-text').addEventListener('input', live((o) => { o.text = $('#prop-text').value; }));
  $('#prop-font').addEventListener('change', live((o) => { o.font = $('#prop-font').value; }));
  $('#prop-size').addEventListener('input', live((o) => { const v = Number($('#prop-size').value); if (v >= 4 && v <= 96) o.size = v; }));
  $('#prop-color').addEventListener('input', live((o) => {
    const v = $('#prop-color').value;
    if (o.type === 'text' || o.type === 'ink') o.color = v; else o.fill = v;
  }));
  for (const id of ['#prop-text', '#prop-font', '#prop-size', '#prop-color']) $(id).addEventListener('change', commit);
  $('#btn-del-obj').addEventListener('click', deleteObj);
}

function deleteObj() {
  if (!S.selObj) return;
  S.ws.edits = S.ws.edits.filter((e) => e.id !== S.selObj);
  S.selObj = null;
  S.inkObj = null;
  commit();
}

async function renderPageKind(p) {
  const box = $('#page-kind');
  box.className = 'notice';
  if (p.blank) { box.textContent = 'Página en blanco insertada: puedes escribir, dibujar o añadir imágenes.'; return; }
  box.textContent = 'Analizando…';
  try {
    const t = await render.pageText(p.src, p.index);
    const img = t.chars < 8 ? await render.pageHasImage(p.src, p.index) : false;
    if (editPage() !== p) return;
    if (looksScanned(t.chars, img)) {
      box.className = 'notice warn';
      box.innerHTML = '<b>Escaneada.</b> Es una imagen sin texto. Puedes añadir texto, firmas, sellos y marcas sin alterar la imagen. Usa OCR para hacerla buscable.';
    } else if (t.chars === 0) {
      box.innerHTML = '<b>Sin texto.</b> No tiene texto extraíble.';
    } else if (t.chars < 8) {
      box.className = 'notice info';
      box.innerHTML = `<b>Digital, con poco texto</b> (${t.chars} caracteres). Lo que añadas se dibuja encima del contenido.`;
    } else {
      box.className = 'notice info';
      box.innerHTML = `<b>Digital.</b> Tiene texto seleccionable (${t.chars} caracteres). Lo que añadas se dibuja encima; el texto existente no se reescribe para no romper fuentes ni maquetación.`;
    }
  } catch { box.textContent = 'No se pudo analizar la página.'; }
}

function renderOcrBox() {
  const p = editPage();
  const ocr = p && S.ws.ocr[p.uid];
  $('#btn-ocr').disabled = !p || p.blank || S.busy;
  $('#ocr-box').hidden = !ocr;
  if (!ocr) return;
  $('#ocr-text').textContent = ocr.text.trim() || '(No se reconoció texto)';
  $('#ocr-embed').checked = Boolean(ocr.embed);
  $('#btn-ocr').textContent = `Reconocido (confianza media ${ocr.confidence} %) · Repetir`;
}

async function runOcr() {
  const p = editPage();
  if (!p || p.blank) return;
  busy(true, 'Preparando OCR (la primera vez tarda unos segundos)…');
  try {
    const { canvas } = await render.renderPage(p.src, p.index, { scale: 2.5 / (globalThis.devicePixelRatio || 1), extraRotation: p.rotate || 0 });
    setStatus('Reconociendo texto…');
    const res = await recognize(canvas, progress);
    S.ws.ocr[p.uid] = { ...res, embed: S.ws.ocr[p.uid]?.embed || false };
    setStatus(`OCR terminado: ${res.words.length} palabras, confianza media ${res.confidence} %. Revisa el texto: el OCR puede equivocarse.`, 'ok');
    store.saveWorkspace({ ws: S.ws, order: S.order }).catch(() => {});
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'OCR cancelado.' : `OCR no disponible: ${err.message}`, 'error');
  } finally {
    busy(false);
    renderOcrBox();
    renderOverlay();
  }
}

function renderFormBox(p) {
  const f = !p.blank && S.files.get(p.src);
  const fields = (f && f.fields) || [];
  $('#form-box').hidden = !fields.length;
  if (!fields.length) return;
  const vals = S.ws.formValues[p.src] || {};
  const wrap = $('#form-fields');
  wrap.replaceChildren(...fields.filter((x) => x.kind !== 'other').map((fd) => {
    const value = fd.name in vals ? vals[fd.name] : fd.value;
    const label = document.createElement('label');
    if (fd.kind === 'checkbox') {
      label.className = 'check';
      label.innerHTML = `<input type="checkbox" ${value ? 'checked' : ''} ${fd.readOnly ? 'disabled' : ''}> ${esc(fd.name)}`;
    } else if (fd.kind === 'choice') {
      label.className = 'field';
      label.innerHTML = `<span>${esc(fd.name)}</span><select ${fd.readOnly ? 'disabled' : ''}><option value=""></option>${fd.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else {
      label.className = 'field';
      label.innerHTML = `<span>${esc(fd.name)}</span><input type="text" value="${esc(value)}" ${fd.readOnly ? 'disabled' : ''}>`;
    }
    const ctl = $('input, select', label);
    ctl.addEventListener('change', () => {
      S.ws.formValues[p.src] = { ...(S.ws.formValues[p.src] || {}), [fd.name]: ctl.type === 'checkbox' ? ctl.checked : ctl.value };
      commit();
    });
    return label;
  }));
  $('#form-flatten').checked = S.ws.flatten;
}

// ---------------------------------------------------------------- Foliar
const FIELD_MAP = {
  '#f-format': 'format', '#f-prefix': 'prefix', '#f-suffix': 'suffix', '#f-padding': 'padding', '#f-start': 'start',
  '#f-mx': 'marginXmm', '#f-my': 'marginYmm', '#f-font': 'font', '#f-size': 'size', '#f-color': 'color',
  '#f-exclude': 'exclude', '#f-resets': 'resets',
};
const CHECK_MAP = { '#f-enabled': 'enabled', '#f-bg': 'background', '#f-consume': 'excludedConsume', '#f-continuous': 'continuous' };
const NUMERIC = new Set(['padding', 'start', 'marginXmm', 'marginYmm', 'size']);

function syncFolioForm() {
  const f = S.ws.folio;
  for (const [sel, key] of Object.entries(FIELD_MAP)) if (document.activeElement !== $(sel)) $(sel).value = f[key];
  for (const [sel, key] of Object.entries(CHECK_MAP)) $(sel).checked = Boolean(f[key]);
  $$('#pos-grid [data-pos]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pos === f.position ? 'true' : 'false'));
  const err = folioError();
  const sample = $('#f-sample');
  if (err) { sample.textContent = ''; } else {
    const labels = computeLabels(Math.max(1, S.ws.pages.length), f, { docStarts: docStarts(S.ws.pages) }).filter(Boolean);
    sample.textContent = labels.length ? `Ejemplo: ${labels.slice(0, 3).join(' · ')}${labels.length > 3 ? ` … ${labels[labels.length - 1]}` : ''}` : 'Todas las páginas quedarían excluidas.';
  }
  renderFolioWarnings(err);
}

function folioError() {
  try {
    computeLabels(Math.max(1, S.ws.pages.length), S.ws.folio, { docStarts: docStarts(S.ws.pages) });
    const sz = Number(S.ws.folio.size);
    if (!(sz >= 4 && sz <= 72)) return 'El tamaño del folio debe estar entre 4 y 72 pt.';
    return null;
  } catch (err) { return err.message; }
}

let folioDetect = null;
function renderFolioWarnings(err) {
  const box = $('#folio-warn');
  const parts = [];
  if (err) parts.push(`<div class="notice danger">${esc(err)}</div>`);
  if (folioDetect && folioDetect.likely) {
    parts.push(`<div class="notice warn"><b>Parece que el documento ya tiene foliación</b> (${Math.round(folioDetect.ratio * 100)} % de las páginas con texto).<ul>${folioDetect.hits.slice(0, 4).map((h) => `<li>Pág. ${h.page}: «${esc(h.text)}»</li>`).join('')}</ul>Revisa la vista previa para no superponer números.</div>`);
  }
  if (folioDetect && folioDetect.pagesWithoutText) {
    parts.push(`<div class="notice">${folioDetect.pagesWithoutText} página(s) sin texto (escaneos o en blanco): no se puede comprobar automáticamente si ya están foliadas.</div>`);
  }
  if (!S.ws.folio.enabled) parts.push('<div class="notice info">La foliación está desactivada: actívala para incluirla al exportar.</div>');
  box.innerHTML = parts.join('');
}

let detectToken = 0;
async function refreshFolioWarnings() {
  const token = ++detectToken;
  const sample = S.ws.pages.slice(0, 120);
  const texts = [];
  for (const p of sample) {
    if (p.blank) { texts.push({ width: 1, height: 1, items: [] }); continue; }
    try { texts.push(await render.pageText(p.src, p.index)); } catch { texts.push(null); }
    if (token !== detectToken) return;
  }
  folioDetect = sample.length ? detectExistingFolio(texts) : null;
  if (S.mode === 'folio') renderFolioWarnings(folioError());
}

let folioTimer;
function scheduleFolioPreview(now = false) {
  clearTimeout(folioTimer);
  if (!S.ws.pages.length) { $('#folio-grid').replaceChildren(); return; }
  if (!now && S.ws.pages.length > 300) { $('#folio-info').textContent = 'Documento grande: pulsa «Actualizar vista previa».'; return; }
  folioTimer = setTimeout(folioPreview, now ? 0 : 650);
}

let previewSeq = 0;
async function folioPreview() {
  if (folioError()) return;
  const seq = ++previewSeq;
  const state = exportState({ folio: false });
  state.folio = { ...S.ws.folio, enabled: true };
  $('#folio-info').textContent = 'Generando vista previa…';
  let res;
  try {
    res = await jobs.run('export', { sources: sourcesFor(state.pages), state, flattenForms: S.ws.flatten });
  } catch (err) {
    if (seq === previewSeq) $('#folio-info').textContent = err.name === 'AbortError' ? 'Vista previa cancelada.' : `Error: ${err.message}`;
    return;
  }
  if (seq !== previewSeq) return;
  const old = S.previewKey;
  S.previewKey = `preview-${seq}`;
  S.previewLabels = res.labels;
  await render.openDoc(S.previewKey, res.bytes);
  if (old) render.closeDoc(old);
  const numbered = res.labels.filter(Boolean).length;
  $('#folio-info').textContent = `Vista previa real del PDF foliado: ${numbered} de ${res.labels.length} páginas numeradas${S.ws.folio.enabled ? '' : ' (desactivado al exportar)'}.`;
  const grid = $('#folio-grid');
  const key = S.previewKey;
  const pio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      pio.unobserve(e.target);
      const i = Number(e.target.dataset.i);
      render.thumbnail(key, i, Math.round(thumbWidth() * 1.6)).then((bmp) => {
        if (S.previewKey !== key) return;
        const cv = document.createElement('canvas');
        render.paintBitmap(cv, bmp);
        $('.thumb', e.target).replaceChildren(cv);
      }).catch(() => {});
    }
  }, { root: $('#stage'), rootMargin: '400px' });
  grid.style.setProperty('--thumb-w', `${Math.round(thumbWidth() * 1.6) + 12}px`);
  grid.replaceChildren(...res.labels.map((label, i) => {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.i = i;
    t.innerHTML = `<div class="thumb"><div class="loading"></div></div><div class="tile-cap"><span class="n">${i + 1}</span><span class="src">${label ? esc(label) : '— sin folio'}</span></div>`;
    pio.observe(t);
    return t;
  }));
}

function setupFolio() {
  $('#f-format').innerHTML = Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  for (const [sel, key] of Object.entries(FIELD_MAP)) {
    $(sel).addEventListener('input', () => {
      const raw = $(sel).value;
      S.ws.folio[key] = NUMERIC.has(key) ? (raw === '' ? 0 : Number(raw)) : raw;
      syncFolioForm();
      scheduleFolioPreview();
    });
    $(sel).addEventListener('change', commit);
  }
  for (const [sel, key] of Object.entries(CHECK_MAP)) {
    $(sel).addEventListener('change', () => { S.ws.folio[key] = $(sel).checked; commit(); });
  }
  $('#pos-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pos]');
    if (!b) return;
    S.ws.folio.position = b.dataset.pos;
    commit();
  });
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    Object.assign(S.ws.folio, PRESETS[b.dataset.preset], { enabled: true });
    commit();
    setStatus(`Plantilla «${b.textContent}» aplicada. Ajusta prefijo o número inicial si lo necesitas.`);
  });
  $('#btn-folio-refresh').addEventListener('click', () => scheduleFolioPreview(true));
}

// ---------------------------------------------------------------- modos
function switchMode(mode) {
  S.mode = mode;
  for (const m of ['organize', 'edit', 'folio']) {
    $(`#view-${m}`).hidden = m !== mode;
    $(`#panel-${m}`).hidden = m !== mode;
    $(`#tab-${m}`).setAttribute('aria-selected', m === mode ? 'true' : 'false');
  }
  if (mode === 'edit') {
    const first = S.ws.pages.findIndex((p) => S.sel.has(p.uid));
    if (first >= 0) S.editIndex = first;
    S.ws.pages.slice(0, 50).forEach((p) => primeSize(p).catch(() => {}));
  }
  if (mode === 'folio') refreshFolioWarnings();
  window.history.replaceState(null, '', `#mode=${mode}`);
  renderAll();
}

// ---------------------------------------------------------------- diálogo
function confirmDlg(title, body) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-body').textContent = body;
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

// ---------------------------------------------------------------- teclado
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doExport(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#file-input').click(); return; }
    if (typing(e)) return;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
    if (S.mode === 'organize') {
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.ws.pages.map((p) => p.uid)); renderGrid(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); act('duplicate'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { act('delete'); return; }
      if (e.key.toLowerCase() === 'r' && !mod) { act(e.shiftKey ? 'rotate-left' : 'rotate-right'); return; }
      if (e.key === 'Escape') { S.sel.clear(); renderGrid(); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && S.ws.pages.length) {
        e.preventDefault();
        const idx = S.ws.pages.findIndex((p) => p.uid === S.focusUid);
        if (e.altKey && S.sel.size) {
          const sel = selectedIndexes();
          if (e.key === 'ArrowLeft' && sel[0] > 0) { moveSelectedTo(sel[0] - 1); commit(); }
          if (e.key === 'ArrowRight' && sel[sel.length - 1] < S.ws.pages.length - 1) { moveSelectedTo(sel[sel.length - 1] + 2); commit(); }
          return;
        }
        const cols = Math.max(1, Math.round($('#page-grid').clientWidth / (tiles.values().next().value?.offsetWidth + 12 || 140)));
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key] || 0;
        let next = e.key === 'Home' ? 0 : e.key === 'End' ? S.ws.pages.length - 1 : clamp((idx < 0 ? 0 : idx + step), 0, S.ws.pages.length - 1);
        const uid = S.ws.pages[next].uid;
        clickTile(uid, { shiftKey: e.shiftKey, ctrlKey: false });
        tiles.get(uid)?.focus();
      }
      if (e.key === ' ' && S.focusUid) { e.preventDefault(); clickTile(S.focusUid, { ctrlKey: true }); }
    }
    if (S.mode === 'edit') {
      const tools = { v: 'select', t: 'text', h: 'rect', w: 'cover', i: 'image', f: 'ink' };
      if (!mod && tools[e.key.toLowerCase()]) { setTool(tools[e.key.toLowerCase()]); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.selObj) { deleteObj(); return; }
      if (e.key === 'Escape') { S.selObj = null; setTool('select'); renderOverlay(); renderProps(); return; }
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !S.selObj)) { S.editIndex++; S.selObj = null; renderEdit(); return; }
      if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !S.selObj)) { S.editIndex--; S.selObj = null; renderEdit(); return; }
      if (S.selObj && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const o = objById(S.selObj);
        const d = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        o.x = clamp(o.x + dx, 0, 1); o.y = clamp(o.y + dy, 0, 1);
        if (o.type === 'ink') o.strokes = o.strokes.map((s) => s.map(([a, b]) => [a + dx, b + dy]));
        commit();
      }
    }
  });
}

// ---------------------------------------------------------------- arranque
function wire() {
  const openPicker = () => $('#file-input').click();
  $('#btn-open').addEventListener('click', openPicker);
  $('#btn-open-2').addEventListener('click', openPicker);
  $('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $$('[role="tab"]').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-export').addEventListener('click', doExport);
  $('#btn-cancel').addEventListener('click', () => { jobs.cancelAll(); terminateOcr(); busy(false); setStatus('Operación cancelada. No se generó ningún archivo.'); });
  $('#btn-clear').addEventListener('click', clearLibrary);
  $('#btn-select-all').addEventListener('click', () => { S.sel = new Set(S.ws.pages.map((p) => p.uid)); renderGrid(); });
  $('#zoom').addEventListener('input', renderGrid);
  $('#page-grid').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) clickTile(t.dataset.uid, e); });
  $('#page-grid').addEventListener('dblclick', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    S.editIndex = S.ws.pages.findIndex((p) => p.uid === t.dataset.uid);
    switchMode('edit');
  });
  $('#panel-organize').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  $('#btn-split').addEventListener('click', splitDoc);
  $('#file-list').addEventListener('click', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    const id = row.dataset.id;
    const b = e.target.closest('[data-act]');
    if (b && b.dataset.act === 'remove') { removeFile(id); return; }
    if (b && b.dataset.act === 'readd') { insertPages(pagesOf(S.files.get(id))); commit(); return; }
    S.sel = new Set(S.ws.pages.filter((p) => p.src === id).map((p) => p.uid));
    if (S.mode !== 'organize') switchMode('organize'); else renderGrid();
  });
  $('#file-list').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('file-row')) e.target.click(); });
  // Editar
  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#image-input').addEventListener('change', (e) => { placeImage(e.target.files[0]).catch((err) => setStatus(`Imagen no válida: ${err.message}`, 'error')); e.target.value = ''; });
  $('#btn-prev').addEventListener('click', () => { S.editIndex--; S.selObj = null; renderEdit(); });
  $('#btn-next').addEventListener('click', () => { S.editIndex++; S.selObj = null; renderEdit(); });
  $('#chk-compare').addEventListener('change', renderEdit);
  $('#edit-zoom').addEventListener('change', renderEdit);
  $('#btn-ocr').addEventListener('click', runOcr);
  $('#ocr-search').addEventListener('input', renderOverlay);
  $('#ocr-embed').addEventListener('change', () => { const o = S.ws.ocr[editPage().uid]; if (o) { o.embed = $('#ocr-embed').checked; commit(); } });
  $('#form-flatten').addEventListener('change', () => { S.ws.flatten = $('#form-flatten').checked; commit(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.mode === 'edit') renderEdit(); }, 200); });
  setupDnD();
  setupOverlay();
  setupProps();
  setupFolio();
  setupKeys();
  if (store.channel) store.channel.onmessage = async ({ data }) => {
    if (data && data.type === 'ping') store.channel.postMessage({ type: 'pong' });
    if (data && data.type === 'focus') {
      if (data.mode) switchMode(data.mode);
      globalThis.chrome?.tabs?.getCurrent((t) => {
        if (!t) return;
        chrome.tabs.update(t.id, { active: true });
        chrome.windows.update(t.windowId, { focused: true });
      });
    }
    if (data && data.type === 'files-added') {
      const n = await absorbPending();
      if (n) { if (data.mode && data.mode !== S.mode) switchMode(data.mode); setStatus(`${n} documento(s) recibidos desde el panel lateral.`, 'ok'); }
    }
  };
}

async function boot() {
  wire();
  try {
    const [files, saved] = await Promise.all([store.getFiles(), store.loadWorkspace()]);
    const known = files.filter((f) => !f.pendingAdd);
    for (const f of known) await registerFile(f);
    if (saved && saved.ws) {
      S.ws = { ...emptyWorkspace(), ...saved.ws, folio: { ...DEFAULT_FOLIO, enabled: false, ...saved.ws.folio } };
      S.order = (saved.order || []).filter((id) => S.files.has(id));
      for (const id of S.files.keys()) if (!S.order.includes(id)) S.order.push(id);
      S.ws.pages = S.ws.pages.filter((p) => p.blank || S.files.has(p.src));
    }
    resetHistory();
    const added = await absorbPending();
    if (known.length) setStatus(`Sesión recuperada: ${known.length} documento(s), ${S.ws.pages.length} página(s).`);
    else if (added) setStatus(`${added} documento(s) recibidos desde el panel lateral.`, 'ok');
  } catch (err) {
    setStatus(`No se pudo recuperar la sesión anterior: ${err.message}`, 'error');
  }
  const m = /mode=(organize|edit|folio)/.exec(location.hash);
  switchMode(m ? m[1] : 'organize');
  afterChange();
}

boot();
