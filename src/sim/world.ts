import { CityMap, generateCity, inRect, walkable } from './map';
import { findPath, nearestWalkable, spreadTargets } from './path';
import { Rng } from './rng';
import { Scenario, scenarioById } from './scenarios';
import {
  ABILITIES,
  Ability,
  BAL,
  Kind,
  PARKED_BURNING,
  PARKED_OK,
  PARKED_WRECK,
  STATS,
  Side,
  Tile,
} from './types';
import { updateTraffic, spawnTraffic, Car } from './traffic';
import { runAI } from './ai';

export enum Work {
  None = 0,
  Arrest = 1,
  Unglue = 2,
  Clear = 3,
  Glue = 4,
  Carblock = 5,
  Load = 6,
}

export interface Unit {
  id: number;
  kind: Kind;
  side: Side;
  x: number;
  y: number;
  fx: number; // facing
  fy: number;
  path: number[];
  sit: boolean;
  glued: boolean;
  arrested: boolean;
  arrestedTicks: number;
  work: number;
  workKind: Work;
  workTarget: number;
  morale: number;
  cargo: number;
  cooldown: number;
  stance: boolean;
  uses: number;
  gone: boolean;
  idleTicks: number;
  aiGoal: number;
}

export interface ParkedCar {
  id: number;
  x: number;
  y: number;
  state: number;
  timer: number;
  color: number;
}

export interface GameEvent {
  k: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  live?: boolean;
  side?: Side;
}

export type Command =
  | { t: 'move'; side: Side; ids: number[]; x: number; y: number }
  | { t: 'ability'; side: Side; ids: number[]; a: Ability }
  | { t: 'buy'; side: Side; kind: Kind };

export interface Result {
  winner: Side;
  reason: string;
}

export interface Stats {
  arrests: number;
  jailed: number;
  injuries: number;
  fires: number;
  sprays: number;
  recruits: number;
  wentHome: number;
  released: number;
  maxJam: number;
  bought: [number, number];
}

export type Difficulty = 'leicht' | 'normal' | 'schwer';

export interface WorldOptions {
  seed: number;
  scenario: string;
  aiSides: [boolean, boolean];
  difficulty?: Difficulty;
  trafficCars?: number;
  passants?: number;
}

export interface World {
  seed: number;
  tick: number;
  rng: Rng;
  map: CityMap;
  scenario: Scenario;
  units: Unit[];
  byId: Map<number, Unit>;
  nextId: number;
  cars: Car[];
  carKeys: Map<number, number>;
  parked: ParkedCar[];
  opinion: number;
  funds: [number, number];
  progress: number;
  objBlocked: number;
  result: Result | null;
  events: GameEvent[];
  vis: [Uint8Array, Uint8Array];
  block: Uint8Array; // traffic-blocking count per tile
  jam: number;
  hotspot: { x: number; y: number; tick: number } | null;
  stats: Stats;
  difficulty: Difficulty;
  aiSides: [boolean, boolean];
  aiPersonality: [number, number];
  passantTarget: number;
}

const DIFF = {
  leicht: { interval: 30, income: 0.75 },
  normal: { interval: 18, income: 1.0 },
  schwer: { interval: 10, income: 1.3 },
};

export const UNIT_CAP: [number, number] = [70, 160];

