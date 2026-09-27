import { Tile } from './types';
import type { World } from './world';

export interface Car {
  id: number;
  cx: number;
  cy: number;
  nx: number;
  ny: number;
  t: number;
  speed: number;
  wait: number;
  color: number;
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

export function dirOf(dx: number, dy: number): number {
  if (dx === 1) return 0;
  if (dx === -1) return 1;
  if (dy === 1) return 2;
  return 3;
}

const key = (i: number, dir: number) => i * 4 + dir;

function isRoad(world: World, x: number, y: number) {
  return x >= 0 && y >= 0 && x < world.map.w && y < world.map.h && world.map.tiles[y * world.map.w + x] === Tile.Road;
}

function placeCar(world: World, car: Car | null): Car | null {
  const { map, rng } = world;
  for (let tries = 0; tries < 40; tries++) {
    const i = map.roadTiles[rng.int(map.roadTiles.length)];
    const x = i % map.w;
    const y = Math.floor(i / map.w);
    const d = rng.int(4);
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (!isRoad(world, nx, ny)) continue;
    const ni = ny * map.w + nx;
    const k = key(ni, d);
    if (world.carKeys.has(k) || world.block[ni] > 0 || world.block[i] > 0) continue;
    const c: Car = car ?? { id: world.nextId++, cx: x, cy: y, nx, ny, t: 0, speed: 0.16 + rng.next() * 0.08, wait: 0, color: rng.int(8) };
    c.cx = x;
    c.cy = y;
    c.nx = nx;
    c.ny = ny;
    c.t = rng.next() * 0.9;
    c.wait = 0;
    world.carKeys.set(k, c.id);
    return c;
  }
  return null;
}

export function spawnTraffic(world: World, n: number) {
  for (let i = 0; i < n; i++) {
    const c = placeCar(world, null);
    if (c) world.cars.push(c);
  }
}

export function updateTraffic(world: World) {
  const { map, rng } = world;
  const w = map.w;
  let jam = 0;
  for (const car of world.cars) {
    const curDir = dirOf(car.nx - car.cx, car.ny - car.cy);
    const nIdx = car.ny * w + car.nx;
    if (car.t < 1) {
      if (world.block[nIdx] > 0 && car.t < 0.4) car.wait++;
      else {
        car.t = Math.min(1, car.t + car.speed);
        car.wait = 0;
      }
    } else {
      // arrived at (nx, ny): choose the next tile
      const opts: number[] = [];
      for (let d = 0; d < 4; d++) {
        const x = car.nx + DX[d];
        const y = car.ny + DY[d];
        if (!isRoad(world, x, y)) continue;
        if (x === car.cx && y === car.cy && car.wait < 60) continue; // no U-turn unless stuck
        opts.push(d);
      }
      // prefer driving straight on
      opts.sort((a, b) => (a === curDir ? -1 : 0) - (b === curDir ? -1 : 0));
      if (opts.length > 1 && opts[0] === curDir && rng.chance(0.45)) {
        const j = 1 + rng.int(opts.length - 1);
        [opts[0], opts[j]] = [opts[j], opts[0]];
      }
      let moved = false;
      for (const d of opts) {
        const x = car.nx + DX[d];
        const y = car.ny + DY[d];
        const i = y * w + x;
        const k = key(i, d);
        if (world.carKeys.has(k) || world.block[i] > 0) continue;
        world.carKeys.delete(key(nIdx, curDir));
        world.carKeys.set(k, car.id);
        car.cx = car.nx;
        car.cy = car.ny;
        car.nx = x;
        car.ny = y;
        car.t = 0;
        car.wait = 0;
        moved = true;
        break;
      }
      if (!moved) car.wait++;
    }
    if (car.wait > 5) jam++;
    if (car.wait > 400) {
      // driver gives up and takes another route (respawn elsewhere)
      world.carKeys.delete(key(nIdx, curDir));
      if (!placeCar(world, car)) {
        world.carKeys.set(key(nIdx, curDir), car.id);
        car.wait = 0;
      }
    }
  }
  world.jam = jam;
}

/** World-space position of a car including lane offset (right-hand traffic). */
export function carPos(car: Car): { x: number; y: number; dir: number } {
  const dx = car.nx - car.cx;
  const dy = car.ny - car.cy;
  const x = car.cx + dx * car.t + 0.5 - dy * 0.22;
  const y = car.cy + dy * car.t + 0.5 + dx * 0.22;
  return { x, y, dir: dirOf(dx, dy) };
}
