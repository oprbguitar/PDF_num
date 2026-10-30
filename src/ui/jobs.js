// Cliente del worker de exportación con progreso y cancelación real (terminate).
let worker = null;
let seq = 0;
const pending = new Map();

function spawn() {
  worker = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    if ('progress' in data) { p.onProgress && p.onProgress(data.progress); return; }
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error));
    else p.resolve(data.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Error en el proceso de exportación'));
    pending.clear();
    worker = null;
  };
}

export function run(cmd, payload, { onProgress } = {}) {
  if (!worker) spawn();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, cmd, ...payload });
  });
}

export function cancelAll() {
  if (worker) worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new DOMException('Operación cancelada', 'AbortError'));
  pending.clear();
}