export function createWorld(opts: WorldOptions): World {
  const map = generateCity(opts.seed);
  const scenario = scenarioById(opts.scenario);
  const rng = new Rng(opts.seed * 7919 + 17);
  const n = map.w * map.h;
  const world: World = {
    seed: opts.seed,
    tick: 0,
    rng,
    map,
    scenario,
    units: [],
    byId: new Map(),
    nextId: 1,
    cars: [],
    carKeys: new Map(),
    parked: [],
    opinion: BAL.startOpinion,
    funds: [scenario.funds[0], scenario.funds[1]],
    progress: 0,
    objBlocked: 0,
    result: null,
    events: [],
    vis: [new Uint8Array(n), new Uint8Array(n)],
    block: new Uint8Array(n),
    jam: 0,
    hotspot: null,
    stats: {
      arrests: 0,
      jailed: 0,
      injuries: 0,
      fires: 0,
      sprays: 0,
      recruits: 0,
      wentHome: 0,
      released: 0,
      maxJam: 0,
      bought: [0, 0],
    },
    difficulty: opts.difficulty ?? 'normal',
    aiSides: opts.aiSides,
    aiPersonality: [rng.next(), rng.next()],
    passantTarget: opts.passants ?? BAL.passants,
  };

  // parked cars on every parking tile (70%)
  for (let i = 0; i < n; i++) {
    if (map.tiles[i] === Tile.Parking && rng.chance(0.7)) {
      world.parked.push({ id: world.nextId++, x: i % map.w, y: Math.floor(i / map.w), state: PARKED_OK, timer: 0, color: rng.int(8) });
    }
  }

  for (const [kind, count] of scenario.police) spawnGroup(world, kind, count, scenario.policeSpawn.x, scenario.policeSpawn.y);
  for (const [kind, count] of scenario.demo) spawnGroup(world, kind, count, scenario.demoSpawn.x, scenario.demoSpawn.y);

  for (let i = 0; i < world.passantTarget; i++) spawnPassant(world);
  for (let i = 0; i < BAL.pressCrews; i++) {
    const t = map.roadTiles[rng.int(map.roadTiles.length)];
    addUnit(world, Kind.Presse, (t % map.w) + 0.5, Math.floor(t / map.w) + 0.5);
  }
  spawnTraffic(world, opts.trafficCars ?? BAL.trafficCars);
  computeBlock(world);
  computeVisibility(world);
  return world;
}

export function addUnit(world: World, kind: Kind, x: number, y: number): Unit {
  const st = STATS[kind];
  const u: Unit = {
    id: world.nextId++,
    kind,
    side: st.side,
    x,
    y,
    fx: 1,
    fy: 0,
    path: [],
    sit: false,
    glued: false,
    arrested: false,
    arrestedTicks: 0,
    work: 0,
    workKind: Work.None,
    workTarget: -1,
    morale: BAL.moraleStart,
    cargo: 0,
    cooldown: 0,
    stance: true,
    uses: kind === Kind.Autotrupp ? 3 : 0,
    gone: false,
    idleTicks: 0,
    aiGoal: -1,
  };
  world.units.push(u);
  world.byId.set(u.id, u);
  return u;
}

function spawnGroup(world: World, kind: Kind, count: number, x: number, y: number) {
  const vehicle = STATS[kind].vehicle;
  const tiles = spreadTargets(world.map, x, y, count + 12, vehicle);
  for (let i = 0; i < count; i++) {
    const t = tiles[(i + world.rng.int(12)) % tiles.length];
    addUnit(world, kind, (t % world.map.w) + 0.3 + world.rng.next() * 0.4, Math.floor(t / world.map.w) + 0.3 + world.rng.next() * 0.4);
  }
}

function spawnPassant(world: World) {
  const { map, rng } = world;
  for (let tries = 0; tries < 50; tries++) {
    const i = rng.int(map.w * map.h);
    const t = map.tiles[i];
    if (t === Tile.Park || t === Tile.Plaza || t === Tile.Grass || t === Tile.Road) {
      addUnit(world, Kind.Passant, (i % map.w) + 0.5, Math.floor(i / map.w) + 0.5);
      return;
    }
  }
}

// ---------------------------------------------------------------- helpers

export const tileOf = (w: World, u: { x: number; y: number }) => Math.floor(u.y) * w.map.w + Math.floor(u.x);
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function activeDemo(u: Unit): boolean {
  return u.side === Side.Demo && !u.gone && !u.arrested;
}

