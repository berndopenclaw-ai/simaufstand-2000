// Isometric projection helpers (2:1 tiles, SimCity 2000 style).
export const TW = 64;
export const TH = 32;
export const HALF_W = TW / 2;
export const HALF_H = TH / 2;
export const FLOOR_PX = 9;

/** world tile coords (x, y may be fractional) -> screen pixels (before camera) */
export function isoToScreen(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H };
}

/** screen pixels (before camera) -> world tile coords */
export function screenToIso(sx: number, sy: number): { x: number; y: number } {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Polygon points (flat array) for the footprint [x0,x1] x [y0,y1] raised by h pixels. */
export function isoQuad(x0: number, y0: number, x1: number, y1: number, h = 0): number[] {
  const a = isoToScreen(x0, y0);
  const b = isoToScreen(x1, y0);
  const c = isoToScreen(x1, y1);
  const d = isoToScreen(x0, y1);
  return [a.x, a.y - h, b.x, b.y - h, c.x, c.y - h, d.x, d.y - h];
}
