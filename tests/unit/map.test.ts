import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/rng';
import { generateCity, walkable } from '../../src/sim/map';
import { findPath, spreadTargets } from '../../src/sim/path';
import { Tile } from '../../src/sim/types';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('stays in range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});

describe('generateCity', () => {
  const map = generateCity(1);
  it('is deterministic', () => {
    const again = generateCity(1);
    expect(Array.from(again.tiles)).toEqual(Array.from(map.tiles));
    expect(Array.from(again.height)).toEqual(Array.from(map.height));
  });
  it('has a connected road network', () => {
    const seen = new Set<number>();
    const stack = [map.roadTiles[0]];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      const x = i % map.w, y = Math.floor(i / map.w);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const ni = ny * map.w + nx;
        if (map.tiles[ni] === Tile.Road) stack.push(ni);
      }
    }
    expect(seen.size).toBe(map.roadTiles.length);
  });
  it('has landmarks on walkable tiles', () => {
    expect(map.tiles[map.policeHQ.y * map.w + map.policeHQ.x]).toBe(Tile.Road);
    expect(map.tiles[map.demoMeet.y * map.w + map.demoMeet.x]).toBe(Tile.Road);
    expect(map.tiles[34 * map.w + 34]).toBe(Tile.Plaza);
    expect(map.junctions.length).toBeGreaterThan(50);
  });
  it('has a river with bridges', () => {
    let water = 0;
    for (let x = 0; x < map.w; x++) if (map.tiles[39 * map.w + x] === Tile.Water) water++;
    expect(water).toBeGreaterThan(40);
    expect(map.tiles[39 * map.w + 7]).toBe(Tile.Road);
  });
});

describe('findPath', () => {
  const map = generateCity(1);
  it('finds a road path between HQ and meeting point', () => {
    const p = findPath(map, map.policeHQ.x, map.policeHQ.y, map.demoMeet.x, map.demoMeet.y, true);
    expect(p).not.toBeNull();
    expect(p!.length).toBe(48); // straight down the x=7 road
    for (const i of p!) expect(walkable(map, i, true)).toBe(true);
  });
  it('never walks through buildings', () => {
    const p = findPath(map, 1, 1, 60, 60, false)!;
    for (const i of p) expect(map.tiles[i]).not.toBe(Tile.Building);
  });
  it('returns null for unreachable goals', () => {
    expect(findPath(map, 1, 1, 7, 40, true)).not.toBeNull(); // bridge is road
    expect(findPath(map, 1, 1, 3, 39, false)).toBeNull(); // water
  });
  it('spreads targets without duplicates', () => {
    const t = spreadTargets(map, 34, 34, 20, false);
    expect(t.length).toBe(20);
    expect(new Set(t).size).toBe(20);
  });
});
