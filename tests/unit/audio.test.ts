import { describe, expect, it } from 'vitest';
import { TRACKS, noteToMidi, melody } from '../../src/audio/tracks';
import { midiToHz } from '../../src/audio/synth';

describe('music data', () => {
  it('parses note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('F#5')).toBe(78);
    expect(midiToHz(69)).toBeCloseTo(440);
  });
  it('rejects bars that do not add up to 16 steps', () => {
    expect(() => melody(['C5:4 D5:4'])).toThrow();
  });
  for (const [id, t] of Object.entries(TRACKS)) {
    it(`${id}: all notes lie inside the loop and in a sane range`, () => {
      const total = t.bars * 16;
      expect(t.channels.length).toBeGreaterThan(1);
      for (const c of t.channels) {
        for (const n of c.notes) {
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(total);
          expect(n.len).toBeGreaterThan(0);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
          if (c.inst !== 'drums') {
            expect(n.midi).toBeGreaterThanOrEqual(28);
            expect(n.midi).toBeLessThanOrEqual(96);
          }
        }
      }
    });
  }
});
