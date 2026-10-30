# Registro de cambios

## 0.2.0 — 30 de octubre de 2026

**Edición real dentro del PDF**
- Nueva herramienta **Editar texto**: clic en un párrafo para borrar letras y escribir dentro del mismo PDF. El texto original se elimina del flujo de contenido (no se tapa). El nuevo se escribe en la misma posición, tamaño, color e inclinación.
- Si la fuente incrustada del documento tiene las letras necesarias se reutiliza. Si no, se usa una fuente métricamente compatible (Arimo≈Arial, Tinos≈Times, Cousine≈Courier, Carlito≈Calibri).
- Los párrafos se reparten de nuevo en líneas al crecer, con el mismo margen e interlineado.
- **Escaneos**: tras el OCR, cada línea reconocida se corrige con un clic. Se tapa con el color del papel y se escribe con el color de la tinta, ambos tomados de la imagen.
- Las capas OCR usan ahora texto invisible estándar (modo de render 3), ajustado al ancho de cada palabra.
- El texto añadido admite Unicode completo (º, ·, comillas tipográficas, €).

**Crear PDF**
- Abrir imágenes JPG, PNG o WebP: cada una se convierte en una página.
- Botón «Nuevo documento en blanco».

**Interfaz minimalista**
- Rediseño completo: barra superior translúcida, control segmentado, barra flotante de selección, avisos flotantes, modo oscuro automático y tipografía Figtree.

**Ayuda integrada**
- Centro de ayuda con buscador y tema según el modo actual (F1).
- Recorrido inicial con «Saltar», opción de no mostrarlo y «Repetir recorrido».
- Guía pública en GitHub Pages y guía en PDF generadas del mismo contenido.

**Verificación**
- 41 pruebas del núcleo (antes 32). Incluyen un PDF real generado por Chromium, TrueType incrustado, texto girado, fuentes estándar y capas OCR.
- La prueba de extremo a extremo con la extensión real cubre ahora corregir texto existente, corregir un escaneo tras OCR, abrir imágenes, la ayuda y el recorrido.

## 0.1.0 — 30 de octubre de 2026
- Primera versión: organizar y combinar, añadir texto, firmas, imágenes y marcas, formularios, OCR y foliador completo.
