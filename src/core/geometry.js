// Geometría de página: el usuario siempre trabaja en coordenadas "visuales"
// (lo que ve en pantalla, origen abajo-izquierda, en puntos), y aquí se traducen al
// espacio de usuario del PDF teniendo en cuenta /Rotate y el CropBox.

export const MM_TO_PT = 72 / 25.4;

export function normRotation(deg) {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r;
}

// box: {x, y, width, height} del CropBox en espacio de usuario.
export function visualSize(box, rotation) {
  const r = normRotation(rotation);
  return r === 90 || r === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

// Punto visual (u, v) → punto de usuario (x, y). Devuelve también el ángulo con el que
// hay que dibujar texto/imágenes para que se vean derechos en el visor.
export function visualToUser(box, rotation, u, v) {
  const r = normRotation(rotation);
  const { x: x0, y: y0, width: W, height: H } = box;
  switch (r) {
    case 90: return { x: x0 + (W - v), y: y0 + u, angle: 90 };
    case 180: return { x: x0 + W - u, y: y0 + H - v, angle: 180 };
    case 270: return { x: x0 + v, y: y0 + H - u, angle: 270 };
    default: return { x: x0 + u, y: y0 + v, angle: 0 };
  }
}

export function pageBox(page) {
  // CropBox es lo que el visor muestra; si no existe pdf-lib devuelve el MediaBox.
  const b = page.getCropBox();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) throw new Error(`Color no válido: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
