import { Point } from './map';
import { objectivePoints } from './scenarios';
import { BAL, Kind, PARKED_BURNING, PARKED_OK, STATS, Side, Tile } from './types';
import type { Command, Unit, World } from './world';

/**
 * Utility-style AI. Plays by the same rules as the player: it only sees what
 * its own units see (plus the objective points, which both sides know).
 */
export function runAI(world: World, side: Side): Command[] {
  return side === Side.Demo ? demoAI(world) : policeAI(world);
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const isIdle = (u: Unit) => u.path.length === 0 && u.workKind === 0 && !u.arrested && !u.gone;
const tileIdx = (w: World, p: { x: number; y: number }) => Math.floor(p.y) * w.map.w + Math.floor(p.x);

function visibleTo(world: World, side: Side.Police | Side.Demo, u: Unit) {
  return world.vis[side][tileIdx(world, u)] === 1;
}

function objectiveGoals(world: World): Point[] {
  const o = world.scenario.objective;
  if (o.type === 'blockade') return o.points;
  // spread goals over the target rectangle
  const r = o.rect;
  const pts: Point[] = [];
  for (let y = r.y0 + 1; y <= r.y1 - 1; y += 3) for (let x = r.x0 + 1; x <= r.x1 - 1; x += 3) pts.push({ x, y });
  return pts;
}

function buyCmd(side: Side, kind: Kind): Command {
  return { t: 'buy', side, kind };
}

function moveCmd(side: Side, u: Unit, x: number, y: number): Command {
  u.aiGoal = y * 1000 + x;
  return { t: 'move', side, ids: [u.id], x, y };
}

// ------------------------------------------------------------------ demonstrators

function demoAI(world: World): Command[] {
  const cmds: Command[] = [];
  const side = Side.Demo;
  const mine = world.units.filter((u) => u.side === side && !u.gone && !u.arrested);
  const police = world.units.filter((u) => u.side === Side.Police && !u.gone && visibleTo(world, side, u));
  const aggressive = world.aiPersonality[1] > 0.55;
  const goals = objectiveGoals(world);
  const objType = world.scenario.objective.type;

  // --- buying
  let funds = world.funds[side];
  const count = (k: Kind) => mine.filter((u) => u.kind === k).length;
  for (let n = 0; n < 3; n++) {
    let want: Kind = Kind.Demonstrant;
    if (count(Kind.Organisator) < 2 && funds >= STATS[Kind.Organisator].cost + 10) want = Kind.Organisator;
    else if (objType === 'blockade' && count(Kind.Kleber) < goals.length * 2) want = Kind.Kleber;
    else if (aggressive && count(Kind.Autotrupp) < 2 && world.opinion > 45) want = Kind.Autotrupp;
    if (funds < STATS[want].cost) break;
    funds -= STATS[want].cost;
    cmds.push(buyCmd(side, want));
  }

  // --- objective pressure: how many demonstrators near each goal
  const load = goals.map((g) => mine.filter((u) => d2(u, { x: g.x + 0.5, y: g.y + 0.5 }) < 12).length);
  const pickGoal = (u: Unit, kind?: Kind) => {
    let best = 0;
    let bestScore = Infinity;
    goals.forEach((g, i) => {
      let l = load[i];
      if (kind !== undefined) l = mine.filter((o) => o.kind === kind && d2(o, { x: g.x + 0.5, y: g.y + 0.5 }) < 12).length * 5 + l * 0.2;
      const score = l * 30 + Math.sqrt(d2(u, g)) * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    load[best]++;
    return goals[best];
  };

  for (const u of mine) {
    if (!isIdle(u) || u.glued) continue;
    const g = goals.reduce((a, b) => (d2(u, a) < d2(u, b) ? a : b));
    const atGoal = d2(u, { x: g.x + 0.5, y: g.y + 0.5 }) < (objType === 'blockade' ? 5 : 8);
    const policeNear = police.some((p) => d2(p, u) < 20);
    switch (u.kind) {
      case Kind.Kleber: {
        const onRoad = world.map.tiles[tileIdx(world, u)] === Tile.Road;
        if (atGoal && onRoad && d2(u, { x: g.x + 0.5, y: g.y + 0.5 }) < 3) cmds.push({ t: 'ability', side, ids: [u.id], a: 'glue' });
        else if (!atGoal || !onRoad) {
          const tg = pickGoal(u, Kind.Kleber);
          cmds.push(moveCmd(side, u, tg.x, tg.y));
        }
        break;
      }
      case Kind.Organisator: {
        if (u.cooldown === 0) {
          const lowMorale = mine.filter((o) => d2(o, u) < 25 && o.morale < 55).length;
          const passants = world.units.filter((o) => o.kind === Kind.Passant && !o.gone && d2(o, u) < 25).length;
          if (lowMorale >= 2 || passants >= 2) {
            cmds.push({ t: 'ability', side, ids: [u.id], a: 'megaphone' });
            break;
          }
        }
        if (!atGoal) {
          const best = goals[load.indexOf(Math.max(...load))];
          cmds.push(moveCmd(side, u, best.x + 1, best.y + 1));
        }
        break;
      }
      case Kind.Autotrupp: {
        const onRoad = world.map.tiles[tileIdx(world, u)] === Tile.Road;
        const carNear = world.parked.find((p) => p.state === PARKED_OK && (p.x + 0.5 - u.x) ** 2 + (p.y + 0.5 - u.y) ** 2 < 6.5);
        if (aggressive && carNear && policeNear && world.opinion > 55 && world.rng.chance(0.25)) {
          cmds.push({ t: 'ability', side, ids: [u.id], a: 'burn' });
        } else if (atGoal && onRoad && carNear && u.uses > 0 && world.map.tiles[carNear.y * world.map.w + carNear.x] !== Tile.Road) {
          cmds.push({ t: 'ability', side, ids: [u.id], a: 'carblock' });
        } else if (u.uses > 0) {
          // walk to a road tile next to a parked car near the goal
          const target = world.parked
            .filter((p) => p.state === PARKED_OK && world.map.tiles[p.y * world.map.w + p.x] === Tile.Parking && (p.x - g.x) ** 2 + (p.y - g.y) ** 2 < 40)
            .sort((a, b) => (a.x - u.x) ** 2 + (a.y - u.y) ** 2 - ((b.x - u.x) ** 2 + (b.y - u.y) ** 2))[0];
          if (target) {
            const road = roadNeighbour(world, target.x, target.y);
            if (road && tileIdx(world, u) !== road.y * world.map.w + road.x) cmds.push(moveCmd(side, u, road.x, road.y));
          } else if (!atGoal) cmds.push(moveCmd(side, u, g.x, g.y));
        } else if (!atGoal) cmds.push(moveCmd(side, u, g.x, g.y));
        break;
      }
      default: {
        if (atGoal) {
          if (policeNear && !u.sit && world.rng.chance(0.6)) cmds.push({ t: 'ability', side, ids: [u.id], a: 'sit' });
        } else if (!u.sit) {
          const tg = pickGoal(u);
          cmds.push(moveCmd(side, u, tg.x + world.rng.int(3) - 1, tg.y + world.rng.int(3) - 1));
        }
      }
    }
  }
  return cmds;
}

function roadNeighbour(world: World, x: number, y: number): Point | null {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.map.w || ny >= world.map.h) continue;
    if (world.map.tiles[ny * world.map.w + nx] === Tile.Road) return { x: nx, y: ny };
  }
  return null;
}

// ------------------------------------------------------------------ police

function policeAI(world: World): Command[] {
  const cmds: Command[] = [];
  const side = Side.Police;
  const mine = world.units.filter((u) => u.side === side && !u.gone);
  const demos = world.units.filter((u) => u.side === Side.Demo && !u.gone && visibleTo(world, side, u));
  const active = demos.filter((d) => !d.arrested);
  const arrested = demos.filter((d) => d.arrested);
  const glued = active.filter((d) => d.glued);
  const fires = world.parked.filter((p) => p.state === PARKED_BURNING && world.vis[side][p.y * world.map.w + p.x]);
  const hardliner = world.aiPersonality[0] > 0.5;
  const goals = objectivePoints(world.scenario.objective).concat(objectiveGoals(world));
  const count = (k: Kind) => mine.filter((u) => u.kind === k).length;

  // --- buying
  let funds = world.funds[side];
  for (let n = 0; n < 3; n++) {
    let want: Kind | null = null;
    if (arrested.length > count(Kind.Transporter) * 6) want = Kind.Transporter;
    else if (glued.length > 0 && count(Kind.Loesetrupp) < Math.ceil(glued.length / 3)) want = Kind.Loesetrupp;
    else if (fires.length > 0 && count(Kind.Wasserwerfer) === 0) want = Kind.Wasserwerfer;
    else if (hardliner && count(Kind.Wasserwerfer) === 0 && active.length > 15 && world.opinion < 60) want = Kind.Wasserwerfer;
    else if (count(Kind.Reiter) < 2 && active.length > 10) want = Kind.Reiter;
    else if (active.length + 4 > count(Kind.Polizist) + count(Kind.Bereitschaft) * 2) want = n % 2 === 0 ? Kind.Polizist : Kind.Bereitschaft;
    if (want === null || funds < STATS[want].cost) break;
    funds -= STATS[want].cost;
    cmds.push(buyCmd(side, want));
  }

  const claimed = new Set<number>();
  const nearestOf = <T extends { x: number; y: number }>(u: Unit, list: T[], skip?: (t: T) => boolean): T | null => {
    let best: T | null = null;
    let bd = Infinity;
    for (const t of list) {
      if (skip && skip(t)) continue;
      const d = d2(u, t);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };

  for (const u of mine) {
    if (!isIdle(u)) continue;
    switch (u.kind) {
      case Kind.Polizist:
      case Kind.Bereitschaft: {
        const t = nearestOf(u, active, (d) => d.glued || claimed.has(d.id));
        if (t) {
          claimed.add(t.id);
          cmds.push(moveCmd(side, u, Math.floor(t.x), Math.floor(t.y)));
        } else {
          const g = goals[u.id % goals.length];
          if (d2(u, g) > 16) cmds.push(moveCmd(side, u, g.x + (u.id % 3) - 1, g.y + ((u.id >> 2) % 3) - 1));
        }
        break;
      }
      case Kind.Transporter: {
        if (u.cargo >= BAL.transporterCapacity) break; // handled by behaviour
        const t = nearestOf(u, arrested);
        if (t && d2(u, t) > 3) cmds.push(moveCmd(side, u, Math.floor(t.x), Math.floor(t.y)));
        break;
      }
      case Kind.Loesetrupp: {
        const t = nearestOf(u, glued, (d) => claimed.has(d.id));
        if (t) {
          claimed.add(t.id);
          cmds.push(moveCmd(side, u, Math.floor(t.x), Math.floor(t.y)));
        }
        break;
      }
      case Kind.Reiter: {
        const t = nearestOf(u, active, (d) => d.sit || d.glued);
        if (t && d2(u, t) > 2) cmds.push(moveCmd(side, u, Math.floor(t.x), Math.floor(t.y)));
        break;
      }
      case Kind.Wasserwerfer: {
        const f = nearestOf(u, fires.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })));
        if (f) {
          if (d2(u, f) > 12) cmds.push(moveCmd(side, u, Math.floor(f.x), Math.floor(f.y)));
          break;
        }
        if (world.opinion < (hardliner ? 70 : 55)) {
          // biggest crowd
          let best: Unit | null = null;
          let bestN = 4;
          for (const d of active) {
            const n = active.filter((o) => d2(o, d) < 6).length;
            if (n > bestN) {
              bestN = n;
              best = d;
            }
          }
          if (best && d2(u, best) > 12) cmds.push(moveCmd(side, u, Math.floor(best.x), Math.floor(best.y)));
        }
        break;
      }
    }
  }
  return cmds;
}
