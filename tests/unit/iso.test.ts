import { describe, expect, it } from 'vitest';
import { isoToScreen, screenToIso } from '../../src/render/iso';

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
