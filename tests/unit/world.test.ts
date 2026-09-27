import { describe, expect, it } from 'vitest';
import { createWorld, step, World, Unit, hashWorld, addUnit, computeBlock } from '../../src/sim/world';
import { Kind, Side, Tile, PARKED_BURNING, PARKED_WRECK, BAL } from '../../src/sim/types';

const make = (scenario = 'taubensteuer', extra: Partial<Parameters<typeof createWorld>[0]> = {}) =>
  createWorld({ seed: 7, scenario, aiSides: [false, false], passants: 0, trafficCars: 0, ...extra });

const run = (w: World, n: number) => { for (let i = 0; i < n; i++) step(w); };
const ofKind = (w: World, k: Kind) => w.units.filter((u) => u.kind === k);
const place = (u: Unit, x: number, y: number) => { u.x = x + 0.5; u.y = y + 0.5; u.path = []; };

describe('world setup', () => {
  it('spawns the scenario units', () => {
    const w = make();
    expect(ofKind(w, Kind.Polizist).length).toBe(8);
    expect(ofKind(w, Kind.Demonstrant).length).toBe(10);
    expect(ofKind(w, Kind.Kleber).length).toBe(3);
    expect(ofKind(w, Kind.Presse).length).toBe(2);
    expect(w.parked.length).toBeGreaterThan(20);
  });
  it('is deterministic', () => {
    const a = createWorld({ seed: 3, scenario: 'kuhglocken', aiSides: [true, true] });
    const b = createWorld({ seed: 3, scenario: 'kuhglocken', aiSides: [true, true] });
    run(a, 300); run(b, 300);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });
});

describe('movement', () => {
  it('moves selected units to the target', () => {
    const w = make();
    const u = ofKind(w, Kind.Demonstrant)[0];
    step(w, [{ t: 'move', side: Side.Demo, ids: [u.id], x: 13, y: 49 }]);
    run(w, 400);
    expect(Math.floor(u.x)).toBe(13);
    expect(Math.floor(u.y)).toBe(49);
  });
  it('ignores commands for the other side', () => {
    const w = make();
    const u = ofKind(w, Kind.Demonstrant)[0];
    const before = { x: u.x, y: u.y };
    step(w, [{ t: 'move', side: Side.Police, ids: [u.id], x: 30, y: 30 }]);
    run(w, 50);
    expect({ x: u.x, y: u.y }).toEqual(before);
  });
  it('keeps vehicles on roads', () => {
    const w = make();
    const tr = ofKind(w, Kind.Transporter)[0];
    step(w, [{ t: 'move', side: Side.Police, ids: [tr.id], x: 34, y: 34 }]);
    for (let i = 0; i < 400; i++) {
      step(w);
      const t = w.map.tiles[Math.floor(tr.y) * w.map.w + Math.floor(tr.x)];
      expect([Tile.Road, Tile.Plaza, Tile.Parking]).toContain(t);
    }
  });
});