function nearest(world: World, from: Unit, r: number, pred: (u: Unit) => boolean): Unit | null {
  let best: Unit | null = null;
  let bd = r * r;
  for (const u of world.units) {
    if (u === from || u.gone || !pred(u)) continue;
    const d = d2(u, from);
    if (d <= bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

function pressNear(world: World, x: number, y: number): boolean {
  const r2 = BAL.pressRadius * BAL.pressRadius;
  for (const u of world.units) if (u.kind === Kind.Presse && !u.gone && (u.x - x) ** 2 + (u.y - y) ** 2 <= r2) return true;
  return false;
}

/** Shift public opinion. Positive = toward demonstrators. Tripled when a TV crew sees it. */
export function shiftOpinion(world: World, delta: number, x: number, y: number, drama = false) {
  const live = pressNear(world, x, y);
  const v = delta * (live ? BAL.pressMultiplier : 1);
  world.opinion = Math.max(0, Math.min(100, world.opinion + v));
  if (drama) world.hotspot = { x, y, tick: world.tick };
  if (live && Math.abs(delta) >= 0.5) world.events.push({ k: 'live', x, y, live: true });
}

function setPath(world: World, u: Unit, tx: number, ty: number): boolean {
  const vehicle = STATS[u.kind].vehicle;
  let gx = tx;
  let gy = ty;
  const gi = ty * world.map.w + tx;
  if (!walkable(world.map, gi, vehicle)) {
    const alt = nearestWalkable(world.map, tx, ty, vehicle);
    if (alt === null) return false;
    gx = alt % world.map.w;
    gy = Math.floor(alt / world.map.w);
  }
  const p = findPath(world.map, Math.floor(u.x), Math.floor(u.y), gx, gy, vehicle);
  if (!p) return false;
  u.path = p;
  return true;
}

function pushAway(world: World, u: Unit, sx: number, sy: number, dist: number) {
  if (u.glued || u.arrested) return;
  let vx = u.x - sx;
  let vy = u.y - sy;
  const l = Math.hypot(vx, vy) || 1;
  vx /= l;
  vy /= l;
  for (let s = dist; s > 0.2; s -= 0.3) {
    const nx = u.x + vx * s;
    const ny = u.y + vy * s;
    const fx = Math.floor(nx);
    const fy = Math.floor(ny);
    if (fx < 0 || fy < 0 || fx >= world.map.w || fy >= world.map.h) continue;
    if (walkable(world.map, fy * world.map.w + fx, false)) {
      u.x = nx;
      u.y = ny;
      u.path = [];
      u.workKind = Work.None;
      return;
    }
  }
}

function injure(world: World, u: Unit, by: Unit) {
  u.gone = true;
  world.stats.injuries++;
  world.events.push({ k: 'injury', x: u.x, y: u.y });
  shiftOpinion(world, BAL.opInjury, by.x, by.y, true);
}

// ---------------------------------------------------------------- commands

export function applyCommand(world: World, c: Command) {
  if (world.result) return;
  if (c.t === 'buy') return buy(world, c.side, c.kind);
  const units = c.ids
    .map((id) => world.byId.get(id))
    .filter((u): u is Unit => !!u && !u.gone && u.side === c.side && !u.arrested)
    .sort((a, b) => a.id - b.id);
  if (units.length === 0) return;
  if (c.t === 'move') {
    const tx = Math.max(0, Math.min(world.map.w - 1, Math.floor(c.x)));
    const ty = Math.max(0, Math.min(world.map.h - 1, Math.floor(c.y)));
    const walkers = units.filter((u) => !u.glued && !STATS[u.kind].vehicle);
    const vehicles = units.filter((u) => !u.glued && STATS[u.kind].vehicle);
    for (const [group, veh] of [
      [walkers, false],
      [vehicles, true],
    ] as [Unit[], boolean][]) {
      if (group.length === 0) continue;
      const targets = spreadTargets(world.map, tx, ty, group.length, veh);
      group.forEach((u, i) => {
        const t = targets[i % Math.max(1, targets.length)];
        if (t === undefined) return;
        u.sit = false;
        u.workKind = Work.None;
        u.work = 0;
        setPath(world, u, t % world.map.w, Math.floor(t / world.map.w));
      });
    }
    return;
  }
  // abilities
  const a = c.a;
  const eligible = units.filter((u) => ABILITIES[u.kind]?.includes(a));
  if (a === 'sit') {
    const pool = eligible.filter((u) => !u.glued);
    const anyStanding = pool.some((u) => !u.sit);
    for (const u of pool) {
      u.sit = anyStanding;
      u.path = [];
      u.workKind = Work.None;
    }
  } else if (a === 'stance') {
    const anyOff = eligible.some((u) => !u.stance);
    for (const u of eligible) u.stance = anyOff;
  } else if (a === 'glue') {
    for (const u of eligible) {
      if (u.glued) continue;
      if (world.map.tiles[tileOf(world, u)] !== Tile.Road) continue;
      u.path = [];
      u.workKind = Work.Glue;
      u.work = 0;
    }
  } else if (a === 'carblock') {
    for (const u of eligible) {
      if (u.uses <= 0 || world.map.tiles[tileOf(world, u)] !== Tile.Road) continue;
      const car = nearestParked(world, u, 2.6, (p) => p.state === PARKED_OK && world.map.tiles[p.y * world.map.w + p.x] !== Tile.Road);
      if (!car) continue;
      u.path = [];
      u.workKind = Work.Carblock;
      u.workTarget = car.id;
      u.work = 0;
    }
  } else if (a === 'burn') {
    for (const u of eligible) {
      const car = nearestParked(world, u, 1.9, (p) => p.state === PARKED_OK);
      if (!car) continue;
      car.state = PARKED_BURNING;
      car.timer = BAL.burnTicks;
      world.stats.fires++;
      world.events.push({ k: 'fire', x: car.x + 0.5, y: car.y + 0.5 });
      shiftOpinion(world, BAL.opBurn, car.x + 0.5, car.y + 0.5, true);
    }
  } else if (a === 'megaphone') {
    for (const u of eligible) {
      if (u.cooldown > 0) continue;
      u.cooldown = BAL.megaphoneCooldown;
      world.events.push({ k: 'megaphone', x: u.x, y: u.y });
      shiftOpinion(world, BAL.opMegaphone, u.x, u.y, true);
      let recruited = 0;
      for (const o of world.units) {
        if (o.gone || d2(o, u) > 25) continue;
        if (o.side === Side.Demo) o.morale = Math.min(100, o.morale + 25);
        else if (o.kind === Kind.Passant && recruited < 3 && world.opinion >= 35) {
          recruit(world, o);
          recruited++;
        }
      }
    }
  }
}

function nearestParked(world: World, u: Unit, r: number, pred: (p: ParkedCar) => boolean): ParkedCar | null {
  let best: ParkedCar | null = null;
  let bd = r * r;
  for (const p of world.parked) {
    if (!pred(p)) continue;
    const d = (p.x + 0.5 - u.x) ** 2 + (p.y + 0.5 - u.y) ** 2;
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function recruit(world: World, passant: Unit) {
  passant.gone = true;
  const nu = addUnit(world, Kind.Demonstrant, passant.x, passant.y);
  nu.morale = 60;
  world.stats.recruits++;
  world.events.push({ k: 'recruit', x: passant.x, y: passant.y });
}

function countSide(world: World, side: Side): number {
  let n = 0;
  for (const u of world.units) if (u.side === side && !u.gone && !u.arrested) n++;
  return n;
}

function buy(world: World, side: Side, kind: Kind) {
  const st = STATS[kind];
  if (!st || st.side !== side || side === Side.Neutral) return;
  if (world.funds[side] < st.cost) return;
  if (countSide(world, side) >= UNIT_CAP[side]) return;
  world.funds[side] -= st.cost;
  world.stats.bought[side]++;
  const sp = side === Side.Police ? world.scenario.policeSpawn : world.scenario.demoSpawn;
  spawnGroup(world, kind, 1, sp.x, sp.y);
  world.events.push({ k: 'buy', x: sp.x, y: sp.y, side });
}

// ---------------------------------------------------------------- simulation step

export function step(world: World, commands: Command[] = []) {
  world.events = [];
  if (world.result) return;
  for (const c of commands) applyCommand(world, c);

  const diff = DIFF[world.difficulty];
  for (const side of [Side.Police, Side.Demo] as const) {
    if (world.aiSides[side] && (world.tick + side * 5) % diff.interval === 0) {
      for (const c of runAI(world, side)) applyCommand(world, c);
    }
  }

  for (const u of world.units) {
    if (u.gone) continue;
    if (u.cooldown > 0) u.cooldown--;
    moveUnit(world, u);
    if (u.side === Side.Police) policeBehaviour(world, u);
    else if (u.side === Side.Demo) demoBehaviour(world, u);
    else neutralBehaviour(world, u);
  }

  updateParked(world);
  computeBlock(world);
  updateTraffic(world);
  if (world.jam > world.stats.maxJam) world.stats.maxJam = world.jam;

  if (world.tick % 10 === 0) {
    // economy + opinion drift, once per second
    const o = world.opinion;
    const incP = (0.6 + (100 - o) / 80) * (world.aiSides[Side.Police] ? diff.income : 1);
    const incD = (0.5 + o / 80) * (world.aiSides[Side.Demo] ? diff.income : 1);
    world.funds[Side.Police] += incP;
    world.funds[Side.Demo] += incD;
    world.opinion = Math.max(0, Math.min(100, world.opinion + BAL.opJamPerCarPerSec * world.jam + (50 - o) * BAL.opDriftPerSec * 0.02));
    // keep passants topped up
    let p = 0;
    for (const u of world.units) if (u.kind === Kind.Passant && !u.gone) p++;
    if (p < world.passantTarget * 0.6) spawnPassant(world);
    updateObjective(world);
  }
  if (world.tick % 5 === 0) computeVisibility(world);

  // remove gone units
  if (world.units.some((u) => u.gone)) {
    world.units = world.units.filter((u) => {
      if (u.gone) world.byId.delete(u.id);
      return !u.gone;
    });
  }
  world.tick++;
  checkResult(world);
}

function moveUnit(world: World, u: Unit) {
  if (u.path.length === 0) {
    u.idleTicks++;
    return;
  }
  if (u.arrested || u.glued || u.sit || u.workKind !== Work.None) return;
  u.idleTicks = 0;
  const next = u.path[0];
  const tx = (next % world.map.w) + 0.5;
  const ty = Math.floor(next / world.map.w) + 0.5;
  const dx = tx - u.x;
  const dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  let speed = STATS[u.kind].speed;
  if (u.side === Side.Demo && u.morale < 30) speed *= 0.8;
  if (dist <= speed) {
    u.x = tx;
    u.y = ty;
    u.path.shift();
  } else {
    u.x += (dx / dist) * speed;
    u.y += (dy / dist) * speed;
  }
  if (dist > 0.001) {
    u.fx = dx / dist;
    u.fy = dy / dist;
  }
}

function policeBehaviour(world: World, u: Unit) {
  const k = u.kind;
  if (k === Kind.Polizist || k === Kind.Bereitschaft) {
    if (u.workKind === Work.Arrest) {
      const t = world.byId.get(u.workTarget);
      if (!t || t.gone || t.arrested || t.glued || d2(t, u) > 2.6) {
        u.workKind = Work.None;
        return;
      }
      u.work++;
      const need = k === Kind.Bereitschaft ? BAL.arrestTicksRiot : t.sit ? BAL.arrestTicksSitting : BAL.arrestTicks;
      if (u.work >= need) {
        u.workKind = Work.None;
        t.arrested = true;
        t.sit = false;
        t.path = [];
        t.workKind = Work.None;
        t.arrestedTicks = 0;
        world.stats.arrests++;
        world.events.push({ k: 'arrest', x: t.x, y: t.y });
        const violent = t.kind === Kind.Autotrupp;
        shiftOpinion(world, violent ? BAL.opArrestViolent : t.sit ? BAL.opArrestPeaceful : BAL.opArrestPeaceful * 0.5, t.x, t.y, true);
        for (const o of world.units) if (o.side === Side.Demo && !o.gone && d2(o, t) < 16) o.morale -= 4;
      }
      return;
    }
    if (u.workKind === Work.Clear) {
      const car = world.parked.find((p) => p.id === u.workTarget);
      if (!car || car.state === PARKED_BURNING || (car.x + 0.5 - u.x) ** 2 + (car.y + 0.5 - u.y) ** 2 > 3.5) {
        u.workKind = Work.None;
        return;
      }
      u.work += k === Kind.Bereitschaft ? 2 : 1;
      if (u.work >= BAL.clearBarrierTicks) {
        world.parked = world.parked.filter((p) => p !== car);
        u.workKind = Work.None;
        world.events.push({ k: 'clear', x: car.x + 0.5, y: car.y + 0.5 });
      }
      return;
    }
    if (!u.stance || u.path.length > 0) return;
    const target = nearest(world, u, 1.5, (o) => activeDemo(o) && !o.glued);
    if (target) {
      u.workKind = Work.Arrest;
      u.workTarget = target.id;
      u.work = 0;
      u.fx = target.x - u.x;
      u.fy = target.y - u.y;
      return;
    }
    const car = nearestParked(world, u, 1.8, (p) => p.state !== PARKED_BURNING && world.map.tiles[p.y * world.map.w + p.x] === Tile.Road);
    if (car) {
      u.workKind = Work.Clear;
      u.workTarget = car.id;
      u.work = 0;
      return;
    }
    // engage demonstrators close by
    if (u.idleTicks % 10 === 5) {
      const near = nearest(world, u, 3.5, (o) => activeDemo(o) && !o.glued);
      if (near) setPath(world, u, Math.floor(near.x), Math.floor(near.y));
    }
    return;
  }
  if (k === Kind.Reiter) {
    if (!u.stance) return;
    if (u.cooldown === 0) {
      let hit = false;
      for (const o of world.units) {
        if (!activeDemo(o) || o.glued || d2(o, u) > 2.6) continue;
        hit = true;
        o.morale -= o.sit ? 5 : 12;
        if (!o.sit) pushAway(world, o, u.x, u.y, 1.3);
        if (world.rng.chance(0.03)) injure(world, o, u);
      }
      if (hit) {
        u.cooldown = BAL.horseInterval;
        world.events.push({ k: 'horse', x: u.x, y: u.y });
        world.hotspot = { x: u.x, y: u.y, tick: world.tick };
      }
    }
    if (u.path.length === 0 && u.idleTicks % 10 === 3) {
      const near = nearest(world, u, 5, (o) => activeDemo(o) && !o.glued && !o.sit);
      if (near) setPath(world, u, Math.floor(near.x), Math.floor(near.y));
    }
    return;
  }
  if (k === Kind.Wasserwerfer) {
    if (!u.stance || u.cooldown > 0 || u.path.length > 0) return;
    const r = BAL.sprayRange;
    const fire = nearestParked(world, u, r, (p) => p.state === PARKED_BURNING);
    if (fire) {
      u.cooldown = BAL.sprayInterval;
      fire.state = PARKED_WRECK;
      fire.timer = 0;
      world.stats.sprays++;
      world.events.push({ k: 'spray', x: u.x, y: u.y, x2: fire.x + 0.5, y2: fire.y + 0.5 });
      world.events.push({ k: 'extinguish', x: fire.x + 0.5, y: fire.y + 0.5 });
      shiftOpinion(world, BAL.opExtinguish, fire.x + 0.5, fire.y + 0.5, true);
      return;
    }
    const target = nearest(world, u, r, (o) => activeDemo(o));
    if (!target) return;
    let crowd = 0;
    for (const o of world.units) if (activeDemo(o) && d2(o, target) < 2.6) crowd++;
    if (crowd < 2) return;
    u.cooldown = BAL.sprayInterval;
    world.stats.sprays++;
    u.fx = target.x - u.x;
    u.fy = target.y - u.y;
    world.events.push({ k: 'spray', x: u.x, y: u.y, x2: target.x, y2: target.y });
    for (const o of world.units) {
      if (o.gone || d2(o, target) > 2.6) continue;
      if (o.side === Side.Demo && !o.arrested) {
        o.morale -= o.sit || o.glued ? 10 : 22;
        if (!o.sit) pushAway(world, o, u.x, u.y, 1.6);
        if (world.rng.chance(0.02)) injure(world, o, u);
      } else if (o.kind === Kind.Passant) {
        pushAway(world, o, u.x, u.y, 2);
      }
    }
    shiftOpinion(world, BAL.opSpray, u.x, u.y, true);
    return;
  }
  if (k === Kind.Transporter) {
    if (u.workKind === Work.Load) {
      const t = world.byId.get(u.workTarget);
      if (!t || t.gone || !t.arrested || d2(t, u) > 4) {
        u.workKind = Work.None;
        return;
      }
      if (++u.work >= BAL.loadTicks) {
        t.gone = true;
        u.cargo++;
        u.workKind = Work.None;
      }
      return;
    }
    const hq = world.scenario.policeSpawn;
    if (u.cargo > 0 && (u.x - hq.x - 0.5) ** 2 + (u.y - hq.y - 0.5) ** 2 < 6) {
      world.stats.jailed += u.cargo;
      world.events.push({ k: 'jail', x: u.x, y: u.y });
      u.cargo = 0;
      return;
    }
    if (u.path.length > 0) return;
    if (u.cargo >= BAL.transporterCapacity) {
      setPath(world, u, hq.x, hq.y);
      return;
    }
    const t = nearest(world, u, 1.9, (o) => o.side === Side.Demo && o.arrested);
    if (t) {
      u.workKind = Work.Load;
      u.workTarget = t.id;
      u.work = 0;
      return;
    }
    if (u.idleTicks % 10 === 7) {
      const far = nearest(world, u, 6, (o) => o.side === Side.Demo && o.arrested);
      if (far) setPath(world, u, Math.floor(far.x), Math.floor(far.y));
      else if (u.cargo > 0 && u.idleTicks > 300) setPath(world, u, hq.x, hq.y);
    }
    return;
  }
  if (k === Kind.Loesetrupp) {
    if (u.workKind === Work.Unglue) {
      const t = world.byId.get(u.workTarget);
      if (!t || t.gone || !t.glued || d2(t, u) > 2.6) {
        u.workKind = Work.None;
        return;
      }
      if (++u.work >= BAL.ungluedTicks) {
        t.glued = false;
        t.sit = true;
        u.workKind = Work.None;
        world.events.push({ k: 'unglue', x: t.x, y: t.y });
      }
      return;
    }
    if (u.path.length > 0) return;
    const t = nearest(world, u, 1.5, (o) => o.side === Side.Demo && o.glued);
    if (t) {
      u.workKind = Work.Unglue;
      u.workTarget = t.id;
      u.work = 0;
      return;
    }
    if (u.idleTicks % 10 === 1) {
      const far = nearest(world, u, 6, (o) => o.side === Side.Demo && o.glued);
      if (far) setPath(world, u, Math.floor(far.x), Math.floor(far.y));
    }
  }
}

function demoBehaviour(world: World, u: Unit) {
  if (u.arrested) {
    if (++u.arrestedTicks > BAL.releaseTicks) {
      u.arrested = false;
      u.morale = 35;
      world.stats.released++;
      world.events.push({ k: 'release', x: u.x, y: u.y });
    }
    return;
  }
  if (u.workKind === Work.Glue) {
    if (++u.work >= BAL.glueTicks) {
      u.glued = true;
      u.sit = true;
      u.workKind = Work.None;
      world.events.push({ k: 'glue', x: u.x, y: u.y });
      world.hotspot = { x: u.x, y: u.y, tick: world.tick };
    }
    return;
  }
  if (u.workKind === Work.Carblock) {
    const car = world.parked.find((p) => p.id === u.workTarget);
    if (!car || car.state !== PARKED_OK) {
      u.workKind = Work.None;
      return;
    }
    if (++u.work >= BAL.carblockTicks) {
      car.x = Math.floor(u.x);
      car.y = Math.floor(u.y);
      u.uses--;
      u.workKind = Work.None;
      // step aside so the car fits
      pushAway(world, u, u.x + 0.3, u.y + 0.3, 1);
      world.events.push({ k: 'carblock', x: car.x + 0.5, y: car.y + 0.5 });
      shiftOpinion(world, BAL.opCarblock, car.x + 0.5, car.y + 0.5, true);
    }
    return;
  }
  // morale
  if (u.morale < 80) u.morale += 0.02;
  if (u.kind === Kind.Organisator) {
    for (const o of world.units) if (o.side === Side.Demo && !o.gone && o.morale < 100 && d2(o, u) < 16) o.morale += 0.04;
    if (world.tick % BAL.recruitInterval === 0 && world.opinion >= 40) {
      const p = nearest(world, u, 4, (o) => o.kind === Kind.Passant);
      if (p) recruit(world, p);
    }
  }
  if (u.morale < BAL.moraleHome && !u.glued) {
    u.gone = true;
    world.stats.wentHome++;
    world.events.push({ k: 'home', x: u.x, y: u.y });
  }
}

function neutralBehaviour(world: World, u: Unit) {
  if (u.kind === Kind.Passant) {
    if (u.path.length === 0 && world.rng.chance(0.015)) {
      const tx = Math.floor(u.x) + world.rng.int(13) - 6;
      const ty = Math.floor(u.y) + world.rng.int(13) - 6;
      if (tx >= 0 && ty >= 0 && tx < world.map.w && ty < world.map.h && walkable(world.map, ty * world.map.w + tx, false)) setPath(world, u, tx, ty);
    }
    return;
  }
  // press: follow the drama
  if ((world.tick + u.id) % 60 !== 0) return;
  let target: { x: number; y: number } | null = null;
  if (world.hotspot && world.tick - world.hotspot.tick < 400) target = world.hotspot;
  else {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const o of world.units)
      if (activeDemo(o)) {
        sx += o.x;
        sy += o.y;
        n++;
      }
    if (n > 0) target = { x: sx / n, y: sy / n };
  }
  if (!target) return;
  if ((target.x - u.x) ** 2 + (target.y - u.y) ** 2 < 9) return;
  const off = u.id % 2 === 0 ? 2 : -2;
  setPath(world, u, Math.floor(target.x) + off, Math.floor(target.y) + 1);
}

function updateParked(world: World) {
  for (const p of world.parked) {
    if (p.state === PARKED_BURNING) {
      if (--p.timer <= 0) p.state = PARKED_WRECK;
      else if (p.timer % 30 === 0) world.hotspot = { x: p.x + 0.5, y: p.y + 0.5, tick: world.tick };
    }
  }
}

export function computeBlock(world: World) {
  const b = world.block;
  b.fill(0);
  const w = world.map.w;
  for (const u of world.units) {
    if (!activeDemo(u)) continue;
    const i = Math.floor(u.y) * w + Math.floor(u.x);
    if (b[i] < 255) b[i]++;
  }
  for (const p of world.parked) {
    const i = p.y * w + p.x;
    if (world.map.tiles[i] === Tile.Road) b[i] = Math.min(255, b[i] + 5);
  }
}

export function computeVisibility(world: World) {
  const { map } = world;
  for (const side of [Side.Police, Side.Demo] as const) {
    const v = world.vis[side];
    v.fill(0);
    for (const u of world.units) {
      if (u.side !== side || u.gone || u.arrested) continue;
      const r = STATS[u.kind].sight;
      const cx = Math.floor(u.x);
      const cy = Math.floor(u.y);
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= map.h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= map.w || dx * dx + dy * dy > r * r) continue;
          v[y * map.w + x] = 1;
        }
      }
    }
    if (side === Side.Police) {
      // camera network in the government quarter and on the town hall square
      for (const r of [map.redZone, map.plaza])
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) v[y * map.w + x] = 1;
    }
  }
}

