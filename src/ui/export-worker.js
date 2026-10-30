// Worker de exportación: todo el trabajo pesado con pdf-lib ocurre fuera del hilo de la
// interfaz. Cancelar = terminar el worker (el hilo principal crea uno nuevo).
import { exportWorkspace } from '../core/pipeline.js';
import { analyzePdf } from '../core/inspect.js';
import { listFormFields } from '../core/edit.js';
import { buildDocument, saveDocument } from '../core/organize.js';

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  const progress = (f) => self.postMessage({ id, progress: f });
  try {
    if (cmd === 'analyze') {
      const { info, doc } = await analyzePdf(data.bytes, data.name);
      const fields = doc ? listFormFields(doc) : [];
      self.postMessage({ id, result: { info, fields } });
    } else if (cmd === 'export') {
      const sources = new Map(data.sources);
      const { bytes, labels } = await exportWorkspace(sources, data.state, { onProgress: progress, flattenForms: data.flattenForms });
      self.postMessage({ id, result: { bytes, labels } }, [bytes.buffer]);
    } else if (cmd === 'pages') {
      // Extraer/separar: construye un PDF solo con las páginas indicadas (sin ediciones).
      const doc = await buildDocument(new Map(data.sources), { pages: data.pages }, { onProgress: progress });
      const bytes = await saveDocument(doc);
      self.postMessage({ id, result: { bytes } }, [bytes.buffer]);
    } else {
      throw new Error(`Orden desconocida: ${cmd}`);
    }
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
