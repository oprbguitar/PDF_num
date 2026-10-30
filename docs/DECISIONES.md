# Decisiones técnicas y matriz de reutilización

Este documento resume la inspección de los repositorios indicados en el encargo, qué se reutilizó
y por qué, y qué está verificado frente a lo que queda como limitación.

## 1. Inspección de repositorios

| Repositorio | Lenguaje / licencia | Qué ofrece realmente | Observaciones |
|---|---|---|---|
| **storytold/pdfcraft** (principal) | Rust · MIT OR Apache-2.0 | Editor PDF completo con UI egui. Crates por dominio: `organize` (combinar, etiquetas de página), `edit` (contenido añadido, encabezados, Bates), `engine` (sesiones, historial, comandos), `annot`, `ocr`, `ui-egui`. | Hay `cfg(target_arch = "wasm32")` en `render`, `js`, `sign` y `engine`, y una app `apps/pdfcraft-web` que compila **toda la UI egui** a un canvas WASM con Trunk. No hay una API `wasm-bindgen` por operación que se pueda llamar desde JavaScript. El crate `ocr` usa `ocrs`, y sus modelos leen alfabeto latino **sin tildes**, así que no sirven para español. |
| **mozilla/pdf.js** | JS · Apache-2.0 | Renderizado fiel, extracción de texto con posiciones, lista de operadores (detecta imágenes). | Es un visor, no un editor. |
| **Hopding/pdf-lib** | JS · MIT | Crear/modificar PDF: copiar páginas entre documentos, rotar, dibujar texto/imágenes/trazos, formularios AcroForm (leer, rellenar, aplanar). | No edita texto existente ni descifra PDF. |
| **pdfme/pdfme** | TS · MIT | Generación de PDF a partir de plantillas con un diseñador. | Orientado a generar documentos nuevos, no a editar los existentes. |
| **naptha/tesseract.js** | JS+WASM · Apache-2.0 | OCR en el navegador con modelos `tessdata` por idioma (incluye español). | Necesita servir el worker, el núcleo WASM y los datos desde la extensión para funcionar sin conexión. |
| **pdfarranger/pdfarranger** | Python/GTK · GPL-3.0 | Referencia de interacción para organizar páginas (rejilla, rotar, duplicar, insertar en blanco). | Escritorio con pikepdf, y GPL. |
| **Stirling-Tools/Stirling-PDF** | Java (servidor) · MIT + partes propietarias | Muchas herramientas PDF del lado servidor. | Requiere servidor, y el encargo pide procesar todo en el equipo y sin conexión. |

## 2. Matriz de decisiones

| Necesidad | Decisión | Fuente | Justificación |
|---|---|---|---|
| Renderizar miniaturas y páginas | **Reutilizar directamente** | pdf.js | Motor de visualización de referencia, Apache-2.0, ya funciona en extensiones. |
| Combinar, reordenar, rotar, duplicar, en blanco, extraer, separar | **Desarrollar módulo nuevo** sobre pdf-lib (`src/core/organize.js`) | pdf-lib | Copia de páginas fiel y probada. La interacción toma como referencia pdfarranger, sin copiar su código GPL. |
| Conservar formularios al combinar | **Desarrollar** (reconstrucción de `/AcroForm` y renombrado de duplicados) | pdf-lib | pdf-lib copia los widgets pero no el diccionario `/AcroForm`. Sin esto, los campos dejan de ser editables. |
| Formatos de numeración (romanos, alfabéticos) | **Adaptar** | PDFcraft `crates/organize/src/labels.rs` | Se porta la semántica de PDFcraft: el alfabético repite letra (A…Z, AA…ZZ), como en las etiquetas PDF. |
| Numeración Bates | **Adaptar** el concepto | PDFcraft `crates/edit` (plantilla `<<Bates Number#dígitos#inicio>>`) | Se expresa como prefijo + relleno de ceros + numeración continua. |
| Números en letras (1 - uno) | **Desarrollar** | — | No existe en ninguna de las fuentes. Incluye apócope ("veintiún mil", "un millón"). |
| Foliación visible | **Desarrollar** (`src/core/folio.js`) | pdf-lib | Se estampa como contenido de la página, no como `/PageLabels`. Considera `/Rotate` y `CropBox`. |
| Editor: texto, imagen, resaltado, tapado, firma manuscrita | **Desarrollar** (`src/core/edit.js`) | pdf-lib | Se dibuja encima del contenido y nunca altera la imagen escaneada. |
| Editar texto existente | **Descartar en v0.1** | — | Ni pdf-lib ni pdf.js lo hacen con fidelidad comprobable (fuentes subconjunto, codificaciones, maquetación). El encargo pide no simularlo. |
| Rellenar formularios | **Reutilizar** | pdf-lib (AcroForm) | Fiel y comprobado reabriendo el resultado. |
| OCR | **Reutilizar** | tesseract.js + `spa` (tessdata_best_int) | El OCR de PDFcraft (`ocrs`) no lee tildes. tesseract.js ofrece español y funciona sin conexión empaquetado. |
| Historial deshacer/rehacer | **Adaptar** el modelo | PDFcraft `crates/engine` (concepto) | Instantáneas del espacio de trabajo (páginas, objetos, formulario, foliación). Las imágenes se guardan aparte. |
| Crates Rust vía WASM | **Descartar en v0.1** | PDFcraft | Exige escribir una capa `wasm-bindgen` por operación y un target `wasm32` con todo el árbol de dependencias. El coste no compensa frente a pdf-lib para las tres funciones prioritarias. La arquitectura deja un punto de entrada (`src/core/*`), y un adaptador WASM podría reemplazar un módulo sin tocar la UI. |
| Plantillas de generación | **Descartar** | pdfme | Fuera del alcance (no se generan documentos desde plantillas). |
| Servidor | **Descartar** | Stirling-PDF | Contradice el requisito sin conexión y sin subida. |

