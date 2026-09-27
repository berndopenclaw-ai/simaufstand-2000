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

// View rotation in quarter turns (0..3, clockwise on screen). Rotation happens on world tile
// coords before projection, so the map [0,w] x [0,h] becomes the view map [0,vw] x [0,vh].

/** world tile coords -> view coords for a w x h map rotated by r quarter turns */
export function rotate(x: number, y: number, r: number, w: number, h: number): { x: number; y: number } {
  switch (r & 3) {
    case 1:
      return { x: h - y, y: x };
    case 2:
      return { x: w - x, y: h - y };
    case 3:
      return { x: y, y: w - x };
    default:
      return { x, y };
  }
}

/** view coords -> world tile coords (inverse of rotate) */
export function unrotate(x: number, y: number, r: number, w: number, h: number): { x: number; y: number } {
  switch (r & 3) {
    case 1:
      return { x: y, y: h - x };
    case 2:
      return { x: w - x, y: h - y };
    case 3:
      return { x: w - y, y: x };
    default:
      return { x, y };
  }
}

const DIR_X = [1, -1, 0, 0];
const DIR_Y = [0, 0, 1, -1];

/** rotate a direction index (0 E, 1 W, 2 S, 3 N) by r quarter turns */
export function rotateDir(d: number, r: number): number {
  const v = rotate(DIR_X[d], DIR_Y[d], r, 0, 0);
  return v.x > 0 ? 0 : v.x < 0 ? 1 : v.y > 0 ? 2 : 3;
}
