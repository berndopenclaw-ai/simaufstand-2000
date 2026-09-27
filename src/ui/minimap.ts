import type { Snapshot } from '../sim/snapshot';
import { Side, Tile } from '../sim/types';
import type { MapPayload } from '../sim/worker';

const SX = 1.5;
const SY = 0.78;

// ABGR little-endian pixel values for the Uint32 view of ImageData
const rgba = (hex: number) => (0xff000000 | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;

const TILE_COLORS: Record<number, number> = {
  [Tile.Grass]: rgba(0x5b8a38),
  [Tile.Road]: rgba(0x8a8d92),
  [Tile.Building]: rgba(0xb9ad8f),
  [Tile.Plaza]: rgba(0xd9cfb4),
  [Tile.Park]: rgba(0x3f7a28),
  [Tile.Water]: rgba(0x2e6aa3),
  [Tile.Parking]: rgba(0x6e7277),
};
const BG = rgba(0x0b0f18);
const POLICE = rgba(0x4d96ff);
const DEMO = rgba(0xff9f1c);

function darken(c: number): number {
  const r = (c & 0xff) >> 1;
  const g = ((c >> 8) & 0xff) >> 1;
  const b = ((c >> 16) & 0xff) >> 1;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** Isometric minimap drawn into a pixel buffer (one putImageData per update). Click or drag to move the camera. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private px: Uint32Array;
  private base: Uint32Array;
  private tilePx: Int32Array = new Int32Array(0); // first pixel index of each tile's 2x2 block
  private map: MapPayload | null = null;
  onJump: (x: number, y: number) => void = () => {};
  private dragging = false;
  private W: number;
  private H: number;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.W = canvas.width;
    this.H = canvas.height;
    this.img = this.ctx.createImageData(this.W, this.H);
    this.px = new Uint32Array(this.img.data.buffer);
    this.base = new Uint32Array(this.W * this.H);
    const jump = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * this.W;
      const my = ((e.clientY - r.top) / r.height) * this.H;
      const w = this.toWorld(mx, my);
      this.onJump(w.x, w.y);
    };
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    canvas.addEventListener('pointermove', (e) => this.dragging && jump(e));
    canvas.addEventListener('pointerup', () => (this.dragging = false));
  }

  private offX() {
    return this.map ? this.map.h * SX + 4 : 0;
  }

  toMini(x: number, y: number) {
    return { x: (x - y) * SX + this.offX(), y: (x + y) * SY + 2 };
  }

  toWorld(mx: number, my: number) {
    const a = (mx - this.offX()) / SX;
    const b = (my - 2) / SY;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  setMap(map: MapPayload) {
    this.map = map;
    this.base.fill(BG);
    this.tilePx = new Int32Array(map.w * map.h).fill(-1);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const p = this.toMini(x, y);
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        if (px < 0 || py < 0 || px + 1 >= this.W || py + 1 >= this.H) continue;
        const i = py * this.W + px;
        this.tilePx[y * map.w + x] = i;
        const c = TILE_COLORS[map.tiles[y * map.w + x]] ?? BG;
        this.base[i] = this.base[i + 1] = this.base[i + this.W] = this.base[i + this.W + 1] = c;
      }
  }

  draw(snap: Snapshot, viewCorners: { x: number; y: number }[]) {
    const map = this.map;
    if (!map) return;
    const px = this.px;
    const W = this.W;
    px.set(this.base);
    for (let t = 0; t < this.tilePx.length; t++) {
      if (snap.vis[t]) continue;
      const i = this.tilePx[t];
      if (i < 0) continue;
      px[i] = darken(px[i]);
      px[i + 1] = darken(px[i + 1]);
      px[i + W] = darken(px[i + W]);
      px[i + W + 1] = darken(px[i + W + 1]);
    }
    for (const u of snap.units) {
      if (u.s === Side.Neutral) continue;
      const p = this.toMini(u.x, u.y);
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      const c = u.s === Side.Police ? POLICE : DEMO;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x < W && y < this.H) px[y * W + x] = c;
        }
    }
    this.ctx.putImageData(this.img, 0, 0);
    const c = this.ctx;
    const o = map.objective;
    const rects = o.type === 'blockade' ? o.points.map((p) => ({ x0: p.x - 1, y0: p.y - 1, x1: p.x + 1, y1: p.y + 1 })) : [o.rect];
    c.strokeStyle = '#ffd166';
    c.lineWidth = 1;
    for (const r of rects) this.poly([this.toMini(r.x0, r.y0), this.toMini(r.x1 + 1, r.y0), this.toMini(r.x1 + 1, r.y1 + 1), this.toMini(r.x0, r.y1 + 1)]);
    c.strokeStyle = '#ffffff';
    this.poly(viewCorners.map((w) => this.toMini(w.x, w.y)));
  }

  private poly(pts: { x: number; y: number }[]) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    c.closePath();
    c.stroke();
  }
}
