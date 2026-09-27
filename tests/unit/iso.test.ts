import { describe, expect, it } from 'vitest';
import { isoToScreen, rotate, rotateDir, screenToIso, unrotate } from '../../src/render/iso';

describe('isometric projection', () => {
  it('round-trips', () => {
    for (const [x, y] of [[0, 0], [10.5, 3.25], [63, 63], [7, 55]]) {
      const s = isoToScreen(x, y);
      const w = screenToIso(s.x, s.y);
      expect(w.x).toBeCloseTo(x);
      expect(w.y).toBeCloseTo(y);
    }
  });
  it('uses 2:1 tiles', () => {
    expect(isoToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    expect(isoToScreen(0, 1)).toEqual({ x: -32, y: 16 });
  });
});

describe('view rotation', () => {
  const W = 64;
  const H = 48;
  it('round-trips for every quarter turn', () => {
    for (let r = 0; r < 4; r++)
      for (const [x, y] of [[0, 0], [10.5, 3.25], [63, 47], [7, 40]]) {
        const v = rotate(x, y, r, W, H);
        const w = unrotate(v.x, v.y, r, W, H);
        expect(w.x).toBeCloseTo(x);
        expect(w.y).toBeCloseTo(y);
      }
  });
  it('keeps the map inside the view rectangle', () => {
    for (let r = 0; r < 4; r++) {
      const [vw, vh] = r & 1 ? [H, W] : [W, H];
      for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]]) {
        const v = rotate(x, y, r, W, H);
        expect(v.x).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.x).toBeLessThanOrEqual(vw);
        expect(v.y).toBeLessThanOrEqual(vh);
      }
    }
  });
  it('turns clockwise on screen', () => {
    // world +x points down-right on screen; one quarter turn clockwise makes it point down-left
    const a = rotate(0, 0, 1, W, H);
    const b = rotate(1, 0, 1, W, H);
    const d = isoToScreen(b.x - a.x, b.y - a.y);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBeGreaterThan(0);
  });
  it('four quarter turns are the identity', () => {
    expect(rotate(5, 9, 4, W, H)).toEqual({ x: 5, y: 9 });
    for (let d = 0; d < 4; d++) expect(rotateDir(rotateDir(rotateDir(rotateDir(d, 1), 1), 1), 1)).toBe(d);
  });
  it('rotates directions (0 E, 1 W, 2 S, 3 N)', () => {
    expect([0, 1, 2, 3].map((d) => rotateDir(d, 0))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((d) => rotateDir(d, 1))).toEqual([2, 3, 1, 0]);
    expect([0, 1, 2, 3].map((d) => rotateDir(d, 2))).toEqual([1, 0, 3, 2]);
  });
});
