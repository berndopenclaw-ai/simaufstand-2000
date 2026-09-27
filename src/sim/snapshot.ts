import { carPos } from './traffic';
import { BAL, Kind, Side } from './types';
import { GameEvent, Result, Stats, Work, World, objectiveTarget, tileOf } from './world';

export const F_SIT = 1;
export const F_GLUED = 2;
export const F_ARRESTED = 4;
export const F_WORKING = 8;
export const F_STANCE_OFF = 16;

export interface SnapUnit {
  id: number;
  k: Kind;
  s: Side;
  x: number;
  y: number;
  fx: number;
  fy: number;
  f: number;
  m: number; // morale
  c: number; // cargo / uses
  w: number; // work progress 0..1
  cd: number; // cooldown 0..1
}

export interface SnapCar {
  id: number;
  x: number;
  y: number;
  d: number;
  c: number;
}

export interface SnapParked {
  id: number;
  x: number;
  y: number;
  st: number;
  c: number;
}

export interface Snapshot {
  tick: number;
  duration: number;
  opinion: number;
  funds: [number, number];
  progress: number;
  target: number;
  objBlocked: number;
  jam: number;
  result: Result | null;
  units: SnapUnit[];
  cars: SnapCar[];
  parked: SnapParked[];
  events: GameEvent[];
  vis: Uint8Array;
  stats: Stats;
  playerSide: Side;
}

function workNeed(u: World['units'][number]): number {
  switch (u.workKind) {
    case Work.Arrest:
      return u.kind === Kind.Bereitschaft ? BAL.arrestTicksRiot : BAL.arrestTicks;
    case Work.Unglue:
      return BAL.ungluedTicks;
    case Work.Clear:
      return BAL.clearBarrierTicks / (u.kind === Kind.Bereitschaft ? 2 : 1);
    case Work.Glue:
      return BAL.glueTicks;
    case Work.Carblock:
      return BAL.carblockTicks;
    case Work.Load:
      return BAL.loadTicks;
    default:
      return 1;
  }
}

let full: Uint8Array | null = null;
const FULL = (w: World) => (full && full.length === w.vis[0].length ? full : (full = new Uint8Array(w.vis[0].length).fill(1)));

/** Builds what the player may see: own and neutral units always, enemies only inside the fog-free area. */
export function makeSnapshot(world: World, playerSide: Side.Police | Side.Demo, events: GameEvent[], reveal = false): Snapshot {
  const vis = reveal ? FULL(world) : world.vis[playerSide];
  const units: SnapUnit[] = [];
  for (const u of world.units) {
    if (u.gone) continue;
    if (u.side !== playerSide && u.side !== Side.Neutral && !vis[tileOf(world, u)] && !world.result) continue;
    units.push({
      id: u.id,
      k: u.kind,
      s: u.side,
      x: u.x,
      y: u.y,
      fx: u.fx,
      fy: u.fy,
      f: (u.sit ? F_SIT : 0) | (u.glued ? F_GLUED : 0) | (u.arrested ? F_ARRESTED : 0) | (u.workKind !== Work.None ? F_WORKING : 0) | (u.stance ? 0 : F_STANCE_OFF),
      m: u.morale,
      c: u.kind === Kind.Autotrupp ? u.uses : u.cargo,
      w: u.workKind !== Work.None ? Math.min(1, u.work / workNeed(u)) : 0,
      cd: u.kind === Kind.Organisator ? u.cooldown / BAL.megaphoneCooldown : 0,
    });
  }
  const cars: SnapCar[] = world.cars.map((c) => {
    const p = carPos(c);
    return { id: c.id, x: p.x, y: p.y, d: p.dir, c: c.color };
  });
  const parked: SnapParked[] = world.parked.map((p) => ({ id: p.id, x: p.x, y: p.y, st: p.state, c: p.color }));
  return {
    tick: world.tick,
    duration: world.scenario.durationTicks,
    opinion: world.opinion,
    funds: [world.funds[0], world.funds[1]],
    progress: world.progress,
    target: objectiveTarget(world),
    objBlocked: world.objBlocked,
    jam: world.jam,
    result: world.result,
    units,
    cars,
    parked,
    events,
    vis: vis.slice(),
    stats: { ...world.stats, bought: [world.stats.bought[0], world.stats.bought[1]] },
    playerSide,
  };
}
