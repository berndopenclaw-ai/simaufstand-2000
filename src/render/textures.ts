import { Container, Graphics, Renderer, Texture } from 'pixi.js';
import { Kind } from '../sim/types';
import { isoQuad } from './iso';

export interface Tex {
  tex: Texture;
  ax: number;
  ay: number;
}

type G = Graphics;

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIR = [0x2b1b0e, 0x6a4e23, 0xd6b370, 0x111111, 0x8b3a1a];
export const DEMO_SHIRTS = [0xd94f4f, 0x3fa34d, 0xe9c46a, 0x9b5de5, 0x2a9d8f, 0xf4a261, 0x4d96ff, 0xef476f];
export const CAR_COLORS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e, 0x8e44ad, 0xd35400];

interface PersonStyle {
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
  hat?: 'cap' | 'helmet' | 'beanie' | 'hood';
  hatColor?: number;
  vest?: number;
  sign?: number;
  shield?: boolean;
  megaphone?: boolean;
  camera?: boolean;
  bucket?: boolean;
}

function person(g: G, s: PersonStyle, pose: 'stand' | 'sit') {
  const dark = (c: number) => ((((c >> 16) & 255) * 0.7) << 16) | ((((c >> 8) & 255) * 0.7) << 8) | ((c & 255) * 0.7);
  g.ellipse(0, 0, 6, 2.5).fill({ color: 0x000000, alpha: 0.25 });
  let top: number;
  if (pose === 'stand') {
    g.rect(-3.5, -9, 3, 9).fill(s.pants);
    g.rect(0.5, -9, 3, 9).fill(dark(s.pants));
    g.rect(-3.5, -1, 3, 1.5).fill(0x222222);
    g.rect(0.5, -1, 3, 1.5).fill(0x222222);
    g.rect(-4.5, -18, 9, 10).fill(s.shirt);
    if (s.vest) g.rect(-4.5, -17, 9, 7).fill(s.vest);
    g.rect(-6, -17, 2, 8).fill(dark(s.shirt));
    g.rect(4, -17, 2, 8).fill(dark(s.shirt));
    top = -18;
  } else {
    g.rect(-5, -4, 11, 4).fill(s.pants);
    g.rect(4, -4, 3, 4).fill(0x222222);
    g.rect(-4.5, -12, 8, 9).fill(s.shirt);
    if (s.vest) g.rect(-4.5, -11, 8, 6).fill(s.vest);
    g.rect(-6, -10, 2, 6).fill(dark(s.shirt));
    top = -12;
  }
  // head
  g.rect(-3, top - 6, 6, 6).fill(s.skin);
  g.rect(-3, top - 7, 6, 2.5).fill(s.hair);
  g.rect(1, top - 4, 1, 1).fill(0x222222);
  if (s.hat === 'cap') {
    g.rect(-3.5, top - 9, 7, 3).fill(s.hatColor ?? 0x1b2f5c);
    g.rect(-3.5, top - 6.5, 8.5, 1.2).fill(0x111111);
    g.rect(-3.5, top - 7.5, 7, 0.8).fill(0xffffff);
  } else if (s.hat === 'helmet') {
    g.roundRect(-4, top - 9.5, 8, 6, 2).fill(s.hatColor ?? 0x1c2a44);
    g.rect(-1, top - 5, 5, 3).fill({ color: 0xaad4ff, alpha: 0.7 });
  } else if (s.hat === 'beanie') {
    g.rect(-3.5, top - 9, 7, 4).fill(s.hatColor ?? 0x333333);
  } else if (s.hat === 'hood') {
    g.rect(-3.8, top - 8, 7.6, 3.5).fill(s.hatColor ?? 0x222222);
    g.rect(-3.8, top - 3, 7.6, 2.4).fill(0x222222);
  }
  if (s.sign && pose === 'stand') {
    g.rect(5, top - 16, 1.2, 16).fill(0x8b5a2b);
    g.rect(0, top - 23, 12, 8).fill(0xfafafa);
    g.rect(0, top - 23, 12, 8).stroke({ color: 0x444444, width: 0.8 });
    g.rect(1.5, top - 21, 9, 1.4).fill(s.sign);
    g.rect(1.5, top - 18.5, 6, 1.4).fill(s.sign);
  }
  if (s.shield) {
    g.roundRect(-9, top + 1, 5, 13, 1).fill({ color: 0xbfd3e6, alpha: 0.85 });
    g.roundRect(-9, top + 1, 5, 13, 1).stroke({ color: 0x5a6f86, width: 0.8 });
  }
  if (s.megaphone) {
    g.poly([5, top + 3, 11, top, 11, top + 7]).fill(0xdddddd);
    g.rect(4, top + 2.5, 2, 2).fill(0x555555);
  }
  if (s.camera) {
    g.rect(2, top - 7, 9, 5).fill(0x222222);
    g.rect(10, top - 6, 2.5, 3).fill(0x555555);
    g.rect(3, top - 6, 3, 1.2).fill(0xe63946);
  }
  if (s.bucket) {
    g.rect(5, top + 5, 4, 5).fill(0x3b82f6);
  }
}