describe('abilities', () => {
  it('glues a Kleber onto a road and blocks traffic there', () => {
    const w = make();
    const k = ofKind(w, Kind.Kleber)[0];
    place(k, 31, 25);
    step(w, [{ t: 'ability', side: Side.Demo, ids: [k.id], a: 'glue' }]);
    run(w, BAL.glueTicks + 2);
    expect(k.glued).toBe(true);
    expect(w.block[25 * w.map.w + 31]).toBeGreaterThan(0);
    // glued units ignore move orders
    step(w, [{ t: 'move', side: Side.Demo, ids: [k.id], x: 1, y: 1 }]);
    run(w, 30);
    expect(Math.floor(k.x)).toBe(31);
  });
  it('sit toggles', () => {
    const w = make();
    const d = ofKind(w, Kind.Demonstrant).slice(0, 3);
    step(w, [{ t: 'ability', side: Side.Demo, ids: d.map((u) => u.id), a: 'sit' }]);
    expect(d.every((u) => u.sit)).toBe(true);
    step(w, [{ t: 'ability', side: Side.Demo, ids: d.map((u) => u.id), a: 'sit' }]);
    expect(d.every((u) => !u.sit)).toBe(true);
  });
  it('Autotrupp can burn a car which costs opinion', () => {
    const w = make('gartenzwerge');
    const a = ofKind(w, Kind.Autotrupp)[0];
    const car = w.parked[0];
    place(a, car.x, car.y);
    const before = w.opinion;
    step(w, [{ t: 'ability', side: Side.Demo, ids: [a.id], a: 'burn' }]);
    expect(car.state).toBe(PARKED_BURNING);
    expect(w.opinion).toBeLessThan(before);
    expect(w.stats.fires).toBe(1);
  });
  it('Autotrupp moves a parked car onto the road as a barricade', () => {
    const w = make('gartenzwerge');
    const a = ofKind(w, Kind.Autotrupp)[0];
    // find a parked car with a road neighbour
    let found = false;
    for (const car of w.parked) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x = car.x + dx, y = car.y + dy;
        if (w.map.tiles[y * w.map.w + x] !== Tile.Road) continue;
        place(a, x, y);
        step(w, [{ t: 'ability', side: Side.Demo, ids: [a.id], a: 'carblock' }]);
        run(w, BAL.carblockTicks + 2);
        expect(w.parked.some((p) => p.x === x && p.y === y)).toBe(true);
        computeBlock(w);
        expect(w.block[y * w.map.w + x]).toBeGreaterThanOrEqual(5);
        expect(a.uses).toBe(2);
        found = true;
        break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });
  it('megaphone recruits passants when opinion is high enough', () => {
    const w = make();
    const o = ofKind(w, Kind.Organisator)[0];
    const p = addUnit(w, Kind.Passant, o.x + 1, o.y);
    w.opinion = 60;
    step(w, [{ t: 'ability', side: Side.Demo, ids: [o.id], a: 'megaphone' }]);
    expect(p.gone || !w.units.includes(p)).toBe(true);
    expect(w.stats.recruits).toBe(1);
    expect(o.cooldown).toBeGreaterThan(0);
  });
});

describe('police behaviour', () => {
  it('arrests adjacent demonstrators and the transporter picks them up', () => {
    const w = make();
    const cop = ofKind(w, Kind.Polizist)[0];
    const demo = ofKind(w, Kind.Demonstrant)[0];
    const tr = ofKind(w, Kind.Transporter)[0];
    place(cop, 13, 19); place(demo, 14, 19); place(tr, 13, 20 - 1 + 0); // transporter on road next to them
    tr.x = 13.5; tr.y = 19.5;
    run(w, BAL.arrestTicks + 3);
    expect(demo.arrested).toBe(true);
    expect(w.stats.arrests).toBe(1);
    run(w, 20);
    expect(demo.gone).toBe(true);
    expect(tr.cargo).toBe(1);
  });
  it('cannot arrest glued activists until the Loesetrupp frees them', () => {
    const w = make();
    const cop = ofKind(w, Kind.Polizist)[0];
    const k = ofKind(w, Kind.Kleber)[0];
    const lt = ofKind(w, Kind.Loesetrupp)[0];
    place(k, 13, 19); k.glued = true; k.sit = true;
    place(cop, 14, 19);
    run(w, 60);
    expect(k.arrested).toBe(false);
    place(lt, 12, 19);
    run(w, BAL.ungluedTicks + 5);
    expect(k.glued).toBe(false);
    run(w, BAL.arrestTicksSitting + 5);
    expect(k.arrested).toBe(true);
  });
  it('water cannon extinguishes burning cars', () => {
    const w = make('gartenzwerge');
    const ww = ofKind(w, Kind.Wasserwerfer)[0];
    const car = w.parked[0];
    car.state = PARKED_BURNING; car.timer = 500;
    ww.x = car.x + 0.5; ww.y = car.y + 2.5; ww.path = [];
    run(w, 3);
    expect(car.state).toBe(PARKED_WRECK);
    expect(w.stats.sprays).toBe(1);
  });
  it('water cannon on a crowd shifts opinion towards the demonstrators', () => {
    const w = make('gartenzwerge');
    const ww = ofKind(w, Kind.Wasserwerfer)[0];
    ww.x = 13.5; ww.y = 25.5; ww.path = [];
    const ds = ofKind(w, Kind.Demonstrant).slice(0, 4);
    ds.forEach((d, i) => { d.x = 13.5 + (i % 2) * 0.4; d.y = 27.5 + i * 0.2; d.path = []; });
    const before = w.opinion;
    run(w, 3);
    expect(w.stats.sprays).toBe(1);
    expect(w.opinion).toBeGreaterThan(before);
  });
});

