import { Rng } from './rng';
import { District, Tile } from './types';

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number; // inclusive
}

export interface Point {
  x: number;
  y: number;
}

export interface CityMap {
  w: number;
  h: number;
  tiles: Uint8Array;
  height: Uint8Array; // building floors
  variant: Uint8Array; // visual variation
  district: Uint8Array;
  policeHQ: Point; // road tile in front of the police headquarters
  demoMeet: Point; // road tile at the demonstrators' meeting point
  plaza: Rect; // Rathausplatz
  redZone: Rect; // summit security zone
  junctions: Point[];
  roadTiles: number[];
}

export const ROAD_SPACING = 6;

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

export function districtAt(x: number, y: number): District {
  const dx = x - 34;
  const dy = y - 34;
  if (dx * dx + dy * dy < 100) return District.Altstadt;
  if (x < 32 && y < 32) return District.Regierungsviertel;
  if (x >= 32 && y < 32) return District.Geschaeftsviertel;
  if (x < 32) return District.Wohngebiet;
  return District.Industriegebiet;
}

function isRoadLine(v: number, max: number): boolean {
  return v >= 1 && v <= max - 3 && v % ROAD_SPACING === 1;
}

/** Builds the fictional city "Neustadt". Fully deterministic for a given seed. */
export function generateCity(seed: number, w = 64, h = 64): CityMap {
  const rng = new Rng(seed ^ 0x51a7);
  const n = w * h;
  const tiles = new Uint8Array(n);
  const height = new Uint8Array(n);
  const variant = new Uint8Array(n);
  const district = new Uint8Array(n);
  const plaza: Rect = { x0: 32, y0: 32, x1: 36, y1: 36 };
  const redZone: Rect = { x0: 14, y0: 14, x1: 24, y1: 24 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      district[i] = districtAt(x, y);
      variant[i] = rng.int(256);
      const road = isRoadLine(x, w) && y >= 1 && y <= h - 3;
      const roadH = isRoadLine(y, h) && x >= 1 && x <= w - 3;
      if (road || roadH) {
        tiles[i] = Tile.Road;
        continue;
      }
      if (y === 39 || y === 40) {
        tiles[i] = Tile.Water;
        continue;
      }
      if (y === 38 || y === 41) {
        tiles[i] = Tile.Park;
        continue;
      }
      if (inRect(plaza, x, y)) {
        tiles[i] = Tile.Plaza;
        continue;
      }
      if (x < 1 || y < 1 || x > w - 3 || y > h - 3) {
        tiles[i] = Tile.Grass;
        continue;
      }
      tiles[i] = Tile.Building;
    }
  }

  // Per block: parks, parking spaces and building heights.
  for (let by = 2; by < h - 2; by += ROAD_SPACING) {
    for (let bx = 2; bx < w - 2; bx += ROAD_SPACING) {
      const d = districtAt(bx + 2, by + 2);
      const makePark = rng.chance(d === District.Wohngebiet ? 0.18 : 0.08);
      for (let y = by; y < by + 5 && y < h; y++) {
        for (let x = bx; x < bx + 5 && x < w; x++) {
          const i = y * w + x;
          if (tiles[i] !== Tile.Building) continue;
          if (makePark) {
            tiles[i] = Tile.Park;
            continue;
          }
          if (rng.chance(0.08)) {
            tiles[i] = Tile.Grass;
            continue;
          }
          height[i] = floorsFor(d, rng);
        }
      }
      // parking strip on the block edge along the road
      if (!makePark && rng.chance(0.45)) {
        const edge = rng.int(4);
        for (let k = 0; k < 5; k++) {
          const x = edge === 0 ? bx + k : edge === 1 ? bx + 4 : edge === 2 ? bx + k : bx;
          const y = edge === 0 ? by : edge === 1 ? by + k : edge === 2 ? by + 4 : by + k;
          if (x >= w || y >= h) continue;
          const i = y * w + x;
          if (tiles[i] === Tile.Building || tiles[i] === Tile.Grass) {
            tiles[i] = Tile.Parking;
            height[i] = 0;
          }
        }
      }
    }
  }

  // Summit venue: tall government building inside the red zone
  for (let y = 14; y <= 18; y++) {
    for (let x = 20; x <= 24; x++) {
      const i = y * w + x;
      if (tiles[i] !== Tile.Road) {
        tiles[i] = Tile.Building;
        height[i] = 7;
        variant[i] = 250;
      }
    }
  }

  const junctions: Point[] = [];
  const roadTiles: number[] = [];
  for (let i = 0; i < n; i++) if (tiles[i] === Tile.Road) roadTiles.push(i);
  for (let y = 1; y < h; y += ROAD_SPACING)
    for (let x = 1; x < w; x += ROAD_SPACING) if (tiles[y * w + x] === Tile.Road) junctions.push({ x, y });

  return {
    w,
    h,
    tiles,
    height,
    variant,
    district,
    policeHQ: { x: 7, y: 7 },
    demoMeet: { x: 7, y: 55 },
    plaza,
    redZone,
    junctions,
    roadTiles,
  };
}

function floorsFor(d: District, rng: Rng): number {
  switch (d) {
    case District.Geschaeftsviertel:
      return 4 + rng.int(6);
    case District.Altstadt:
      return 2 + rng.int(3);
    case District.Regierungsviertel:
      return 3 + rng.int(4);
    case District.Wohngebiet:
      return 1 + rng.int(3);
    default:
      return 1 + rng.int(2);
  }
}

export function walkable(map: CityMap, i: number, vehicle: boolean): boolean {
  const t = map.tiles[i];
  if (vehicle) return t === Tile.Road || t === Tile.Plaza || t === Tile.Parking;
  return t !== Tile.Building && t !== Tile.Water;
}

export function inBounds(map: CityMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}
