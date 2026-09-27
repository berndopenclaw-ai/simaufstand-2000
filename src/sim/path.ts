import { CityMap, walkable } from './map';

/**
 * A* on the 4-connected tile grid. Returns the tile indices to walk through
 * (excluding the start, including the goal), or null if unreachable.
 * Deterministic: ties are broken by insertion order.
 */
export function findPath(
  map: CityMap,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  vehicle: boolean,
  maxExpand = 6000,
): number[] | null {
  const { w, h } = map;
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
  const start = sy * w + sx;
  const goal = ty * w + tx;
  if (!walkable(map, goal, vehicle)) return null;
  if (start === goal) return [];

  const n = w * h;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // binary heap of [f, seq, idx]
  const heapF: number[] = [];
  const heapS: number[] = [];
  const heapI: number[] = [];
  let seq = 0;

  const push = (f: number, i: number) => {
    heapF.push(f);
    heapS.push(seq++);
    heapI.push(i);
    let c = heapF.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapF[p] < heapF[c] || (heapF[p] === heapF[c] && heapS[p] < heapS[c])) break;
      swap(p, c);
      c = p;
    }
  };
  const swap = (a: number, b: number) => {
    let t = heapF[a];
    heapF[a] = heapF[b];
    heapF[b] = t;
    t = heapS[a];
    heapS[a] = heapS[b];
    heapS[b] = t;
    t = heapI[a];
    heapI[a] = heapI[b];
    heapI[b] = t;
  };
  const pop = (): number => {
    const top = heapI[0];
    const lastF = heapF.pop()!;
    const lastS = heapS.pop()!;
    const lastI = heapI.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapS[0] = lastS;
      heapI[0] = lastI;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < heapF.length && less(l, m)) m = l;
        if (r < heapF.length && less(r, m)) m = r;
        if (m === p) break;
        swap(p, m);
        p = m;
      }
    }
    return top;
  };
  const less = (a: number, b: number) => heapF[a] < heapF[b] || (heapF[a] === heapF[b] && heapS[a] < heapS[b]);

  g[start] = 0;
  push(Math.abs(sx - tx) + Math.abs(sy - ty), start);
  let expanded = 0;
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];

  while (heapF.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > maxExpand) return null;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < 4; k++) {
      const nx = cx + dx[k];
      const ny = cy + dy[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni] || !walkable(map, ni, vehicle)) continue;
      const ng = g[cur] + 1;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        push(ng + Math.abs(nx - tx) + Math.abs(ny - ty), ni);
      }
    }
  }
  if (came[goal] === -1) return null;
  const out: number[] = [];
  for (let c = goal; c !== start; c = came[c]) out.push(c);
  out.reverse();
  return out;
}

/** Nearest walkable tile to (x, y) by spiral search, or null. */
export function nearestWalkable(map: CityMap, x: number, y: number, vehicle: boolean, maxR = 8): number | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const i = ny * map.w + nx;
        if (walkable(map, i, vehicle)) return i;
      }
    }
  }
  return null;
}

/** Up to `count` distinct walkable tiles around (x, y), nearest first. */
export function spreadTargets(map: CityMap, x: number, y: number, count: number, vehicle: boolean): number[] {
  const out: number[] = [];
  for (let r = 0; r <= 10 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const i = ny * map.w + nx;
        if (walkable(map, i, vehicle)) out.push(i);
      }
    }
  }
  return out;
}
