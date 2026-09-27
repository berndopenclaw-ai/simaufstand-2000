import { Application, Container, CullerPlugin, Graphics, Matrix, Rectangle, Sprite, Text, extensions } from 'pixi.js';

extensions.add(CullerPlugin);
import { F_ARRESTED, F_GLUED, F_SIT, F_STANCE_OFF, F_WORKING, SnapUnit, Snapshot } from '../sim/snapshot';
import { District, Kind, PARKED_BURNING, PARKED_OK, STATS, Side, TICK_MS, Tile } from '../sim/types';
import type { GameEvent } from '../sim/world';
import type { MapPayload } from '../sim/worker';
import { FLOOR_PX, HALF_H, HALF_W, isoQuad, isoToScreen, rotate, rotateDir, screenToIso, unrotate } from './iso';
import { CAR_COLORS, Tex, TextureBank } from './textures';

interface UnitView {
  root: Container;
  body: Sprite;
  ring: Sprite;
  badge: Sprite;
  glue: Sprite;
  bar: Graphics;
  texKey: string;
  barKey: string;
}

/** A quarter turn in progress: the old view (ghost) spins out while the new one spins in. */
interface Spin {
  ghost: Sprite;
  step: number;
  t: number;
}

const SPIN_MS = 380;

/**
 * Screen-space affine map that turns the isometric ground plane by `angle` around (cx, cy):
 * un-squash the 2:1 projection, rotate, squash again. At ±90° it matches a quarter turn exactly.
 */