## 3. Arquitectura

```
extension/            Estáticos: manifest MV3, HTML, CSS con tokens
src/core/             Núcleo sin interfaz, ejecutable en Node y en el navegador
  numerals.js         Romanos, alfabéticos, palabras en español
  geometry.js         Coordenadas visuales ↔ espacio de usuario (/Rotate, CropBox)
  organize.js         Combinar y organizar, reconstrucción de AcroForm, rangos
  folio.js            Etiquetas, exclusiones, reinicios, estampado visible
  edit.js             Objetos añadidos, capa OCR invisible, formularios
  inspect.js          Cifrado, firmas, formularios, XFA, JS, detección de foliación previa
  pipeline.js         Estado → PDF final → reapertura y verificación
src/ui/
  export-worker.js    Ejecuta el núcleo en un Web Worker (no bloquea, cancelable)
  jobs.js             Cliente del worker: progreso y cancelación (terminate)
  render.js           pdf.js: un worker compartido, caché de miniaturas y cola de render
  store.js            IndexedDB: biblioteca temporal compartida y recuperación de sesión
  ocr.js              tesseract.js local
  editor.js           Editor de pantalla completa
  sidepanel.js        Panel lateral
scripts/build.mjs     esbuild + copia de recursos + iconos + .zip
```

Para añadir una herramienta nueva: se crea un módulo en `src/core/` (función pura que recibe un
`PDFDocument`), se añade un paso en `pipeline.js` y su panel en la interfaz. No hace falta
reconstruir nada más.

## 4. Verificado frente a limitaciones

**Verificado con pruebas automatizadas** (`npm test`, 32 pruebas, y `npm run test:e2e` con la extensión real cargada en Chromium):

- Combinar documentos de distintos tamaños; reordenar, rotar, duplicar, insertar páginas en blanco, extraer y separar.
- Foliación visible (superior izquierda, superior derecha e inferior centro), comprobada leyendo la posición con pdf.js para `/Rotate` 0/90/180/270, CropBox desplazado y contenido que deja la matriz de transformación sin restaurar. Las demás posiciones usan la misma fórmula.
- Todos los formatos (arábigos, romanos, alfabéticos, mixtos, Bates, número y letras) con exclusiones, reinicios y numeración por documento.
- Texto con tildes (WinAnsi), resaltado, tapado, imagen, firma manuscrita y capa OCR exportados y reabiertos.
- Formularios: se conservan al combinar, los nombres duplicados se renombran, se rellenan y opcionalmente se aplanan.
- PDF firmado real: se advierte que la firma digital se invalidará. Un PDF cifrado se reconoce y no se modifica. Los datos que no son PDF se rechazan con un mensaje claro.
- Cancelación de exportación.
- Extensión real (E2E): carga MV3, añadir PDFs, organizar, editar, rellenar formulario, foliar, exportar, reabrir y verificar folios A-001…A-006, OCR sin conexión, biblioteca compartida con el panel lateral y consola sin errores.

**Limitaciones conocidas**

- No se edita el texto existente de PDFs digitales. Lo añadido se dibuja encima. «Tapar» es visual: el contenido sigue dentro del PDF y **no es una censura segura**.
- Los PDF cifrados (incluidos los que solo tienen contraseña de propietario) no se pueden modificar.
- Al combinar se pierden marcadores (índice), JavaScript de documento y formularios XFA. Se avisa al cargar el archivo.
- Las firmas digitales quedan invalidadas al modificar cualquier página (comportamiento inherente al PDF).
- Las fuentes del folio y del texto añadido son las 14 estándar (Helvetica, Times, Courier). Caracteres fuera de Latin-1 se sustituyen por «?».
- El OCR depende de la calidad del escaneo. La capa de texto invisible es aproximada por palabra: sirve para buscar y copiar, no para maquetación.
- La detección de foliación previa solo funciona en páginas con texto extraíble.
- Todo se procesa en memoria del navegador. Documentos de cientos de MB pueden agotarla.