function horse(g: G) {
  g.ellipse(0, 0, 12, 3.5).fill({ color: 0x000000, alpha: 0.25 });
  const brown = 0x7b4a24;
  const darkB = 0x5a3419;
  // legs
  for (const lx of [-8, -5, 5, 8]) g.rect(lx, -9, 2, 9).fill(lx < 0 ? darkB : brown);
  g.roundRect(-10, -17, 20, 9, 3).fill(brown);
  g.rect(-12, -16, 3, 7).fill(0x2b1b0e); // tail
  g.poly([7, -16, 11, -26, 15, -24, 12, -14]).fill(brown); // neck
  g.roundRect(11, -28, 8, 5, 1.5).fill(brown); // head
  g.rect(9, -27, 3, 7).fill(0x2b1b0e); // mane
  // rider
  g.rect(-3, -27, 7, 10).fill(0x1d3b6e);
  g.rect(-2, -20, 5, 5).fill(0x2c3e50);
  g.rect(-2, -33, 6, 6).fill(0xf1c27d);
  g.roundRect(-2.5, -36, 7, 4.5, 2).fill(0xf4f4f4);
}

function box(g: G, lx: number, ly: number, h: number, top: number, left: number, right: number, z0 = 0, drawTop = true) {
  const x0 = -lx / 2;
  const x1 = lx / 2;
  const y0 = -ly / 2;
  const y1 = ly / 2;
  // left face (y = y1) and right face (x = x1)
  const bl = isoQuad(x0, y1, x1, y1, z0);
  const tl = isoQuad(x0, y1, x1, y1, z0 + h);
  g.poly([bl[0], bl[1], bl[2], bl[3], tl[2], tl[3], tl[0], tl[1]]).fill(left);
  const br = isoQuad(x1, y0, x1, y1, z0);
  const tr = isoQuad(x1, y0, x1, y1, z0 + h);
  g.poly([br[0], br[1], br[4], br[5], tr[4], tr[5], tr[0], tr[1]]).fill(right);
  if (drawTop) g.poly(isoQuad(x0, y0, x1, y1, z0 + h)).fill(top);
}

/** A vehicle box oriented along the given direction (0 E, 1 W, 2 S, 3 N). */
function vehicle(
  g: G,
  dir: number,
  len: number,
  wid: number,
  h: number,
  colors: { top: number; left: number; right: number; stripe?: number },
  extras: (g: G, along: (t: number, s: number) => [number, number], h: number) => void,
) {
  const alongX = dir < 2;
  const lx = alongX ? len : wid;
  const ly = alongX ? wid : len;
  g.poly(isoQuad(-lx / 2 - 0.03, -ly / 2 - 0.03, lx / 2 + 0.03, ly / 2 + 0.03)).fill({ color: 0x000000, alpha: 0.25 });
  box(g, lx, ly, h, colors.top, colors.left, colors.right, 2);
  if (colors.stripe !== undefined) {
    box(g, lx, ly, 2.5, colors.stripe, colors.stripe, colors.stripe, 2 + h * 0.4, false);
  }
  const sign = dir === 0 || dir === 2 ? 1 : -1;
  // along(t, s): t along length (-0.5..0.5), s across width (-0.5..0.5) -> tile coords
  const along = (t: number, s: number): [number, number] => (alongX ? [t * len * sign, s * wid] : [s * wid, t * len * sign]);
  extras(g, along, h + 2);
}

function quadAt(along: (t: number, s: number) => [number, number], t0: number, t1: number, s0: number, s1: number, z: number): number[] {
  const pts = [along(t0, s0), along(t1, s0), along(t1, s1), along(t0, s1)];
  const out: number[] = [];
  for (const [x, y] of pts) {
    const q = isoQuad(x, y, x, y, z);
    out.push(q[0], q[1]);
  }
  return out;
}

export class TextureBank {
  private cache = new Map<string, Tex>();
  constructor(private renderer: Renderer) {}

