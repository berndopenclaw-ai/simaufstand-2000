/// <reference lib="webworker" />
// Runs the deterministic simulation off the main thread at 10 Hz.
import { makeSnapshot } from './snapshot';
import { Side, TICK_MS } from './types';
import { Command, Difficulty, GameEvent, World, createWorld, step } from './world';

export type ToWorker =
  | { type: 'start'; scenario: string; side: Side.Police | Side.Demo; difficulty: Difficulty; seed: number; spectate?: boolean }
  | { type: 'cmd'; cmd: Command }
  | { type: 'speed'; value: number }
  | { type: 'pause'; value: boolean }
  | { type: 'stop' }
  | { type: 'log' }
  | { type: 'ack' }
  | { type: 'debug'; opinion?: number; ticks?: number };

export type FromWorker =
  | { type: 'snap'; snap: ReturnType<typeof makeSnapshot>; map?: MapPayload }
  | { type: 'log'; log: { tick: number; cmd: Command }[]; seed: number; scenario: string };

export interface MapPayload {
  w: number;
  h: number;
  tiles: Uint8Array;
  height: Uint8Array;
  variant: Uint8Array;
  district: Uint8Array;
  plaza: World['map']['plaza'];
  redZone: World['map']['redZone'];
  objective: World['scenario']['objective'];
  policeHQ: { x: number; y: number };
  demoMeet: { x: number; y: number };
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let world: World | null = null;
let side: Side.Police | Side.Demo = Side.Police;
let speed = 1;
let paused = false;
let pending: Command[] = [];
let log: { tick: number; cmd: Command }[] = [];
let timer: number | undefined;
let sentMap = false;
let spectate = false;
let inflight = 0; // snapshots the main thread has not processed yet (backpressure)
let carry: GameEvent[] = [];

function loop() {
  if (!world) return;
  const events: GameEvent[] = [];
  if (!paused && !world.result) {
    for (let i = 0; i < speed && !world.result; i++) {
      const cmds = pending;
      pending = [];
      for (const c of cmds) log.push({ tick: world.tick, cmd: c });
      step(world, cmds);
      events.push(...world.events);
    }
  }
  carry.push(...events);
  // if the main thread is busy, keep simulating but don't flood it with snapshots
  if (inflight >= 3 && sentMap && !world.result) return;
  const snap = makeSnapshot(world, side, carry, spectate);
  carry = [];
  inflight++;
  const msg: FromWorker = { type: 'snap', snap };
  if (!sentMap) {
    const m = world.map;
    msg.map = {
      w: m.w,
      h: m.h,
      tiles: m.tiles,
      height: m.height,
      variant: m.variant,
      district: m.district,
      plaza: m.plaza,
      redZone: m.redZone,
      objective: world.scenario.objective,
      policeHQ: world.scenario.policeSpawn,
      demoMeet: world.scenario.demoSpawn,
    };
    sentMap = true;
  }
  ctx.postMessage(msg);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      side = m.side;
      spectate = !!m.spectate;
      world = createWorld({
        seed: m.seed,
        scenario: m.scenario,
        aiSides: spectate ? [true, true] : [m.side !== Side.Police, m.side !== Side.Demo],
        difficulty: m.difficulty,
      });
      pending = [];
      log = [];
      carry = [];
      inflight = 0;
      paused = false;
      speed = 1;
      sentMap = false;
      if (timer !== undefined) clearInterval(timer);
      timer = setInterval(loop, TICK_MS) as unknown as number;
      loop();
      break;
    case 'cmd':
      // the player may only command their own side
      if (!spectate && 'side' in m.cmd && m.cmd.side === side) pending.push(m.cmd);
      break;
    case 'speed':
      speed = Math.max(1, Math.min(4, Math.round(m.value)));
      break;
    case 'pause':
      paused = m.value;
      break;
    case 'stop':
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      world = null;
      break;
    case 'ack':
      inflight = Math.max(0, inflight - 1);
      break;
    case 'debug':
      // test hook: only reachable when the page was opened with ?debug
      if (world && m.opinion !== undefined) world.opinion = m.opinion;
      if (world && m.ticks) for (let i = 0; i < m.ticks && !world.result; i++) step(world, []);
      break;
    case 'log':
      if (world) ctx.postMessage({ type: 'log', log, seed: world.seed, scenario: world.scenario.id } satisfies FromWorker);
      break;
  }
};
