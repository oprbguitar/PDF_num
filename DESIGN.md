# DESIGN.md — PDF Studio 0.2

## Superficie
- **Modo:** operate (herramienta documental de uso frecuente) y read (guía pública).
- **Usuario:** personas que arman, corrigen y numeran expedientes y documentos, sin perfil técnico.
- **Tarea principal:** abrir PDF, corregir lo necesario, ordenar páginas, foliar y descargar una copia.

## Dirección (0.2)
La persona usuaria pidió una interfaz «muy simple y minimalista, al estilo Apple». Esa petición sustituye la dirección «acero + verde» que el selector asignó en 0.1.
- **Arquetipo:** barra superior + documentos a la izquierda + lienzo + inspector, como Vista Previa y Pages. El lienzo manda y los controles aparecen solo cuando hacen falta: la barra de selección flota sobre las páginas y el editor de texto se abre sobre el propio párrafo.
- **Paleta:** grises cálidos de sistema (`#F5F5F7`, `#FFFFFF`, `#E8E8ED`) y un solo acento azul (`#0071E3`) para acción y selección. El verde solo marca el interruptor «Foliar al exportar».
- **Tipografía:** Figtree 400/500/600, empaquetada para funcionar sin conexión. No se usan Inter, Geist, Roboto ni `system-ui`.
- **Forma:** radios de 7 px en controles, 10–14 px en paneles y avisos, y píldoras en controles flotantes. Las páginas llevan 2 px de radio y sombra suave de papel.
- **Profundidad:** la barra superior y la barra de selección son translúcidas con desenfoque porque el contenido pasa por debajo (función, no decoración). No hay ningún otro efecto de vidrio.
- **Motion:** 180–260 ms solo en color, opacidad y desplazamiento de avisos o del recorrido. Con `prefers-reduced-motion` la duración es 0.
- **Modo oscuro:** automático con `prefers-color-scheme`, con tokens propios (no se invierten colores).

## Tokens
En `extension/styles/tokens.css`: color, tipografía (`--fs-title` 22 … `--fs-micro` 11), espacio (`--sp-1` 4 … `--sp-8` 48), radios, sombras (`--shadow-page`, `--shadow-pop`), medidas (`--bar-h`, `--side-w`, `--insp-w`) y movimiento. La guía pública reutiliza el mismo archivo.

## Estados
Hover (fondo `--fill`), active (escala .98), focus-visible (anillo azul de 3 px), disabled (opacidad .4), selected (fondo `--accent-wash` y anillo en la miniatura), loading (botón atenuado, barra de progreso y «Cancelar» en el aviso flotante). Texto editable: contorno azul al pasar el cursor, subrayado si ya se corrigió y contorno rojo si no se puede editar.

## Ayuda
Botón «?» y tecla F1 abren un panel lateral con buscador, índice por grupos y el tema del modo actual. El recorrido inicial (5 pasos) ofrece Saltar, Atrás y Siguiente, la casilla «Mostrar el recorrido al abrir» y la opción «Repetir recorrido». Sigue el contrato de `dev-funcy-agents/docs/reference/USER-HELP-NAVIGATION-PATTERNS.md`.

## Responsive
- ≥ 1280: tres columnas.
- 1024–1279: columnas más estrechas.
- < 1024: una columna; los modos pasan a una segunda fila a todo el ancho y la ayuda ocupa toda la pantalla.
- ≤ 480: miniaturas de 96 px y acciones en columna.

Revisado a 360, 768, 1280, 1440 y 1600 px. El sitio de la guía se revisó a 360 y 1280 px sin desbordamiento horizontal.
