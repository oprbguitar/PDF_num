// Biblioteca temporal en IndexedDB: compartida entre el panel lateral y el editor,
// y sirve para recuperar el trabajo si la pestaña se cierra o el navegador falla.
const DB = 'pdf-studio';
const VERSION = 1;
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
  });
}

export const putFile = (file) => tx('files', 'readwrite', (s) => s.put(file));
export const deleteFile = (id) => tx('files', 'readwrite', (s) => s.delete(id));
export const getFiles = () => tx('files', 'readonly', (s) => s.getAll());
export const clearAll = async () => {
  await tx('files', 'readwrite', (s) => s.clear());
  await tx('meta', 'readwrite', (s) => s.clear());
};
export const saveWorkspace = (ws) => tx('meta', 'readwrite', (s) => s.put(ws, 'workspace'));
export const loadWorkspace = () => tx('meta', 'readonly', (s) => s.get('workspace'));

// Aviso entre páginas de la extensión (panel ↔ editor) cuando cambia la biblioteca.
export const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pdf-studio') : null;

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Paleta de etiquetas por documento (distinguibles y con contraste sobre blanco).
const TAGS = ['#1971C2', '#2F9E44', '#C2255C', '#E8590C', '#6741D9', '#0C8599', '#5C940D', '#862E9C'];
export const tagColor = (i) => TAGS[i % TAGS.length];

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