describe('traffic', () => {
  it('cars stop in front of a blockade', () => {
    const w = createWorld({ seed: 7, scenario: 'taubensteuer', aiSides: [false, false], passants: 0, trafficCars: 120 });
    run(w, 50);
    expect(w.cars.length).toBeGreaterThan(100);
    // block a whole road column with demonstrators
    const ds = w.units.filter((u) => u.side === Side.Demo);
    ds.forEach((d, i) => { d.x = 19.5; d.y = 20 + i + 0.5; d.path = []; d.sit = true; });
    run(w, 5);
    for (let i = 0; i < 200; i++) {
      const prev = new Map(w.cars.map((c) => [c.id, c.ny * w.map.w + c.nx]));
      step(w);
      for (const c of w.cars) {
        const ni = c.ny * w.map.w + c.nx;
        // a car never starts driving into a tile that is blocked by demonstrators
        if (prev.get(c.id) !== ni && c.t === 0) expect(w.block[ni]).toBe(0);
      }
    }
    expect(w.jam).toBeGreaterThan(0);
  });
});

describe('objectives and results', () => {
  it('blockade points accumulate and demonstrators win', () => {
    const w = make();
    const ds = w.units.filter((u) => u.side === Side.Demo);
    const pts = (w.scenario.objective as any).points;
    ds.forEach((d, i) => { const p = pts[i % 4]; d.x = p.x + 0.5; d.y = p.y + 0.5; d.path = []; d.sit = true; });
    // keep police away
    w.units.filter((u) => u.side === Side.Police).forEach((u) => { u.stance = false; });
    run(w, 2600);
    expect(w.result?.winner).toBe(Side.Demo);
    expect(w.result?.reason).toBe('objective');
  });
  it('police win when time runs out', () => {
    const w = make();
    w.units.filter((u) => u.side === Side.Police).forEach((u) => { u.stance = false; });
    w.tick = w.scenario.durationTicks - 1;
    step(w);
    expect(w.result?.winner).toBe(Side.Police);
  });
  it('opinion collapse ends the game', () => {
    const w = make();
    w.opinion = 95;
    step(w);
    expect(w.result?.winner).toBe(Side.Demo);
  });
  it('buying costs money and spawns a unit', () => {
    const w = make();
    const before = w.units.length;
    const f = w.funds[Side.Police];
    step(w, [{ t: 'buy', side: Side.Police, kind: Kind.Reiter }]);
    expect(w.units.length).toBe(before + 1);
    expect(w.funds[Side.Police]).toBeLessThan(f);
    // cannot buy other side's units
    step(w, [{ t: 'buy', side: Side.Police, kind: Kind.Kleber }]);
    expect(w.units.length).toBe(before + 1);
  });
});

describe('fog of war', () => {
  it('police do not see demonstrators far away, but see the red zone', () => {
    const w = make();
    const v = w.vis[Side.Police];
    expect(v[55 * w.map.w + 7]).toBe(0); // demo meeting point
    expect(v[20 * w.map.w + 20]).toBe(1); // camera network
  });
});
