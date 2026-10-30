// Centro de ayuda (panel con índice, búsqueda y tema según el modo) y recorrido inicial.
import { GROUPS, TOPICS, TOUR, HELP_VERSION } from './help-content.js';

const $ = (s) => document.querySelector(s);
const PREF = 'pdf-studio.tour';
const prefs = {
  get() { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(PREF, JSON.stringify({ ...prefs.get(), ...v })); } catch { /* sin almacenamiento */ } },
};

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const strip = (html) => html.replace(/<[^>]+>/g, ' ');
let opener = null;
let currentModule = () => null;

export function initHelp({ getModule }) {
  currentModule = getModule;
  $('#btn-help').addEventListener('click', () => (isOpen() ? closeHelp() : openHelp()));
  $('#help-close').addEventListener('click', closeHelp);
  $('#help-q').addEventListener('input', () => renderIndex($('#help-q').value));
  $('#help-tour').addEventListener('click', () => { closeHelp(); startTour(); });
  $('#help-autotour').checked = !prefs.get().disabled;
  $('#help-autotour').addEventListener('change', (e) => prefs.set({ disabled: !e.target.checked }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); openHelp(); }
  });
  $('#help').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeHelp(); } });
  renderIndex('');
}

const isOpen = () => !$('#help').hidden;

export function openHelp(topicId) {
  opener = document.activeElement;
  $('#help').hidden = false;
  $('#btn-help').setAttribute('aria-expanded', 'true');
  const mod = currentModule();
  const id = topicId || (mod && TOPICS.find((t) => t.module === mod)?.id);
  if (id) showTopic(id); else { $('#help-topic').hidden = true; $('#help-index').hidden = false; $('#help-q').focus(); }
}

export function closeHelp() {
  $('#help').hidden = true;
  $('#btn-help').setAttribute('aria-expanded', 'false');
  (opener && opener.focus ? opener : $('#btn-help')).focus();
}

function renderIndex(q) {
  const nq = norm(q.trim());
  const hits = TOPICS.filter((t) => !nq || norm(`${t.title} ${t.summary} ${strip(t.body)}`).includes(nq));
  const nav = $('#help-index');
  if (!hits.length) { nav.innerHTML = `<p class="help-empty">No hay temas que coincidan con «${q.replace(/[<>&]/g, '')}». Prueba con otra palabra, por ejemplo «foliar» o «firma».</p>`; return; }
  nav.innerHTML = GROUPS.map((g) => {
    const items = hits.filter((t) => t.group === g.id);
    if (!items.length) return '';
    return `<div class="help-group"><h3>${g.title}</h3>${items.map((t) => `<button class="row-btn" data-topic="${t.id}"><b>${t.title}</b><span>${t.summary}</span></button>`).join('')}</div>`;
  }).join('');
  nav.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => showTopic(b.dataset.topic)));
  $('#help-topic').hidden = true;
  nav.hidden = false;
}

function showTopic(id) {
  const t = TOPICS.find((x) => x.id === id);
  if (!t) return;
  const art = $('#help-topic');
  art.innerHTML = `<button class="btn plain back" data-back>‹ Todos los temas</button><h2>${t.title}</h2>${t.body}<p class="muted small">Revisado para la versión ${HELP_VERSION}.</p>`;
  art.querySelector('[data-back]').addEventListener('click', () => renderIndex($('#help-q').value));
  $('#help-index').hidden = true;
  art.hidden = false;
  art.scrollTop = 0;
  art.focus();
}

// ---------------------------------------------------------------- recorrido
let step = 0;
export function maybeStartTour() {
  const p = prefs.get();
  if (!p.disabled && !p.seen) startTour();
}

export function startTour() {
  step = 0;
  $('#tour').hidden = false;
  renderStep();
  $('#tour-next').focus();
}

function endTour(mark) {
  $('#tour').hidden = true;
  if (mark) prefs.set({ seen: true, version: HELP_VERSION });
}

function renderStep() {
  const s = TOUR[step];
  const el = document.querySelector(s.target);
  $('#tour-step').textContent = `Paso ${step + 1} de ${TOUR.length}`;
  $('#tour-title').textContent = s.title;
  $('#tour-text').textContent = s.text;
  $('#tour-prev').disabled = step === 0;
  $('#tour-next').textContent = step === TOUR.length - 1 ? 'Empezar' : 'Siguiente';
  const ring = $('#tour-ring');
  const card = $('#tour-card');
  const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
  if (!r) { ring.style.cssText = 'top:50%;left:50%;width:0;height:0'; card.style.top = '30%'; card.style.left = `${Math.max(16, innerWidth / 2 - 160)}px`; return; }
  const pad = 6;
  Object.assign(ring.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const below = r.bottom + 200 < innerHeight;
  const top = below ? r.bottom + 14 : Math.max(16, r.top - 214);
  const left = Math.min(Math.max(16, r.left + r.width / 2 - 160), innerWidth - 336);
  Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
}

export function initTour() {
  $('#tour-next').addEventListener('click', () => { if (step < TOUR.length - 1) { step++; renderStep(); } else endTour(true); });
  $('#tour-prev').addEventListener('click', () => { if (step > 0) { step--; renderStep(); } });
  $('#tour-skip').addEventListener('click', () => endTour(true));
  $('#tour').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') endTour(true);
    if (e.key === 'ArrowRight') $('#tour-next').click();
    if (e.key === 'ArrowLeft') $('#tour-prev').click();
  });
  window.addEventListener('resize', () => { if (!$('#tour').hidden) renderStep(); });
}