function updateObjective(world: World) {
  const o = world.scenario.objective;
  const { map } = world;
  if (o.type === 'blockade') {
    let blocked = 0;
    for (const p of o.points) {
      let hit = false;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const i = (p.y + dy) * map.w + p.x + dx;
        if (map.tiles[i] === Tile.Road && world.block[i] > 0) hit = true;
      }
      if (hit) blocked++;
    }
    world.objBlocked = blocked;
    world.progress = Math.min(o.target, world.progress + blocked);
  } else {
    let inside = 0;
    for (const u of world.units) if (activeDemo(u) && inRect(o.rect, Math.floor(u.x), Math.floor(u.y))) inside++;
    world.objBlocked = inside;
    if (inside >= o.count) world.progress = Math.min(o.holdTicks, world.progress + 10);
  }
}

export function objectiveTarget(world: World): number {
  const o = world.scenario.objective;
  return o.type === 'blockade' ? o.target : o.holdTicks;
}

function checkResult(world: World) {
  if (world.result) return;
  if (world.progress >= objectiveTarget(world)) world.result = { winner: Side.Demo, reason: 'objective' };
  else if (world.opinion >= 92) world.result = { winner: Side.Demo, reason: 'opinion' };
  else if (world.opinion <= 8) world.result = { winner: Side.Police, reason: 'opinion' };
  else if (world.tick >= world.scenario.durationTicks) world.result = { winner: Side.Police, reason: 'time' };
  else if (world.tick % 10 === 0) {
    const demos = world.units.some((u) => activeDemo(u));
    if (!demos && world.funds[Side.Demo] < STATS[Kind.Demonstrant].cost) world.result = { winner: Side.Police, reason: 'dispersed' };
  }
  if (world.result) world.events.push({ k: 'end', x: 0, y: 0, side: world.result.winner });
}

/** FNV-1a hash over the full relevant state – used by replay regression tests. */
export function hashWorld(world: World): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };
  mix(world.tick);
  mix(Math.round(world.opinion * 1000));
  mix(Math.round(world.funds[0] * 100));
  mix(Math.round(world.funds[1] * 100));
  mix(world.progress);
  for (const u of world.units) {
    mix(u.id);
    mix(u.kind);
    mix(Math.round(u.x * 1000));
    mix(Math.round(u.y * 1000));
    mix((u.sit ? 1 : 0) | (u.glued ? 2 : 0) | (u.arrested ? 4 : 0));
    mix(Math.round(u.morale * 100));
  }
  for (const c of world.cars) {
    mix(c.id);
    mix(c.cx * 100 + c.cy);
    mix(Math.round(c.t * 1000));
  }
  for (const p of world.parked) {
    mix(p.id);
    mix(p.x * 100 + p.y);
    mix(p.state);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
