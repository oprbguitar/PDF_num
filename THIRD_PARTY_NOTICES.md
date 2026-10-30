# Avisos de terceros

PDF Studio se distribuye bajo licencia MIT e incluye o se basa en los siguientes componentes.
Los textos completos de cada licencia viajan dentro del paquete, en `licenses/`.

| Componente | Uso en PDF Studio | Licencia |
|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 | Combinar, copiar páginas, estampar folios y objetos, rellenar formularios | MIT |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist` 4.10.38) | Renderizar miniaturas y páginas, extraer texto para detectar foliación previa | Apache-2.0 |
| [tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 y `tesseract.js-core` | OCR local opcional | Apache-2.0 |
| Datos de idioma `spa` (tessdata_best_int, vía `@tesseract.js-data/spa`) | Modelo de reconocimiento en español | Apache-2.0 (tessdata) / MIT (paquete npm) |
| [Source Sans 3](https://github.com/adobe-fonts/source-sans) y [Source Code Pro](https://github.com/adobe-fonts/source-code-pro) (vía Fontsource) | Tipografía de la interfaz | SIL OFL 1.1 |
| [PDFcraft](https://github.com/storytold/pdfcraft) | Referencia y lógica adaptada: semántica de etiquetas romanas/alfabéticas (`crates/organize/src/labels.rs`), concepto de numeración Bates (`crates/edit`), modelo de historial (`crates/engine`) | MIT OR Apache-2.0 |
| Fixtures `test/fixtures/form.pdf` y `openssl-signed.pdf` | Pruebas con un formulario y un PDF firmado reales (copiados de PDFcraft) | MIT OR Apache-2.0 |

No se copia código de pdfarranger (GPL-3.0), Stirling-PDF ni pdfme: se revisaron como referencia
funcional y de interfaz, pero no se reutiliza su código (ver `docs/DECISIONES.md`).
