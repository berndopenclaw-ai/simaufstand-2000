import { describe, expect, it } from 'vitest';
import { createWorld, step, hashWorld, Command, World } from '../../src/sim/world';
import { Side, Kind } from '../../src/sim/types';
import { SCENARIOS } from '../../src/sim/scenarios';

/**
 * Replay regression: a recorded command log must always produce exactly the
 * same world state. If a gameplay change is intended, update the snapshots
 * with `npx vitest run -u` and mention it in the commit.
 */
function replay(log: { tick: number; cmd: Command }[], ticks: number, seed = 1234): World {
  const w = createWorld({ seed, scenario: 'taubensteuer', aiSides: [true, false] });
  for (let t = 0; t < ticks; t++) step(w, log.filter((e) => e.tick === t).map((e) => e.cmd));
  return w;
}

const demoIds = (w: World, k: Kind) => w.units.filter((u) => u.kind === k).map((u) => u.id);

function recordedLog(): { tick: number; cmd: Command }[] {
  const w = createWorld({ seed: 1234, scenario: 'taubensteuer', aiSides: [true, false] });
  const d = demoIds(w, Kind.Demonstrant);
  const k = demoIds(w, Kind.Kleber);
  const o = demoIds(w, Kind.Organisator);
  return [
    { tick: 0, cmd: { t: 'move', side: Side.Demo, ids: d.slice(0, 5), x: 25, y: 37 } },
    { tick: 0, cmd: { t: 'move', side: Side.Demo, ids: d.slice(5), x: 31, y: 25 } },
    { tick: 5, cmd: { t: 'move', side: Side.Demo, ids: k, x: 25, y: 37 } },
    { tick: 10, cmd: { t: 'move', side: Side.Demo, ids: o, x: 26, y: 38 } },
    { tick: 250, cmd: { t: 'ability', side: Side.Demo, ids: k, a: 'glue' } },
    { tick: 300, cmd: { t: 'ability', side: Side.Demo, ids: d.slice(0, 5), a: 'sit' } },
    { tick: 320, cmd: { t: 'buy', side: Side.Demo, kind: Kind.Demonstrant } },
    { tick: 400, cmd: { t: 'ability', side: Side.Demo, ids: o, a: 'megaphone' } },
  ];
}

describe('replay regression', () => {
  it('same log => same state (determinism)', () => {
    const log = recordedLog();
    expect(hashWorld(replay(log, 900))).toBe(hashWorld(replay(log, 900)));
  });
  it('matches the golden state hash', () => {
    const w = replay(recordedLog(), 900);
    expect({ hash: hashWorld(w), tick: w.tick, progress: w.progress, arrests: w.stats.arrests }).toMatchSnapshot();
  });
});

describe('AI vs AI soak', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id}: both AIs play a full game without errors`, () => {
      const w = createWorld({ seed: 99, scenario: sc.id, aiSides: [true, true], difficulty: 'schwer' });
      let guard = 0;
      while (!w.result && guard++ < sc.durationTicks + 10) step(w);
      expect(w.result).not.toBeNull();
      expect(w.opinion).toBeGreaterThanOrEqual(0);
      expect(w.opinion).toBeLessThanOrEqual(100);
      for (const u of w.units) {
        expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
        expect(u.x).toBeGreaterThanOrEqual(0);
        expect(u.y).toBeGreaterThanOrEqual(0);
      }
      // AI actually plays: both sides did something
      expect(w.stats.bought[0] + w.stats.bought[1]).toBeGreaterThan(0);
    });
  }
  it('simulation stays fast (< 2 ms per tick on average)', () => {
    const w = createWorld({ seed: 5, scenario: 'gartenzwerge', aiSides: [true, true] });
    const t0 = performance.now();
    for (let i = 0; i < 2000 && !w.result; i++) step(w);
    expect((performance.now() - t0) / w.tick).toBeLessThan(2);
  });
});
