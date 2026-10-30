// Genera la guía pública (GitHub Pages, carpeta docs/) y, con --pdf, la guía en PDF,
// a partir del mismo contenido que usa la ayuda de la app (src/ui/help-content.js).
//   node scripts/build-site.mjs              → docs/index.html
//   CHROMIUM=… node scripts/build-site.mjs --pdf  → además docs/guia-pdf-studio.pdf
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GROUPS, TOPICS, HELP_VERSION } from '../src/ui/help-content.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const REPO = 'https://github.com/oprbguitar/PDF_num';
const ZIP = `${REPO}/releases/download/v${HELP_VERSION}/pdf-studio-${HELP_VERSION}.zip`;
const tokens = readFileSync(join(root, 'extension', 'styles', 'tokens.css'), 'utf8').replace(/url\('\.\.\/fonts\//g, "url('assets/fonts/");

mkdirSync(join(docs, 'assets', 'fonts'), { recursive: true });
for (const w of [400, 500, 600]) copyFileSync(join(root, 'node_modules', '@fontsource', 'figtree', 'files', `figtree-latin-${w}-normal.woff2`), join(docs, 'assets', 'fonts', `figtree-${w}.woff2`));
writeFileSync(join(docs, '.nojekyll'), '');

const toc = GROUPS.map((g) => `<li><a href="#g-${g.id}">${g.title}</a><ul>${TOPICS.filter((t) => t.group === g.id).map((t) => `<li><a href="#${t.id}">${t.title}</a></li>`).join('')}</ul></li>`).join('');
const sections = GROUPS.map((g) => `
<section class="group" id="g-${g.id}">
  <h2>${g.title}</h2>
  ${TOPICS.filter((t) => t.group === g.id).map((t) => `
  <article class="topic" id="${t.id}">
    <h3>${t.title}</h3>
    <p class="lead">${t.summary}</p>
    ${t.body}
  </article>`).join('')}
</section>`).join('');

const html = `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF Studio — Guía de uso</title>
<meta name="description" content="Guía para descargar, instalar y usar PDF Studio: organizar, corregir texto y foliar PDF en Chrome, sin conexión.">
<link rel="icon" href="assets/icon.png">
<style>
${tokens}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:72px}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--surface);color:var(--ink);font:400 16px/1.6 var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--accent-text);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,.btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--focus);border-radius:var(--r-sm)}
.nav{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:var(--sp-4);height:52px;padding:0 max(var(--sp-4),calc((100vw - 1080px)/2));background:var(--glass);border-bottom:1px solid var(--line-soft);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px)}
.nav b{font-weight:600}.nav .sp{flex:1}.nav a{font-size:14px;color:var(--ink-2)}
.btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 22px;border-radius:var(--r-pill);font:500 16px/1 var(--font);background:var(--accent);color:var(--accent-ink);transition:background-color var(--dur) var(--ease)}
.btn:hover{background:var(--accent-hover);text-decoration:none}
.btn.ghost{background:transparent;color:var(--accent-text)}.btn.ghost:hover{background:var(--accent-wash)}
.hero{max-width:880px;margin:0 auto;padding:var(--sp-8) var(--sp-4) var(--sp-6);text-align:center}
.hero h1{font-size:clamp(34px,6vw,56px);line-height:1.05;letter-spacing:-.03em;margin:0 0 var(--sp-3);font-weight:600}
.hero p{font-size:clamp(17px,2.2vw,21px);color:var(--ink-2);margin:0 auto var(--sp-6);max-width:640px}
.cta{display:flex;flex-wrap:wrap;gap:var(--sp-2);justify-content:center}
.ver{margin-top:var(--sp-3);font-size:13px;color:var(--ink-3)}
.shot{max-width:1080px;margin:0 auto var(--sp-8);padding:0 var(--sp-4)}
.shot img{width:100%;height:auto;border-radius:var(--r-lg);box-shadow:var(--shadow-pop);display:block}
.three{max-width:1080px;margin:0 auto var(--sp-8);padding:0 var(--sp-4);display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--sp-6)}
.three h3{margin:0 0 var(--sp-1);font-size:19px;font-weight:600}.three p{margin:0;color:var(--ink-2)}
.layout{max-width:1080px;margin:0 auto;padding:var(--sp-6) var(--sp-4) var(--sp-8);display:grid;grid-template-columns:240px minmax(0,1fr);gap:var(--sp-8);border-top:1px solid var(--line-soft)}
.toc{position:sticky;top:76px;align-self:start;font-size:14px}
.toc ul{list-style:none;margin:0;padding:0}.toc>ul>li{margin-bottom:var(--sp-3)}.toc>ul>li>a{font-weight:600;color:var(--ink)}
.toc ul ul li a{display:block;padding:3px 0;color:var(--ink-2)}
.group h2{font-size:28px;letter-spacing:-.02em;margin:var(--sp-6) 0 var(--sp-2);font-weight:600}
.group:first-child h2{margin-top:0}
.topic{padding:var(--sp-5) 0;border-bottom:1px solid var(--line-soft)}
.topic h3{font-size:20px;margin:0 0 var(--sp-1);font-weight:600}
.topic .lead{color:var(--ink-3);margin:0 0 var(--sp-3)}
.topic li{margin-bottom:6px}.topic ol,.topic ul{padding-left:22px}
.topic h3+.lead+h3,.topic h3:not(:first-child){font-size:15px;color:var(--ink-2);margin-top:var(--sp-4)}
kbd{font:500 13px/1 var(--font);padding:2px 7px;border-radius:var(--r-xs);background:var(--fill-strong)}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--sp-4);margin:var(--sp-4) 0}
.gallery figure{margin:0}.gallery img{width:100%;border-radius:var(--r-md);box-shadow:var(--shadow-page)}
.gallery figcaption{font-size:13px;color:var(--ink-3);margin-top:6px}
footer{padding:var(--sp-6) var(--sp-4);text-align:center;font-size:13px;color:var(--ink-3);background:var(--bg)}
@media (max-width:820px){.layout{grid-template-columns:1fr}.toc{position:static}.nav .hide-s{display:none}}
@media print{.nav,.cta,.toc,footer .noprint{display:none}.layout{display:block;border:0;padding-top:0}.hero{padding-top:0}body{font-size:12pt}.topic{break-inside:avoid}.shot img,.gallery img{box-shadow:none;border:1px solid var(--line)}.group{break-before:page}}
</style>
</head>
<body>
<nav class="nav" aria-label="Principal">
  <b>PDF Studio</b><span class="sp"></span>
  <a class="hide-s" href="#g-start">Empezar</a><a class="hide-s" href="#g-edit">Editar</a><a class="hide-s" href="#g-folio">Foliar</a>
  <a href="guia-pdf-studio.pdf">Guía en PDF</a><a href="${REPO}">GitHub</a>
</nav>
<header class="hero">
  <h1>Organiza, corrige y folia tus PDF.</h1>
  <p>Una extensión de Chrome sencilla y privada. Corrige el texto dentro del propio PDF, combina documentos y numera expedientes, todo sin conexión.</p>
  <div class="cta">
    <a class="btn" href="${ZIP}">Descargar v${HELP_VERSION}</a>
    <a class="btn ghost" href="#instalar">Cómo instalarla</a>
  </div>
  <p class="ver">Versión ${HELP_VERSION} · Gratis y de código abierto (MIT) · Requiere Chrome 116 o superior</p>
</header>
<div class="shot"><img src="img/edit.png" alt="Editor de PDF Studio corrigiendo el texto de una carta dentro del propio PDF" width="1440" height="860"></div>
<div class="three">
  <div><h3>Corrige el texto real</h3><p>Haz clic en un párrafo, borra y escribe. El texto original desaparece del PDF y el nuevo ocupa su lugar, con la misma fuente cuando es posible.</p></div>
  <div><h3>Ordena y combina</h3><p>Arrastra páginas entre documentos, rota, duplica, separa y convierte fotos en páginas PDF.</p></div>
  <div><h3>Folia en segundos</h3><p>1, 2, 3 · A-001 · FOLIO-001 · Bates · 1 - uno. Con vista previa real y exclusión de carátulas.</p></div>
</div>
<main class="layout">
  <aside class="toc" aria-label="Contenido"><ul>${toc}</ul></aside>
  <div>
    ${sections}
    <section class="group" id="g-capturas">
      <h2>Capturas</h2>
      <div class="gallery">
        <figure><img src="img/organize.png" alt="Modo Organizar con la barra de selección" loading="lazy"><figcaption>Organizar: arrastra, rota y separa.</figcaption></figure>
        <figure><img src="img/folio.png" alt="Modo Foliar con vista previa" loading="lazy"><figcaption>Foliar: vista previa del resultado real.</figcaption></figure>
        <figure><img src="img/help.png" alt="Panel de ayuda dentro de la app" loading="lazy"><figcaption>Ayuda integrada con buscador (F1).</figcaption></figure>
        <figure><img src="img/sidepanel.png" alt="Panel lateral de Chrome" loading="lazy"><figcaption>Panel lateral para abrir y combinar rápido.</figcaption></figure>
      </div>
    </section>
  </div>
</main>
<footer>PDF Studio ${HELP_VERSION} · <a href="${REPO}">Código fuente</a> · <a href="${REPO}/releases">Todas las versiones</a><span class="noprint"> · <a href="guia-pdf-studio.pdf">Descargar esta guía en PDF</a></span></footer>
</body>
</html>`;

writeFileSync(join(docs, 'index.html'), html);
copyFileSync(join(root, 'dist', 'extension', 'icons', 'icon-128.png'), join(docs, 'assets', 'icon.png'));
console.log('Sitio generado en docs/index.html');

if (process.argv.includes('--pdf')) {
  const bin = process.env.CHROMIUM;
  if (!bin || !existsSync(bin)) { console.error('Define CHROMIUM para generar la guía en PDF.'); process.exit(2); }
  const out = join(docs, 'guia-pdf-studio.pdf');
  const r = spawnSync(bin, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${join(root, 'scratch', 'print-profile')}`,
    `--print-to-pdf=${out}`, pathToFileURL(join(docs, 'index.html')).href], { stdio: 'ignore', timeout: 120000 });
  if (r.status !== 0 && !existsSync(out)) { console.error('No se pudo generar el PDF.'); process.exit(1); }
  console.log('Guía en PDF: docs/guia-pdf-studio.pdf');
}