  private make(key: string, draw: (g: G) => void): Tex {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const g = new Graphics();
    draw(g);
    const c = new Container();
    c.addChild(g);
    const b = g.getLocalBounds();
    const tex = this.renderer.generateTexture({ target: c, resolution: 2, antialias: false });
    tex.source.scaleMode = 'nearest';
    const t: Tex = { tex, ax: -b.x / b.width, ay: -b.y / b.height };
    this.cache.set(key, t);
    g.destroy();
    return t;
  }

  unit(kind: Kind, variant: number, pose: 'stand' | 'sit', dir: number): Tex {
    const key = `u${kind}-${kind === Kind.Demonstrant || kind === Kind.Passant ? variant % 8 : 0}-${pose}-${dir}`;
    return this.make(key, (g) => this.drawUnit(g, kind, variant, pose, dir));
  }

  private drawUnit(g: G, kind: Kind, variant: number, pose: 'stand' | 'sit', dir: number) {
    const skin = SKIN[variant % SKIN.length];
    const hair = HAIR[(variant >> 2) % HAIR.length];
    switch (kind) {
      case Kind.Polizist:
        return person(g, { shirt: 0x1d3b6e, pants: 0x1b2a44, skin, hair, hat: 'cap', hatColor: 0x14264a }, pose);
      case Kind.Bereitschaft:
        return person(g, { shirt: 0x243447, pants: 0x1a2533, skin, hair, hat: 'helmet', shield: true }, pose);
      case Kind.Loesetrupp:
        return person(g, { shirt: 0xe8e8e8, pants: 0xd0d0d0, skin, hair, hat: 'helmet', hatColor: 0x1d4ed8, bucket: true }, pose);
      case Kind.Reiter:
        return horse(g);
      case Kind.Demonstrant:
        return person(
          g,
          {
            shirt: DEMO_SHIRTS[variant % 8],
            pants: [0x2f3e5c, 0x3b3b3b, 0x5a4632][variant % 3],
            skin,
            hair,
            hat: variant % 5 === 0 ? 'beanie' : undefined,
            hatColor: DEMO_SHIRTS[(variant + 3) % 8],
            sign: variant % 2 === 0 ? DEMO_SHIRTS[(variant + 2) % 8] : undefined,
          },
          pose,
        );
      case Kind.Kleber:
        return person(g, { shirt: 0x6ab04c, pants: 0x2f3e5c, skin, hair, vest: 0xff9f1c }, pose);
      case Kind.Organisator:
        return person(g, { shirt: 0xb83280, pants: 0x2f3e5c, skin, hair, vest: 0xffe066, megaphone: pose === 'stand' }, pose);
      case Kind.Autotrupp:
        return person(g, { shirt: 0x1f1f1f, pants: 0x2b2b2b, skin, hair, hat: 'hood', hatColor: 0x1a1a1a }, pose);
      case Kind.Passant:
        return person(g, { shirt: [0xa68a64, 0x7f8c8d, 0xc9ada7, 0x6d597a, 0x9a8c98][variant % 5], pants: 0x4a4e69, skin, hair }, pose);
      case Kind.Presse:
        return person(g, { shirt: 0x3d5a80, pants: 0x293241, skin, hair, camera: true }, pose);
      case Kind.Wasserwerfer:
        return vehicle(g, dir, 1.05, 0.46, 15, { top: 0xf2f2f2, left: 0xd9d9d9, right: 0xbfbfbf, stripe: 0x2e8b57 }, (gg, along, h) => {
          gg.poly(quadAt(along, 0.3, 0.48, -0.45, 0.45, h)).fill(0x2b3a4a); // windshield
          gg.poly(quadAt(along, -0.05, 0.05, -0.12, 0.12, h + 3)).fill(0x444444); // cannon mount
          const [cx, cy] = along(0.18, 0);
          const q = isoQuad(cx, cy, cx, cy, h + 4);
          const [ex, ey] = along(0.55, 0);
          const e = isoQuad(ex, ey, ex, ey, h + 5);
          gg.moveTo(q[0], q[1]).lineTo(e[0], e[1]).stroke({ color: 0x333333, width: 2.2 });
          gg.poly(quadAt(along, -0.45, -0.35, -0.3, 0.3, h + 0.5)).fill(0x2563eb); // blue light bar
        });
      case Kind.Transporter:
        return vehicle(g, dir, 0.85, 0.42, 13, { top: 0xf2f2f2, left: 0xd9d9d9, right: 0xbfbfbf, stripe: 0x2e8b57 }, (gg, along, h) => {
          gg.poly(quadAt(along, 0.28, 0.46, -0.44, 0.44, h)).fill(0x2b3a4a);
          gg.poly(quadAt(along, 0.05, 0.2, -0.3, 0.3, h + 0.5)).fill(0x2563eb);
          gg.poly(quadAt(along, -0.4, 0.0, -0.42, 0.42, h + 0.2)).fill(0xe5e5e5);
        });
      default:
        return person(g, { shirt: 0xff00ff, pants: 0x000000, skin, hair }, pose);
    }
  }

