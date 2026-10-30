# DESIGN.md — PDF Studio

## Superficie
- **Modo:** operate (herramienta documental de uso frecuente).
- **Usuario:** personal administrativo, legal y técnico que arma expedientes: combina escritos, inserta anexos escaneados, sella, firma y folia.
- **Tarea principal:** ordenar las páginas de varios PDF y dejar un documento final numerado, sin subirlo a ningún servidor.

## Dirección
- **Arquetipo:** barra de comando + superficie maestra + panel contextual. Es la variante del arquetipo «Command bar + tabla maestra» que asignó `design-pick`. Aquí la «tabla» es la rejilla de páginas, porque organizar PDF es una tarea visual.
- **Paleta:** acero + verde operativo. El verde marca acción y estado (exportar, folio activo, posición elegida, éxito) y nunca se usa como fondo decorativo. El azul de apoyo marca la selección.
- **Tipografía:** Source Sans 3 (interfaz) y Source Code Pro (números de página, tamaños, folios de ejemplo), empaquetadas en la extensión porque funciona sin conexión.
- **Geometría:** esquinas rectas (2 px), bordes de 1 px, sin sombras. Las páginas se apoyan sobre un «escritorio» gris (`--desk`).
- **Motion:** mínimo, solo transiciones de color y borde (120 ms). Con `prefers-reduced-motion` la duración es 0.
- **Densidad:** alta en los paneles y media en la rejilla.

## Tokens
Definidos en `extension/styles/tokens.css`. Ningún valor visual fuera de esa escala:
color (`--ink`, `--surface*`, `--line*`, `--accent*`, `--support*`, estados), tipografía
(`--fs-h1` 18 … `--fs-caption` 11), espacio (`--sp-1` 4 … `--sp-8` 64), forma (`--radius` 2px),
motion (`--dur`, `--ease`).

## Estructura
- **Editor (pestaña):** barra de comando (abrir, modos Organizar/Editar/Foliar, total de páginas y tamaño, deshacer/rehacer, exportar) · biblioteca a la izquierda con un color por documento · escenario central · panel de herramientas del modo · barra de estado con progreso y cancelación.
- **Panel lateral:** zona de soltar, biblioteca ordenable, accesos a los tres modos y combinación rápida.
- Cada documento fuente tiene un color, y ese color aparece en sus miniaturas para saber de qué archivo viene cada página.

## Estados
Hover, active, focus-visible (anillo azul de 2 px), disabled, selected (borde y fondo azul), loading (barra de progreso y botón de cancelar). Los campos no válidos se marcan con borde rojo y un mensaje en la barra de estado.

## Responsive
- ≥ 1280: tres columnas.
- 1024–1279: columnas más estrechas.
- < 1024: una columna (biblioteca → escenario → panel) y la barra de comando se envuelve.
- ≤ 480: los modos ocupan todo el ancho y las miniaturas pasan a 96 px.

Revisado a 360, 768, 1280 y 1600 px.
