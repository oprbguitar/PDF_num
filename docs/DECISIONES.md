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
| Editar texto existente | v0.1: descartado. **v0.2: desarrollado** (`src/core/content.js` + `src/core/textedit.js`) | Enfoque de PDFcraft (`docs/editing-existing-text.md`), reimplementado en JS | Un lector de flujos de contenido localiza cada operador de texto (Tj, TJ, ', ") con su matriz, fuente, ToUnicode, anchos y color. Los trazos se agrupan en líneas y párrafos. Al editar, el operador se sustituye por un desplazamiento equivalente (`[-n] TJ`), así que el glifo desaparece y el resto del texto no se mueve. El texto nuevo se escribe en el mismo origen. Fuente: el programa incrustado (FontFile2 u OpenType) si contiene todos los caracteres (comprobado con fontkit); si no, Arimo, Tinos, Cousine o Carlito, métricamente compatibles. |
| Editar texto de escaneos | **Desarrollar** | Enfoque de PDFcraft (tapar con color del papel y escribir con el de la tinta) | Las líneas OCR se agrupan por altura. Los colores se muestrean del propio render (mediana del borde y percentil oscuro del interior). Las capas invisibles de otros programas (modo de render 3) se editan igual. |
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
  content.js          Lector de flujos de contenido (operadores con posición exacta en bytes)
  textedit.js         Párrafos editables, borrado real de glifos y reescritura con fuente adecuada
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

## 4. Verificado frente a limitaciones (v0.2.0)

**Verificado con pruebas automatizadas** (`npm test`, 41 pruebas, y `npm run test:e2e` con la extensión real cargada en Chromium):

- **Edición del texto existente** en un PDF real generado por Chromium (TrueType subconjunto, ToUnicode): detecta título, fecha, párrafo de 3 líneas y firma. Al corregir, el texto original deja de existir en el PDF (comprobado extrayendo el texto con pdf.js), el nuevo aparece en el mismo origen, el párrafo más largo se reparte en líneas y el resto de la página no se mueve.
- Fuente estándar sin `/Widths` (métricas AFM), texto girado 90° conservando color, TrueType incrustado reutilizado cuando alcanza (Type0/Identity-H), capa OCR invisible (modo 3) tapada y reescrita visible.
- Una página duplicada y editada no altera su copia: los flujos se reescriben como objetos nuevos. Si el documento cambió, la edición se rechaza con un mensaje claro.
- Combinar documentos de distintos tamaños; reordenar, rotar, duplicar, insertar páginas en blanco, extraer y separar.
- Foliación visible comprobada leyendo la posición con pdf.js para `/Rotate` 0/90/180/270, CropBox desplazado y contenido con la matriz de transformación sin restaurar.
- Todos los formatos de folio con exclusiones, reinicios y numeración por documento.
- Formularios: se conservan al combinar, los nombres duplicados se renombran, se rellenan y opcionalmente se aplanan.
- PDF firmado real (aviso), PDF cifrado (solo lectura), datos que no son PDF (mensaje claro) y cancelación de exportación.
- **E2E con la extensión real**: recorrido inicial (saltar); abrir 4 PDF y una imagen PNG; rotar y mover con el teclado; corregir el párrafo y la fecha de la carta en la propia página; añadir texto con «º» y «·»; rellenar formulario; ayuda contextual con F1, búsqueda y estado sin resultados; foliar A-001…A-008; exportar y verificar que el texto original ya no está, que el corregido sí, que el resto se conserva y que el formulario mantiene su valor. Además, en un escaneo real (captura PNG de texto impreso): OCR en español sin conexión, reconocimiento exacto de la línea, corrección («2041» → «2042») y verificación en el PDF exportado. Panel lateral con la biblioteca compartida y consola sin errores.

**Limitaciones conocidas**

- La corrección trabaja por párrafo: el formato mixto (una palabra en negrita) se unifica con el estilo de su primer trazo. Las tablas complejas pueden detectarse como líneas sueltas.
- No se editan: fuentes Type0 sin ToUnicode, texto vertical, ni texto dentro de XObjects de formulario (membretes reutilizados). La interfaz los marca en rojo y explica la alternativa.
- Si la fuente original es un subconjunto sin las letras nuevas, se usa una fuente equivalente de igual métrica, no la original.
- En escaneos, la corrección tapa con un color plano: la imagen original sigue debajo del recuadro.
- «Tapar» es visual y **no es una censura segura**. Para eliminar texto digital usa «Editar texto».
- Los PDF cifrados (incluidos los que solo tienen contraseña de propietario) no se pueden modificar.
- Al combinar se pierden marcadores, JavaScript de documento y formularios XFA. Se avisa al cargar el archivo.
- Las firmas digitales quedan invalidadas al modificar cualquier página.
- El folio usa las 14 fuentes estándar (Latin-1). El texto añadido y el corregido admiten Unicode completo.
- Todo se procesa en memoria del navegador. Documentos de cientos de MB pueden agotarla.
