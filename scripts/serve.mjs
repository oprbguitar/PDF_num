// Servidor estático mínimo para probar dist/extension fuera de Chrome (sin APIs chrome.*).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, process.argv[2] || 'dist/extension');
const port = Number(process.env.PORT || 5178);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(base, path || (existsSync(join(base, 'index.html')) ? 'index.html' : 'editor.html'));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(port, () => console.log(`http://localhost:${port}/editor.html`));