  car(dir: number, state: 'ok' | 'wreck' = 'ok'): Tex {
    return this.make(`car-${dir}-${state}`, (g) => {
      const wreck = state === 'wreck';
      vehicle(
        g,
        dir,
        0.55,
        0.3,
        6,
        wreck ? { top: 0x2b2b2b, left: 0x1e1e1e, right: 0x161616 } : { top: 0xffffff, left: 0xcfcfcf, right: 0xa8a8a8 },
        (gg, along, h) => {
          gg.poly(quadAt(along, -0.3, 0.25, -0.42, 0.42, h + 3)).fill(wreck ? 0x333333 : 0xe9e9e9);
          if (!wreck) {
            gg.poly(quadAt(along, 0.1, 0.25, -0.42, 0.42, h + 3)).fill(0x4a5a6a);
            gg.poly(quadAt(along, -0.3, -0.18, -0.42, 0.42, h + 3)).fill(0x4a5a6a);
          } else {
            gg.poly(quadAt(along, -0.1, 0.1, -0.2, 0.3, h + 3.2)).fill(0x5a3a20);
          }
        },
      );
    });
  }

  ring(): Tex {
    return this.make('ring', (g) => {
      g.ellipse(0, 0, 9, 4.5).stroke({ color: 0x7cfc00, width: 1.5 });
    });
  }

  vehicleRing(): Tex {
    return this.make('ring-v', (g) => {
      g.ellipse(0, 0, 22, 11).stroke({ color: 0x7cfc00, width: 1.5 });
    });
  }

  flame(frame: number): Tex {
    return this.make(`flame-${frame}`, (g) => {
      const f = [0, 1.5, -1, 1][frame % 4];
      g.poly([-7, 0, -3 + f, -14, 0, -6, 3 - f, -18, 7, 0]).fill(0xff6b00);
      g.poly([-4, 0, -1 + f, -9, 1, -4, 3 - f, -11, 5, 0]).fill(0xffd000);
    });
  }

  puff(): Tex {
    return this.make('puff', (g) => g.circle(0, 0, 5).fill({ color: 0x555555, alpha: 0.6 }));
  }

  drop(): Tex {
    return this.make('drop', (g) => g.rect(-1.2, -1.2, 2.4, 2.4).fill(0xbfe6ff));
  }

  icon(kind: 'cuffs' | 'cross' | 'plus' | 'live' | 'glue' | 'note'): Tex {
    return this.make(`icon-${kind}`, (g) => {
      switch (kind) {
        case 'cuffs':
          g.circle(-3, 0, 2.5).stroke({ color: 0xdddddd, width: 1.3 });
          g.circle(3, 0, 2.5).stroke({ color: 0xdddddd, width: 1.3 });
          break;
        case 'cross':
          g.rect(-5, -5, 10, 10).fill(0xffffff);
          g.rect(-1.5, -4, 3, 8).fill(0xe63946);
          g.rect(-4, -1.5, 8, 3).fill(0xe63946);
          break;
        case 'plus':
          g.rect(-1.5, -4.5, 3, 9).fill(0x7cfc00);
          g.rect(-4.5, -1.5, 9, 3).fill(0x7cfc00);
          break;
        case 'live':
          g.roundRect(-10, -5, 20, 10, 2).fill(0xe63946);
          g.circle(-6, 0, 1.8).fill(0xffffff);
          g.rect(-3, -2.5, 1.2, 5).fill(0xffffff);
          g.rect(-3, 1.3, 3, 1.2).fill(0xffffff);
          g.rect(1, -2.5, 1.2, 5).fill(0xffffff);
          g.poly([3.5, -2.5, 5, 2.5, 6.5, -2.5]).stroke({ color: 0xffffff, width: 1.1 });
          break;
        case 'glue':
          g.ellipse(0, 0, 8, 3).fill({ color: 0xfff176, alpha: 0.85 });
          break;
        case 'note':
          g.rect(0, -8, 1.3, 8).fill(0xffffff);
          g.ellipse(-1, 0, 2.2, 1.6).fill(0xffffff);
          g.rect(0, -8, 4, 1.3).fill(0xffffff);
          break;
      }
    });
  }
}