function isoSpin(angle: number, cx: number, cy: number): Matrix {
  return new Matrix().translate(-cx, -cy).scale(1, 2).rotate(angle).scale(1, 0.5).translate(cx, cy);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  grow: number;
  fade: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function setTex(s: Sprite, t: Tex) {
  s.texture = t.tex;
  s.anchor.set(t.ax, t.ay);
}

export class GameRenderer {
  app = new Application();
  /** holds the camera; only transformed while a rotation animates */
  spinner = new Container();
  camera = new Container();
  ground = new Container();
  overlay = new Graphics();
  marker = new Graphics();
  fog = new Graphics();
  objects = new Container();
  fx = new Container();
  bank!: TextureBank;
  map: MapPayload | null = null;
  selected = new Set<number>();
  cur: Snapshot | null = null;
  /** view rotation in quarter turns, clockwise */
  rot = 0;
  private units = new Map<number, UnitView>();
  private cars = new Map<number, Sprite>();
  private parked = new Map<number, { s: Sprite; flame: Sprite; key: string }>();
  private rows: Graphics[] = [];
  private prev = new Map<number, { x: number; y: number }>();
  private prevCars = new Map<number, { x: number; y: number }>();
  private snapTime = 0;
  private particles: Particle[] = [];
  private visKey = '';
  private time = 0;
  private liveUntil = 0;
  private overlayBuilt = false;
  private moveMarker: { x: number; y: number; until: number } | null = null;
  private spin: Spin | null = null;

  async init(parent: HTMLElement) {
    const low = new URLSearchParams(location.search).has('lowgfx');
    await this.app.init({
      resizeTo: parent,
      background: 0x1c2330,
      antialias: false,
      autoDensity: true,
      resolution: low ? 1 : Math.min(2, window.devicePixelRatio || 1),
      preference: 'webgl',
    });
    parent.appendChild(this.app.canvas);
    // ?fps=N caps the frame rate (used by automated tests on software GPUs)
    const fps = Number(new URLSearchParams(location.search).get('fps'));
    if (fps > 0) this.app.ticker.maxFPS = fps;
    this.bank = new TextureBank(this.app.renderer as any);
    this.objects.sortableChildren = true;
    this.camera.addChild(this.ground, this.overlay, this.marker, this.objects, this.fog, this.fx);
    this.spinner.addChild(this.camera);
    this.app.stage.addChild(this.spinner);
    this.app.ticker.add((t) => this.frame(t.deltaMS));
  }

  // ------------------------------------------------------------------ map

  buildMap(map: MapPayload) {
    this.map = map;
    this.overlayBuilt = false;
    for (const c of [...this.objects.children]) c.destroy({ children: true });
    this.rows = [];
    this.units.clear();
    this.cars.clear();
    this.parked.clear();
    this.prev.clear();
    this.prevCars.clear();
    for (const p of this.particles) p.s.destroy();
    this.particles = [];
    this.visKey = '';
    this.cur = null;
    this.drawStatic();
    this.camera.scale.set(1);
    this.centerOn(map.demoMeet.x, map.demoMeet.y);
  }

  /** ground, buildings and trees in the current view rotation */
  private drawStatic() {
    const map = this.map!;
    for (const c of [...this.ground.children]) c.destroy();
    for (const r of this.rows) r.destroy();
    this.rows = [];
    const { w, h, tiles, variant } = map;
    const [vw, vh] = this.rot & 1 ? [h, w] : [w, h];
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : tiles[y * w + x]);
    const CH = 16;
    const chunks = new Map<number, Graphics>();
    const chunk = (x: number, y: number) => {
      const k = Math.floor(y / CH) * 100 + Math.floor(x / CH);
      let c = chunks.get(k);
      if (!c) {
        c = new Graphics();
        c.cullable = true;
        chunks.set(k, c);
        this.ground.addChild(c);
      }
      return c;
    };
    const backdrop = new Graphics();
    backdrop.poly(this.quad(-3, -3, w + 3, h + 3)).fill(0x3f5f2a);
    this.ground.addChild(backdrop);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const g = chunk(x, y);
        const i = y * w + x;
        const t = tiles[i];
        const v = variant[i];
        const q = this.quad(x, y, x + 1, y + 1);
        switch (t) {
          case Tile.Grass:
            g.poly(q).fill(v % 3 === 0 ? 0x5b8a38 : 0x62913e);
            break;
          case Tile.Park:
            g.poly(q).fill(v % 2 ? 0x4e8a30 : 0x548f35);
            if (v % 7 === 0) g.poly(this.quad(x + 0.4, y, x + 0.6, y + 1)).fill(0xc9b98f);
            break;
          case Tile.Water:
            g.poly(q).fill(0x2e6aa3);
            if (v % 3 === 0) {
              const c = this.proj(x + 0.3 + (v % 5) * 0.08, y + 0.5);
              g.moveTo(c.x - 6, c.y).lineTo(c.x + 4, c.y).stroke({ color: 0x7fb2e0, width: 1 });
            }
            break;
          case Tile.Plaza:
            g.poly(q).fill((x + y) % 2 ? 0xd4ccb6 : 0xc9c0a8);
            break;
          case Tile.Parking:
            g.poly(q).fill(0x6e7277);
            g.poly(this.quad(x + 0.48, y + 0.05, x + 0.52, y + 0.95)).fill(0xeeeeee);
            break;
          case Tile.Building:
            g.poly(q).fill(0x9a9a94);
            break;
          case Tile.Road: {
            const water = y === 39 || y === 40;
            g.poly(q).fill(water ? 0x6b6f75 : 0x55595f);
            const ex = at(x - 1, y) === Tile.Road || at(x + 1, y) === Tile.Road;
            const ey = at(x, y - 1) === Tile.Road || at(x, y + 1) === Tile.Road;
            if (ex && !ey) g.poly(this.quad(x + 0.2, y + 0.47, x + 0.7, y + 0.53)).fill(0xf5f5f5);
            else if (ey && !ex) g.poly(this.quad(x + 0.47, y + 0.2, x + 0.53, y + 0.7)).fill(0xf5f5f5);
            else for (let k = 0; k < 4; k++) g.poly(this.quad(x + 0.12 + k * 0.2, y + 0.02, x + 0.22 + k * 0.2, y + 0.14)).fill(0xdddddd);
            if (water) {
              g.poly(this.quad(x, y, x + 0.06, y + 1)).fill(0xb0b0b0);
              g.poly(this.quad(x + 0.94, y, x + 1, y + 1)).fill(0xb0b0b0);
            }
            break;
          }
        }
      }
    }
    const g = chunk(34, 34);
    const fc = this.proj(34.5, 34.5);
    g.ellipse(fc.x, fc.y, 40, 20).fill(0xa89f88);
    g.ellipse(fc.x, fc.y, 34, 17).fill(0x3d86c6);
    g.ellipse(fc.x, fc.y - 2, 8, 4).fill(0xcfe8ff);

    // buildings + trees: one Graphics per diagonal row (in view coords) for correct depth sorting
    for (let d = 0; d <= vw + vh - 2; d++) {
      let row: Graphics | null = null;
      let seg = -1;
      for (let x = Math.max(0, d - vh + 1); x <= Math.min(vw - 1, d); x++) {
        const y = d - x;
        const wt = unrotate(x + 0.5, y + 0.5, this.rot, w, h);
        const wx = wt.x - 0.5;
        const wy = wt.y - 0.5;
        if (!row || Math.floor(x / 12) !== seg) {
          seg = Math.floor(x / 12);
          row = new Graphics();
          row.zIndex = d + 1;
          row.cullable = true;
          this.objects.addChild(row);
          this.rows.push(row);
        }
        const i = wy * w + wx;
        const t = tiles[i];
        if (t === Tile.Building) this.drawBuilding(row, x, y, map.height[i], map.district[i] as District, variant[i], wx + wy);
        else if (t === Tile.Park && variant[i] % 7 !== 0) this.drawTree(row, x, y, variant[i]);
        else if (t === Tile.Grass && variant[i] % 5 === 0) this.drawTree(row, x, y, variant[i]);
      }
    }
    for (const r of this.rows) if (r.context.instructions.length === 0) r.visible = false;
    const st = new Graphics();
    const sc = this.proj(34.5, 34.5);
    st.rect(sc.x - 3, sc.y - 22, 6, 18).fill(0x6f8f7f);
    st.circle(sc.x, sc.y - 25, 4).fill(0x6f8f7f);
    st.zIndex = this.depth(34.5, 34.5) + 0.2;
    this.objects.addChild(st);
    this.rows.push(st);
  }

  private drawTree(g: Graphics, x: number, y: number, v: number) {
    const n = 1 + (v % 2);
    for (let k = 0; k < n; k++) {
      const ox = 0.3 + ((v >> (k * 2)) % 4) * 0.12;
      const oy = 0.3 + ((v >> (k * 3 + 1)) % 4) * 0.12;
      const p = isoToScreen(x + ox, y + oy);
      g.ellipse(p.x, p.y, 7, 3).fill({ color: 0x000000, alpha: 0.2 });
      g.rect(p.x - 1.5, p.y - 9, 3, 9).fill(0x6b4423);
      const green = [0x2f6b2a, 0x3a7d2c, 0x2d5e25][v % 3];
      g.circle(p.x, p.y - 15, 8).fill(green);
      g.circle(p.x - 3, p.y - 18, 5).fill(shade(green, 1.25));
    }
  }

  /** x, y are view coords; k = world x + y, keeps the flag pattern stable under rotation */
  private drawBuilding(g: Graphics, x: number, y: number, floors: number, d: District, v: number, k: number) {
    const ins = 0.07;
    const x0 = x + ins;
    const y0 = y + ins;
    const x1 = x + 1 - ins;
    const y1 = y + 1 - ins;
    const hp = floors * FLOOR_PX + 5;
    let wall = 0xd8c9a3;
    let roof = 0x8a8f99;
    let pitched = false;
    let windows = 0x3a4b5c;
    switch (d) {
      case District.Regierungsviertel:
        wall = [0xd8c9a3, 0xcdbf99, 0xe0d6bc][v % 3];
        roof = 0x7d8591;
        break;
      case District.Geschaeftsviertel:
        wall = [0x7f9fb5, 0x8fa9ba, 0x9aa7b0, 0x6f8fa5][v % 4];
        roof = 0x5d6d7e;
        windows = 0x2c4a63;
        break;
      case District.Altstadt:
        wall = [0xe8d5b7, 0xf2c6a0, 0xd9b8c4, 0xe9e1c9][v % 4];
        roof = 0xa0412d;
        pitched = true;
        break;
      case District.Wohngebiet:
        wall = [0xe6e0d4, 0xd4c4a8, 0xc9d6df, 0xe8cfc0][v % 4];
        roof = [0x8b4b3a, 0x6d4c41, 0x9c5a3c][v % 3];
        pitched = v % 3 !== 0;
        break;
      case District.Industriegebiet:
        wall = [0x9aa0a6, 0xa89f91, 0x8d949b][v % 3];
        roof = 0x6b6e70;
        windows = 0x55606a;
        break;
    }
    if (v === 250) {
      wall = 0xf0f0f0;
      roof = 0xb0b8c0;
      windows = 0x345c80;
      pitched = false;
    }
    const left = shade(wall, 0.85);
    const right = shade(wall, 0.68);
    const lb = isoQuad(x0, y1, x1, y1, 0);
    const lt = isoQuad(x0, y1, x1, y1, hp);
    g.poly([lb[0], lb[1], lb[2], lb[3], lt[2], lt[3], lt[0], lt[1]]).fill(left);
    const rb = isoQuad(x1, y0, x1, y1, 0);
    const rt = isoQuad(x1, y0, x1, y1, hp);
    g.poly([rb[0], rb[1], rb[4], rb[5], rt[4], rt[5], rt[0], rt[1]]).fill(right);
    for (let f = 0; f < floors; f++) {
      const za = 5 + f * FLOOR_PX + 2;
      const zb = za + FLOOR_PX - 5;
      for (let k = 0; k < 3; k++) {
        const a = x0 + (x1 - x0) * (0.1 + k * 0.3);
        const b = a + (x1 - x0) * 0.2;
        const p = isoQuad(a, y1, b, y1, za);
        const q = isoQuad(a, y1, b, y1, zb);
        const lit = (v + f * 3 + k) % 11 === 0;
        g.poly([p[0], p[1], p[2], p[3], q[2], q[3], q[0], q[1]]).fill(lit ? 0xffe9a8 : windows);
        const ya = y0 + (y1 - y0) * (0.1 + k * 0.3);
        const yb = ya + (y1 - y0) * 0.2;
        const r = isoQuad(x1, ya, x1, yb, za);
        const s = isoQuad(x1, ya, x1, yb, zb);
        g.poly([r[0], r[1], r[4], r[5], s[4], s[5], s[0], s[1]]).fill(shade(windows, 0.85));
      }
    }
    const dm = x0 + (x1 - x0) * 0.45;
    const dp = isoQuad(dm, y1, dm + 0.12, y1, 0);
    const dq = isoQuad(dm, y1, dm + 0.12, y1, 6);
    g.poly([dp[0], dp[1], dp[2], dp[3], dq[2], dq[3], dq[0], dq[1]]).fill(0x4a3526);
    if (pitched) {
      const ym = (y0 + y1) / 2;
      const rh = 10;
      g.poly(isoQuad(x0, y0, x1, y1, hp)).fill(shade(roof, 0.8));
      const back = [...isoQuad(x0, y0, x1, y0, hp).slice(0, 4), ...isoQuad(x1, ym, x0, ym, hp + rh).slice(0, 4)];
      g.poly(back).fill(shade(roof, 0.8));
      const front = [...isoQuad(x0, y1, x1, y1, hp).slice(0, 4), ...isoQuad(x1, ym, x0, ym, hp + rh).slice(0, 4)];
      g.poly(front).fill(roof);
      const e1 = isoQuad(x1, y0, x1, y0, hp);
      const e2 = isoQuad(x1, y1, x1, y1, hp);
      const e3 = isoQuad(x1, ym, x1, ym, hp + rh);
      g.poly([e1[0], e1[1], e2[0], e2[1], e3[0], e3[1]]).fill(right);
    } else {
      g.poly(isoQuad(x0, y0, x1, y1, hp)).fill(roof);
      g.poly(isoQuad(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, hp + 1)).fill(shade(roof, 1.12));
      if (d === District.Industriegebiet && v % 4 === 0) {
        const c = isoQuad(x0 + 0.2, y0 + 0.2, x0 + 0.32, y0 + 0.32, hp);
        g.rect(c[0] - 3, c[1] - 18, 6, 18).fill(0x7a4a3a);
      }
      if (v === 250 && k % 3 === 0) {
        const c = isoToScreen(x + 0.5, y + 0.5);
        g.rect(c.x, c.y - hp - 22, 1.2, 22).fill(0xdddddd);
        g.rect(c.x + 1.2, c.y - hp - 22, 9, 6).fill([0xe63946, 0x2a9d8f, 0xf4a261][k % 3]);
      }
    }
  }

  // ------------------------------------------------------------------ camera

  /** world tile coords -> view coords */
  private toView(x: number, y: number) {
    return this.map ? rotate(x, y, this.rot, this.map.w, this.map.h) : { x, y };
  }

  /** world tile coords -> screen pixels (before camera) */
  private proj(x: number, y: number) {
    const v = this.toView(x, y);
    return isoToScreen(v.x, v.y);
  }

  /** screen pixels (before camera) -> world tile coords */
  private unproj(sx: number, sy: number) {
    const v = screenToIso(sx, sy);
    return this.map ? unrotate(v.x, v.y, this.rot, this.map.w, this.map.h) : v;
  }

  /** isoQuad for a world-space rect */
  private quad(x0: number, y0: number, x1: number, y1: number, h = 0): number[] {
    const a = this.toView(x0, y0);
    const b = this.toView(x1, y1);
    return isoQuad(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), h);
  }

  /** draw order of a world point (larger = in front) */
  private depth(x: number, y: number) {
    const v = this.toView(x, y);
    return v.x + v.y;
  }

  /** turn the map by a quarter turn (1 = clockwise, -1 = counter-clockwise), keeping the screen centre */
  rotate(step: number) {
    if (!this.map) return;
    this.endSpin();
    const { width, height } = this.app.screen;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      // freeze the current picture so it can spin away on top of the new view
      const tex = this.app.renderer.generateTexture({ target: this.app.stage, frame: new Rectangle(0, 0, width, height) });
      const ghost = new Sprite(tex);
      this.app.stage.addChild(ghost);
      this.spin = { ghost, step, t: 0 };
      this.updateSpin(0);
    }
    const c = this.screenToWorld(width / 2, height / 2);
    this.rot = (this.rot + step + 4) & 3;
    this.drawStatic();
    this.overlayBuilt = false;
    this.visKey = '';
    for (const p of this.particles) p.s.destroy();
    this.particles = [];
    if (this.cur) {
      this.syncViews(this.cur);
      this.updateFog(this.cur.vis);
    }
    this.centerOn(c.x, c.y);
  }

  private updateSpin(dtMs: number) {
    const sp = this.spin;
    if (!sp) return;
    sp.t += dtMs;
    if (sp.t >= SPIN_MS) return this.endSpin();
    const e = easeInOut(sp.t / SPIN_MS);
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    sp.ghost.setFromMatrix(isoSpin((sp.step * e * Math.PI) / 2, cx, cy));
    sp.ghost.alpha = 1 - e;
    this.spinner.setFromMatrix(isoSpin((-sp.step * (1 - e) * Math.PI) / 2, cx, cy));
  }

  private endSpin() {
    if (!this.spin) return;
    this.spin.ghost.destroy({ texture: true, textureSource: true });
    this.spin = null;
    this.spinner.setFromMatrix(Matrix.IDENTITY);
  }

  centerOn(x: number, y: number) {
    const p = this.proj(x, y);
    const s = this.camera.scale.x;
    this.camera.position.set(this.app.screen.width / 2 - p.x * s, this.app.screen.height / 2 - p.y * s);
  }

  pan(dx: number, dy: number) {
    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.clampCamera();
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const old = this.camera.scale.x;
    const s = Math.max(0.35, Math.min(3, old * factor));
    const wx = (sx - this.camera.position.x) / old;
    const wy = (sy - this.camera.position.y) / old;
    this.camera.scale.set(s);
    this.camera.position.set(sx - wx * s, sy - wy * s);
    this.clampCamera();
  }

  private clampCamera() {
    if (!this.map) return;
    const s = this.camera.scale.x;
    const [vw, vh] = this.rot & 1 ? [this.map.h, this.map.w] : [this.map.w, this.map.h];
    const minX = -vw * HALF_W * s + this.app.screen.width * 0.5;
    const maxX = vh * HALF_W * s + this.app.screen.width * 0.5;
    const minY = -(vw + vh) * HALF_H * s + this.app.screen.height * 0.5;
    const maxY = this.app.screen.height * 0.5 + 60 * s;
    this.camera.position.x = Math.max(minX, Math.min(maxX, this.camera.position.x));
    this.camera.position.y = Math.max(minY, Math.min(maxY, this.camera.position.y));
  }

  screenToWorld(sx: number, sy: number) {
    const s = this.camera.scale.x;
    return this.unproj((sx - this.camera.position.x) / s, (sy - this.camera.position.y) / s);
  }

  worldToScreen(x: number, y: number) {
    const p = this.proj(x, y);
    const s = this.camera.scale.x;
    return { x: p.x * s + this.camera.position.x, y: p.y * s + this.camera.position.y };
  }

  /** currently interpolated position of a unit */
  unitPos(id: number): { x: number; y: number } | null {
    const v = this.units.get(id);
    if (!v) return null;
    return this.unproj(v.root.x, v.root.y);
  }

  visibleUnits(): SnapUnit[] {
    return this.cur?.units ?? [];
  }

  // ------------------------------------------------------------------ snapshots

  pushSnapshot(snap: Snapshot) {
    if (this.cur) {
      this.prev.clear();
      for (const u of this.cur.units) this.prev.set(u.id, { x: u.x, y: u.y });
      this.prevCars.clear();
      for (const c of this.cur.cars) this.prevCars.set(c.id, { x: c.x, y: c.y });
    }
    this.cur = snap;
    this.snapTime = performance.now();
    this.syncViews(snap);
    this.handleEvents(snap.events);
    this.updateFog(snap.vis);
  }

  private syncViews(snap: Snapshot) {
    const seen = new Set<number>();
    for (const u of snap.units) {
      seen.add(u.id);
      if (!this.units.has(u.id)) this.units.set(u.id, this.makeUnitView());
    }
    for (const [id, v] of this.units)
      if (!seen.has(id)) {
        v.root.destroy({ children: true });
        this.units.delete(id);
        this.selected.delete(id);
      }
    const cseen = new Set<number>();
    for (const c of snap.cars) {
      cseen.add(c.id);
      if (!this.cars.has(c.id)) {
        const s = new Sprite();
        s.cullable = true;
        s.tint = CAR_COLORS[c.c % CAR_COLORS.length];
        this.objects.addChild(s);
        this.cars.set(c.id, s);
      }
    }
    for (const [id, s] of this.cars)
      if (!cseen.has(id)) {
        s.destroy();
        this.cars.delete(id);
      }
    const pseen = new Set<number>();
    for (const p of snap.parked) {
      pseen.add(p.id);
      let v = this.parked.get(p.id);
      if (!v) {
        const s = new Sprite();
        const flame = new Sprite();
        s.cullable = true;
        flame.cullable = true;
        flame.visible = false;
        this.objects.addChild(s, flame);
        v = { s, flame, key: '' };
        this.parked.set(p.id, v);
      }
      const key = `${p.st}-${p.x}-${p.y}-${this.rot}`;
      if (v.key !== key) {
        v.key = key;
        setTex(v.s, this.bank.car(rotateDir(p.id % 2 === 0 ? 0 : 2, this.rot), p.st === PARKED_OK ? 'ok' : 'wreck'));
        v.s.tint = p.st === PARKED_OK ? CAR_COLORS[p.c % CAR_COLORS.length] : 0xffffff;
        const pos = this.proj(p.x + 0.5, p.y + 0.5);
        const z = this.depth(p.x + 0.5, p.y + 0.5);
        v.s.position.set(pos.x, pos.y);
        v.s.zIndex = z;
        v.flame.position.set(pos.x, pos.y - 6);
        v.flame.zIndex = z + 0.01;
        v.flame.visible = p.st === PARKED_BURNING;
      }
    }
    for (const [id, v] of this.parked)
      if (!pseen.has(id)) {
        v.s.destroy();
        v.flame.destroy();
        this.parked.delete(id);
      }
  }

  private makeUnitView(): UnitView {
    const root = new Container();
    const glue = new Sprite(this.bank.icon('glue').tex);
    glue.anchor.set(0.5);
    glue.visible = false;
    const ring = new Sprite();
    ring.visible = false;
    const body = new Sprite();
    const badge = new Sprite();
    badge.visible = false;
    const bar = new Graphics();
    root.cullable = true;
    root.addChild(glue, ring, body, badge, bar);
    this.objects.addChild(root);
    return { root, body, ring, badge, glue, bar, texKey: '', barKey: '' };
  }

  // ------------------------------------------------------------------ frame

  frame(dtMs: number) {
    this.time += dtMs;
    this.updateSpin(dtMs);
    const snap = this.cur;
    if (!snap || !this.map) return;
    const a = Math.min(1, (performance.now() - this.snapTime) / TICK_MS);

    for (const u of snap.units) {
      const v = this.units.get(u.id);
      if (!v) continue;
      const p = this.prev.get(u.id);
      const x = p && Math.abs(p.x - u.x) < 3 ? lerp(p.x, u.x, a) : u.x;
      const y = p && Math.abs(p.y - u.y) < 3 ? lerp(p.y, u.y, a) : u.y;
      const s = this.proj(x, y);
      v.root.position.set(s.x, s.y);
      v.root.zIndex = this.depth(x, y);
      const vehicle = STATS[u.k].vehicle;
      const f = rotate(u.fx, u.fy, this.rot, 0, 0);
      const dir = Math.abs(f.x) > Math.abs(f.y) ? (f.x > 0 ? 0 : 1) : f.y > 0 ? 2 : 3;
      const pose = u.f & (F_SIT | F_GLUED | F_ARRESTED) ? 'sit' : 'stand';
      const key = `${u.k}-${pose}-${vehicle ? dir : 0}`;
      if (v.texKey !== key) {
        v.texKey = key;
        setTex(v.body, this.bank.unit(u.k, u.id, pose, vehicle ? dir : 0));
        setTex(v.ring, vehicle ? this.bank.vehicleRing() : this.bank.ring());
      }
      if (!vehicle) {
        const sdx = f.x - f.y;
        if (Math.abs(sdx) > 0.05) v.body.scale.x = sdx < 0 ? -1 : 1;
      }
      v.body.tint = u.f & F_ARRESTED ? 0x9a9a9a : u.f & F_STANCE_OFF ? 0xc8c8ff : 0xffffff;
      v.ring.visible = this.selected.has(u.id);
      v.glue.visible = !!(u.f & F_GLUED);
      let badge: Tex | null = null;
      if (u.f & F_ARRESTED) badge = this.bank.icon('cuffs');
      else if (u.k === Kind.Presse && (this.time % 1000 < 650 || this.time < this.liveUntil)) badge = this.bank.icon('live');
      if (badge) {
        if (v.badge.texture !== badge.tex) setTex(v.badge, badge);
        v.badge.visible = true;
        v.badge.position.set(0, u.k === Kind.Reiter ? -44 : -34);
      } else v.badge.visible = false;
      // progress / morale bar, only rebuilt when it changes
      const barY = vehicle ? -30 : u.k === Kind.Reiter ? -42 : -30;
      const sel = this.selected.has(u.id);
      const barKey = u.f & F_WORKING ? `w${Math.round(u.w * 16)}` : sel && u.s === Side.Demo ? `m${Math.round(u.m / 5)}` : '';
      if (barKey !== v.barKey) {
        v.barKey = barKey;
        v.bar.clear();
        if (u.f & F_WORKING) {
          v.bar.rect(-8, barY, 16, 3).fill(0x222222);
          v.bar.rect(-8, barY, 16 * u.w, 3).fill(0xffd166);
        } else if (barKey) {
          v.bar.rect(-8, barY, 16, 2.5).fill(0x222222);
          v.bar.rect(-8, barY, (16 * Math.max(0, u.m)) / 100, 2.5).fill(u.m > 40 ? 0x7cfc00 : 0xff6b6b);
        }
      }
    }

    for (const c of snap.cars) {
      const s = this.cars.get(c.id);
      if (!s) continue;
      const p = this.prevCars.get(c.id);
      const x = p && Math.abs(p.x - c.x) < 1.5 ? lerp(p.x, c.x, a) : c.x;
      const y = p && Math.abs(p.y - c.y) < 1.5 ? lerp(p.y, c.y, a) : c.y;
      const sp = this.proj(x, y);
      s.position.set(sp.x, sp.y);
      s.zIndex = this.depth(x, y);
      const tex = this.bank.car(rotateDir(c.d, this.rot));
      if (s.texture !== tex.tex) setTex(s, tex);
    }

    const frame = Math.floor(this.time / 120) % 4;
    for (const [, v] of this.parked) {
      if (!v.flame.visible) continue;
      const ft = this.bank.flame(frame);
      if (v.flame.texture !== ft.tex) setTex(v.flame, ft);
      if (Math.random() < 0.12) this.emit(this.bank.puff(), v.flame.x + (Math.random() - 0.5) * 8, v.flame.y - 14, (Math.random() - 0.5) * 0.2, -0.5, 2200, 0.012);
    }

    this.drawOverlay();

    for (const p of this.particles) {
      p.life -= dtMs;
      p.s.x += p.vx * dtMs * 0.06;
      p.s.y += p.vy * dtMs * 0.06;
      if (p.grow) p.s.scale.set(p.s.scale.x + p.grow * dtMs * 0.06);
      if (p.fade) p.s.alpha = Math.max(0, p.life / p.max);
    }
    if (this.particles.some((p) => p.life <= 0)) {
      this.particles = this.particles.filter((p) => {
        if (p.life > 0) return true;
        p.s.destroy();
        return false;
      });
    }
  }

  private drawOverlay() {
    if (!this.map) return;
    const o = this.overlay;
    o.alpha = 0.7 + 0.3 * Math.sin(this.time / 250);
    this.drawMarker();
    if (this.overlayBuilt) return;
    this.overlayBuilt = true;
    o.clear();
    const obj = this.map.objective;
    if (obj.type === 'blockade') {
      for (const p of obj.points) {
        o.poly(this.quad(p.x - 1, p.y - 1, p.x + 2, p.y + 2)).fill({ color: 0xff8c00, alpha: 0.25 });
        o.poly(this.quad(p.x - 1, p.y - 1, p.x + 2, p.y + 2)).stroke({ color: 0xff8c00, width: 2, alpha: 0.9 });
      }
    } else {
      const r = obj.rect;
      const red = r.x0 === this.map.redZone.x0 && r.y0 === this.map.redZone.y0;
      const col = red ? 0xe63946 : 0xffd166;
      o.poly(this.quad(r.x0, r.y0, r.x1 + 1, r.y1 + 1)).fill({ color: col, alpha: 0.18 });
      o.poly(this.quad(r.x0, r.y0, r.x1 + 1, r.y1 + 1)).stroke({ color: col, width: 3, alpha: 0.9 });
    }
    const hq = this.map.policeHQ;
    o.poly(this.quad(hq.x, hq.y, hq.x + 1, hq.y + 1)).stroke({ color: 0x4d96ff, width: 2 });
    const dm = this.map.demoMeet;
    o.poly(this.quad(dm.x, dm.y, dm.x + 1, dm.y + 1)).stroke({ color: 0x7cfc00, width: 2 });
  }

  private drawMarker() {
    const m = this.moveMarker;
    if (!m) return;
    const g = this.marker;
    g.clear();
    if (this.time >= m.until) {
      this.moveMarker = null;
      return;
    }
    const k = 1 - (m.until - this.time) / 600;
    g.poly(this.quad(m.x + k * 0.3, m.y + k * 0.3, m.x + 1 - k * 0.3, m.y + 1 - k * 0.3)).stroke({ color: 0x7cfc00, width: 2, alpha: 1 - k });
  }

  markMove(x: number, y: number) {
    this.moveMarker = { x: Math.floor(x), y: Math.floor(y), until: this.time + 600 };
  }

  private updateFog(vis: Uint8Array) {
    if (!this.map) return;
    const { w, h } = this.map;
    let hsh = 0;
    for (let i = 0; i < vis.length; i++) hsh = (hsh * 31 + vis[i] * (i + 1)) | 0;
    const key = String(hsh);
    if (key === this.visKey) return;
    this.visKey = key;
    const f = this.fog;
    f.clear();
    let any = false;
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (vis[y * w + x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < w && !vis[y * w + x]) x++;
        f.poly(this.quad(start, y, x, y + 1));
        any = true;
      }
    }
    if (any) f.fill({ color: 0x0a0f1a, alpha: 0.34 });
  }

  // ------------------------------------------------------------------ effects

  private emit(tex: Tex, x: number, y: number, vx: number, vy: number, life: number, grow = 0, fade = true) {
    if (this.particles.length > 700) return;
    const s = new Sprite(tex.tex);
    s.anchor.set(tex.ax, tex.ay);
    s.position.set(x, y);
    s.cullable = true;
    this.fx.addChild(s);
    this.particles.push({ s, vx, vy, life, max: life, grow, fade });
  }

  private popIcon(tex: Tex, x: number, y: number) {
    const p = this.proj(x, y);
    this.emit(tex, p.x, p.y - 36, 0, -0.25, 1200, 0, true);
  }

  floatText(text: string, x: number, y: number, color = 0xffffff) {
    const p = this.proj(x, y);
    const t = new Text({ text, style: { fontFamily: 'monospace', fontSize: 11, fill: color, stroke: { color: 0x000000, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(p.x, p.y - 44);
    this.fx.addChild(t);
    this.particles.push({ s: t as unknown as Sprite, vx: 0, vy: -0.3, life: 1600, max: 1600, grow: 0, fade: true });
  }

  private handleEvents(events: GameEvent[]) {
    for (const e of events) {
      switch (e.k) {
        case 'spray': {
          const a = this.proj(e.x, e.y);
          const b = this.proj(e.x2 ?? e.x, e.y2 ?? e.y);
          for (let i = 0; i < 36; i++) {
            const t = 350 + Math.random() * 250;
            const vx = ((b.x - a.x) / t) * 16.6 + (Math.random() - 0.5) * 0.6;
            const vy = ((b.y - (a.y - 18)) / t) * 16.6 + (Math.random() - 0.5) * 0.6;
            this.emit(this.bank.drop(), a.x, a.y - 18, vx, vy, t, 0, false);
          }
          for (let i = 0; i < 12; i++) this.emit(this.bank.drop(), b.x + (Math.random() - 0.5) * 30, b.y - Math.random() * 10, (Math.random() - 0.5) * 1.2, -Math.random(), 500 + Math.random() * 300, 0, true);
          break;
        }
        case 'arrest':
          this.popIcon(this.bank.icon('cuffs'), e.x, e.y);
          break;
        case 'injury':
          this.popIcon(this.bank.icon('cross'), e.x, e.y);
          break;
        case 'recruit':
        case 'clear':
        case 'extinguish':
          this.popIcon(this.bank.icon('plus'), e.x, e.y);
          break;
        case 'megaphone': {
          const p = this.proj(e.x, e.y);
          for (let i = 0; i < 3; i++) this.emit(this.bank.icon('note'), p.x + (i - 1) * 8, p.y - 30, (i - 1) * 0.3, -0.6, 1400);
          break;
        }
        case 'fire': {
          const p = this.proj(e.x, e.y);
          for (let i = 0; i < 12; i++) this.emit(this.bank.puff(), p.x, p.y - 10, (Math.random() - 0.5) * 1.5, -Math.random() * 1.5, 1200, 0.02);
          break;
        }
        case 'live':
          this.liveUntil = this.time + 3000;
          break;
      }
    }
  }
}
