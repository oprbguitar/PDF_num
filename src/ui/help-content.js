// Manual de PDF Studio: una sola fuente para la ayuda dentro de la app, el sitio
// público (GitHub Pages) y la guía en PDF. Cada tema tiene id estable, grupo, módulo
// (para la ayuda contextual), resumen y contenido en HTML sencillo.
export const HELP_VERSION = '0.2.0';

export const GROUPS = [
  { id: 'start', title: 'Primeros pasos' },
  { id: 'organize', title: 'Organizar y combinar' },
  { id: 'edit', title: 'Editar' },
  { id: 'folio', title: 'Foliar' },
  { id: 'more', title: 'Más' },
];

export const TOPICS = [
  {
    id: 'instalar', group: 'start', module: null, title: 'Descargar e instalar',
    summary: 'Instala la extensión en Chrome en dos minutos.',
    body: `
<ol>
  <li>Descarga <b>pdf-studio-${HELP_VERSION}.zip</b> desde la página de descargas o la sección <i>Releases</i> de GitHub.</li>
  <li>Descomprime el archivo en una carpeta que no vayas a borrar, por ejemplo <i>Documentos › PDF Studio</i>.</li>
  <li>En Chrome, escribe <kbd>chrome://extensions</kbd> en la barra de direcciones.</li>
  <li>Activa <b>Modo de desarrollador</b> (arriba a la derecha).</li>
  <li>Pulsa <b>Cargar descomprimida</b> y elige la carpeta donde está <i>manifest.json</i>.</li>
  <li>Fija el icono con la chincheta del menú de extensiones para tenerlo siempre a mano.</li>
</ol>
<h3>Actualizar</h3>
<p>Descomprime la nueva versión en la misma carpeta y pulsa el botón de recargar de PDF Studio en <kbd>chrome://extensions</kbd>. Tu trabajo guardado se conserva.</p>`,
  },
  {
    id: 'abrir', group: 'start', module: null, title: 'Abrir PDF e imágenes',
    summary: 'Arrastra archivos, usa el botón + o el panel lateral.',
    body: `
<ol>
  <li>Pulsa el icono de PDF Studio en la barra de Chrome: se abre el <b>panel lateral</b>.</li>
  <li>Suelta tus archivos en el recuadro o pulsa para elegirlos. También puedes abrir el editor de pantalla completa con <kbd>Alt</kbd>+<kbd>Mayús</kbd>+<kbd>P</kbd>.</li>
  <li>En el editor, arrastra archivos sobre el lienzo o usa <b>+</b> en <i>Documentos</i> (<kbd>Ctrl</kbd>+<kbd>O</kbd>).</li>
</ol>
<p>Se aceptan PDF, JPG, PNG y WebP. Cada imagen se convierte en una página del tamaño de la imagen.</p>
<p><b>Resultado:</b> cada documento aparece en la lista de la izquierda con un color, y sus páginas en el lienzo.</p>`,
  },
  {
    id: 'crear', group: 'start', module: null, title: 'Crear un PDF nuevo',
    summary: 'Desde cero, desde fotos o juntando partes de otros.',
    body: `
<ul>
  <li><b>En blanco:</b> pulsa <i>Nuevo documento en blanco</i>. Se crea una página A4 en la que puedes escribir, firmar o pegar imágenes desde <i>Editar</i>.</li>
  <li><b>Desde fotos o escaneos:</b> abre varias imágenes JPG o PNG. Cada una será una página. Ordénalas en <i>Organizar</i> y exporta.</li>
  <li><b>Desde otros PDF:</b> abre varios documentos, quédate solo con las páginas que necesites y exporta.</li>
</ul>`,
  },
  {
    id: 'exportar', group: 'start', module: null, title: 'Exportar y descargar',
    summary: 'Guarda una copia nueva; los originales no cambian.',
    body: `
<ol>
  <li>Pulsa <b>Exportar</b> (arriba a la derecha) o <kbd>Ctrl</kbd>+<kbd>S</kbd>.</li>
  <li>Chrome descarga el PDF en tu carpeta de descargas. Su nombre termina en <i>-editado</i> o <i>-foliado</i>.</li>
</ol>
<p>Antes de entregarlo, PDF Studio vuelve a abrir el archivo generado y comprueba que tenga todas las páginas. Si algo falla, verás el motivo y no se descargará un archivo incompleto.</p>
<p>Durante una exportación larga aparece <b>Cancelar</b> en el aviso inferior.</p>`,
  },
  {
    id: 'organizar', group: 'organize', module: 'organize', title: 'Ordenar, rotar y eliminar páginas',
    summary: 'Arrastra miniaturas y usa la barra de selección.',
    body: `
<ol>
  <li>Entra en <b>Organizar</b>.</li>
  <li>Arrastra una miniatura a su nueva posición. La línea azul indica dónde caerá.</li>
  <li>Para varias páginas: <kbd>Mayús</kbd>+clic selecciona un rango y <kbd>Ctrl</kbd>+clic suma páginas sueltas.</li>
  <li>Con páginas seleccionadas aparece una barra flotante: <b>rotar</b>, <b>duplicar</b>, <b>página en blanco</b>, <b>extraer</b> y <b>eliminar</b>.</li>
</ol>
<h3>Atajos</h3>
<ul><li><kbd>R</kbd> / <kbd>Mayús</kbd>+<kbd>R</kbd> rotar · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicar · <kbd>Supr</kbd> eliminar · <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> mover · <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</li></ul>`,
  },
  {
    id: 'combinar', group: 'organize', module: 'organize', title: 'Combinar e insertar páginas de otro PDF',
    summary: 'Varios PDF en uno, en el orden que quieras.',
    body: `
<ol>
  <li>Abre todos los PDF. Sus páginas se ponen una tras otra.</li>
  <li>Para insertar un PDF en medio de otro, suéltalo sobre la miniatura donde debe ir, o elige <i>Insertarlos tras la selección</i> en la lista de la izquierda antes de abrirlo.</li>
  <li>Reordena si hace falta y pulsa <b>Exportar</b>.</li>
</ol>
<p>Los formularios rellenables se conservan. Si dos documentos tienen un campo con el mismo nombre, el segundo se renombra para que no se mezclen.</p>`,
  },
  {
    id: 'separar', group: 'organize', module: 'organize', title: 'Separar y extraer',
    summary: 'Saca páginas o divide un PDF en varios.',
    body: `
<ul>
  <li><b>Extraer:</b> selecciona páginas y pulsa el icono de extraer en la barra flotante. Se guarda un PDF solo con ellas.</li>
  <li><b>Separar:</b> en el panel derecho escribe rangos como <i>1-3, 4-10, 11</i> y pulsa <i>Separar y guardar</i>. Se guarda un PDF por rango.</li>
</ul>
<p>Ambas opciones incluyen tus ediciones y la foliación, si está activa.</p>`,
  },
  {
    id: 'editar-texto', group: 'edit', module: 'edit', title: 'Corregir el texto del PDF',
    summary: 'Borra letras y escribe dentro del mismo documento.',
    body: `
<ol>
  <li>Entra en <b>Editar</b>. La herramienta <b>Editar texto</b> está activa (<kbd>E</kbd>).</li>
  <li>Pasa el cursor sobre la página: los párrafos editables se marcan en azul.</li>
  <li>Haz clic en el párrafo. Aparece un cuadro con su texto: borra, corrige o sigue escribiendo. Si el texto crece, continúa en las líneas siguientes con el mismo margen.</li>
  <li>Pulsa <kbd>Ctrl</kbd>+<kbd>Enter</kbd> o haz clic fuera para aplicar. <kbd>Esc</kbd> cancela.</li>
</ol>
<p>El texto original se <b>elimina de verdad</b> del PDF y el nuevo se escribe en la misma posición, tamaño, color e inclinación. Si la fuente del documento contiene las letras que escribiste, se usa la misma fuente. Si no, se usa una equivalente de igual medida (Arial→Arimo, Times→Tinos, Courier→Cousine, Calibri→Carlito).</p>
<h3>Límites</h3>
<ul>
  <li>Se edita por párrafo. El formato mixto dentro de un párrafo (negrita en una sola palabra) se unifica.</li>
  <li>Un párrafo marcado en rojo no se puede editar porque su fuente no indica qué letras contiene. Usa <i>Tapar</i> + <i>Añadir texto</i>.</li>
  <li>El texto dentro de objetos reutilizables (por ejemplo, membretes incrustados como formulario) no se detecta.</li>
</ul>
<p>Para recuperar el original, abre el párrafo y pulsa <i>Restaurar original</i>, o usa <kbd>Ctrl</kbd>+<kbd>Z</kbd>.</p>`,
  },
  {
    id: 'escaneos', group: 'edit', module: 'edit', title: 'Escaneos: reconocer y editar texto',
    summary: 'OCR en español sin conexión y corrección sobre la imagen.',
    body: `
<ol>
  <li>Abre la página escaneada en <b>Editar</b>. El panel indica <i>Escaneada</i>.</li>
  <li>Pulsa <b>Reconocer texto (OCR)</b>. La primera vez tarda unos segundos y todo ocurre en tu equipo.</li>
  <li>Con <i>Editar texto</i> activo, cada línea reconocida se puede corregir con un clic.</li>
  <li>Al aplicar, PDF Studio cubre la línea original con el color del papel y escribe el texto nuevo con el color de la tinta, ambos tomados de la propia imagen.</li>
</ol>
<p>Activa <b>Hacer el PDF buscable</b> para añadir una capa de texto invisible que permita buscar y copiar en el PDF exportado.</p>
<p><b>Importante:</b> el OCR puede equivocarse con escaneos borrosos o torcidos. Revisa el texto reconocido. En un escaneo, la imagen original sigue debajo del recuadro.</p>`,
  },
  {
    id: 'anadir', group: 'edit', module: 'edit', title: 'Añadir texto, resaltar, tapar e imágenes',
    summary: 'Notas, sellos y marcas encima de la página.',
    body: `
<ul>
  <li><b>Añadir texto</b> (<kbd>T</kbd>): haz clic donde quieras escribir. Cambia fuente, tamaño y color en el panel.</li>
  <li><b>Resaltar</b> (<kbd>H</kbd>): arrastra sobre una zona para marcarla con color semitransparente.</li>
  <li><b>Tapar</b> (<kbd>W</kbd>): arrastra para cubrir una zona con un recuadro opaco. Tapa a la vista, pero no borra lo que hay debajo. Para borrar texto de verdad usa <i>Editar texto</i>.</li>
  <li><b>Imagen</b> (<kbd>I</kbd>): haz clic y elige un PNG o JPG, por ejemplo un sello o un logotipo.</li>
  <li><b>Mover</b> (<kbd>V</kbd>): selecciona un objeto para moverlo, cambiarle el tamaño desde la esquina o borrarlo con <kbd>Supr</kbd>.</li>
</ul>`,
  },
  {
    id: 'firmar', group: 'edit', module: 'edit', title: 'Firmar a mano',
    summary: 'Dibuja tu firma con el ratón o el dedo.',
    body: `
<ol>
  <li>Elige <b>Firmar</b> (<kbd>F</kbd>).</li>
  <li>Dibuja sobre la página. Cada trazo se suma a la misma firma hasta que cambies de herramienta.</li>
  <li>Con <b>Mover</b> puedes recolocarla o cambiar su color.</li>
</ol>
<p>Es una firma visual, no una firma digital certificada. Si el PDF ya tenía una firma digital, quedará invalidada al modificarlo, y PDF Studio te lo advierte al abrirlo.</p>`,
  },
  {
    id: 'formularios', group: 'edit', module: 'edit', title: 'Rellenar formularios',
    summary: 'Campos de texto, casillas y listas.',
    body: `
<ol>
  <li>Abre una página de un PDF con formulario en <b>Editar</b>.</li>
  <li>El panel <i>Formulario</i> muestra sus campos. Escribe o marca los valores.</li>
  <li>Activa <i>Aplanar al exportar</i> si quieres que los valores queden fijos y no se puedan cambiar.</li>
</ol>`,
  },
  {
    id: 'comparar', group: 'edit', module: 'edit', title: 'Comparar con el original',
    summary: 'Ve lado a lado el antes y el después.',
    body: `<p>Marca <b>Comparar con el original</b> en el panel de Editar. A la izquierda verás la página original y a la derecha el PDF exactamente como se exportará, con correcciones, objetos añadidos y folio. Para seguir editando, desmarca la casilla.</p>`,
  },
  {
    id: 'foliar', group: 'folio', module: 'folio', title: 'Foliar un documento',
    summary: 'Numera todas las páginas de forma visible.',
    body: `
<ol>
  <li>Entra en <b>Foliar</b> y activa <b>Foliar al exportar</b>.</li>
  <li>Elige un formato rápido (<i>1, 2, 3</i>, <i>A-001</i>, <i>FOLIO-001</i>, <i>Bates</i>, <i>1 - uno</i>…) o ajusta estilo, prefijo, sufijo y ceros.</li>
  <li>Elige la posición en la cuadrícula y los márgenes en milímetros.</li>
  <li>Revisa la vista previa: es el PDF foliado real.</li>
  <li>Pulsa <b>Exportar</b>.</li>
</ol>
<p>El número queda impreso en la página, no es una etiqueta interna del visor.</p>`,
  },
  {
    id: 'foliar-avanzado', group: 'folio', module: 'folio', title: 'Excluir páginas, secciones y Bates',
    summary: 'Carátulas sin número, reinicios y numeración continua.',
    body: `
<ul>
  <li><b>No foliar estas páginas:</b> por ejemplo <i>1</i> para la carátula o <i>1, 5-6</i>. Si marcas <i>Las páginas sin folio cuentan igual</i>, el número salta esas páginas.</li>
  <li><b>Volver a empezar en:</b> <i>12</i> reinicia en la página 12; <i>30:100</i> empieza en 100 desde la página 30.</li>
  <li><b>Numeración continua entre documentos:</b> si la desmarcas, cada PDF combinado empieza de nuevo.</li>
  <li><b>Bates:</b> prefijo + 6 cifras continuas (EXP000001…). Cambia el prefijo y el número inicial a tu caso.</li>
  <li><b>Fondo blanco:</b> útil en escaneos con manchas, para que el número se lea bien.</li>
</ul>
<p>Si el documento parece estar ya foliado, verás un aviso con ejemplos para que no superpongas números.</p>`,
  },
  {
    id: 'privacidad', group: 'more', module: null, title: 'Privacidad y seguridad',
    summary: 'Tus documentos no salen de tu equipo.',
    body: `
<ul>
  <li>No hay servidores ni analítica. La extensión solo pide el permiso del panel lateral.</li>
  <li>Los documentos abiertos se guardan temporalmente en el almacenamiento de la extensión, para recuperar tu trabajo si cierras la pestaña. <b>Cerrar todo</b> los borra.</li>
  <li>Los originales nunca se modifican: siempre se descarga una copia.</li>
  <li>Los PDF cifrados solo se pueden ver. Los firmados digitalmente pierden la validez de la firma al modificarse.</li>
</ul>`,
  },
  {
    id: 'problemas', group: 'more', module: null, title: 'Problemas frecuentes',
    summary: 'Qué hacer si algo no funciona.',
    body: `
<ul>
  <li><b>«Está cifrado o tiene restricciones»</b>: el PDF tiene contraseña de permisos. Ábrelo en Chrome, imprímelo como PDF (si tienes derecho a hacerlo) y abre esa copia.</li>
  <li><b>Un párrafo no se puede editar</b>: su fuente no incluye la tabla de caracteres. Usa <i>Tapar</i> y luego <i>Añadir texto</i>.</li>
  <li><b>El texto corregido se ve en otra fuente</b>: la fuente original era un subconjunto sin esas letras y se usó la equivalente más parecida.</li>
  <li><b>«La página cambió desde que se editó»</b>: deshaz la corrección y vuelve a hacerla.</li>
  <li><b>No veo la extensión</b>: revisa en <kbd>chrome://extensions</kbd> que esté activada y fíjala con la chincheta.</li>
  <li><b>El OCR no reconoce bien</b>: sube el zoom del escaneo original, enderézalo o usa una imagen más nítida.</li>
</ul>`,
  },
  {
    id: 'atajos', group: 'more', module: null, title: 'Atajos de teclado',
    summary: 'Trabaja más rápido.',
    body: `
<ul>
  <li><kbd>Ctrl</kbd>+<kbd>O</kbd> abrir · <kbd>Ctrl</kbd>+<kbd>S</kbd> exportar · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> deshacer/rehacer · <kbd>F1</kbd> ayuda</li>
  <li>Organizar: <kbd>Ctrl</kbd>+<kbd>A</kbd>, <kbd>R</kbd>, <kbd>Ctrl</kbd>+<kbd>D</kbd>, <kbd>Supr</kbd>, <kbd>Alt</kbd>+flechas</li>
  <li>Editar: <kbd>E</kbd> editar texto, <kbd>V</kbd> mover, <kbd>T</kbd> texto, <kbd>H</kbd> resaltar, <kbd>W</kbd> tapar, <kbd>I</kbd> imagen, <kbd>F</kbd> firma, <kbd>Re Pág</kbd>/<kbd>Av Pág</kbd> cambiar de página</li>
</ul>`,
  },
  {
    id: 'glosario', group: 'more', module: null, title: 'Glosario',
    summary: 'Términos que aparecen en la app.',
    body: `
<ul>
  <li><b>Folio:</b> número visible que identifica cada hoja de un expediente.</li>
  <li><b>Bates:</b> numeración continua con prefijo y ceros, habitual en documentación legal.</li>
  <li><b>OCR:</b> reconocimiento óptico de caracteres; convierte la imagen de un texto en texto real.</li>
  <li><b>Aplanar:</b> convertir los campos de un formulario en contenido fijo.</li>
  <li><b>Subconjunto de fuente:</b> fuente incrustada que solo contiene las letras usadas en el documento.</li>
</ul>`,
  },
];

export const TOUR = [
  { target: '.modes', title: 'Tres modos, un documento', text: 'Organizar para ordenar páginas, Editar para corregir texto y firmar, y Foliar para numerar.' },
  { target: '.sidebar', title: 'Tus documentos', text: 'Abre o arrastra PDF e imágenes. Cada documento tiene un color para reconocer sus páginas.' },
  { target: '#tab-edit', title: 'Corrige el texto del PDF', text: 'En Editar, haz clic en cualquier párrafo para borrar letras y escribir dentro del mismo documento.' },
  { target: '#btn-export', title: 'Exporta una copia', text: 'Descarga el resultado verificado. Tus archivos originales nunca cambian.' },
  { target: '#btn-help', title: 'Ayuda siempre a mano', text: 'Aquí está el manual completo, con buscador. Pulsa F1 en cualquier momento.' },
];
