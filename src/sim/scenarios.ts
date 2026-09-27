import { Point, Rect } from './map';
import { Kind } from './types';

export type Objective =
  | { type: 'blockade'; points: Point[]; target: number }
  | { type: 'reach'; rect: Rect; count: number; holdTicks: number };

export interface Scenario {
  id: string;
  durationTicks: number;
  objective: Objective;
  police: [Kind, number][];
  demo: [Kind, number][];
  funds: [number, number];
  demoSpawn: Point;
  policeSpawn: Point;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'taubensteuer',
    durationTicks: 6000, // 10 min game time
    objective: {
      type: 'blockade',
      points: [
        { x: 31, y: 25 },
        { x: 43, y: 31 },
        { x: 37, y: 43 },
        { x: 25, y: 37 },
      ],
      target: 1000,
    },
    police: [
      [Kind.Polizist, 8],
      [Kind.Transporter, 1],
      [Kind.Loesetrupp, 2],
    ],
    demo: [
      [Kind.Demonstrant, 10],
      [Kind.Kleber, 3],
      [Kind.Organisator, 1],
    ],
    funds: [60, 40],
    demoSpawn: { x: 7, y: 55 },
    policeSpawn: { x: 7, y: 7 },
  },
  {
    id: 'kuhglocken',
    durationTicks: 6000,
    objective: { type: 'reach', rect: { x0: 31, y0: 31, x1: 37, y1: 37 }, count: 15, holdTicks: 450 },
    police: [
      [Kind.Polizist, 8],
      [Kind.Bereitschaft, 2],
      [Kind.Reiter, 1],
      [Kind.Transporter, 1],
    ],
    demo: [
      [Kind.Demonstrant, 18],
      [Kind.Organisator, 2],
      [Kind.Autotrupp, 1],
    ],
    funds: [80, 50],
    demoSpawn: { x: 55, y: 55 },
    policeSpawn: { x: 7, y: 7 },
  },
  {
    id: 'gartenzwerge',
    durationTicks: 7200,
    objective: { type: 'reach', rect: { x0: 14, y0: 14, x1: 24, y1: 24 }, count: 12, holdTicks: 450 },
    police: [
      [Kind.Polizist, 10],
      [Kind.Bereitschaft, 3],
      [Kind.Reiter, 1],
      [Kind.Wasserwerfer, 1],
      [Kind.Transporter, 2],
      [Kind.Loesetrupp, 1],
    ],
    demo: [
      [Kind.Demonstrant, 16],
      [Kind.Kleber, 3],
      [Kind.Organisator, 1],
      [Kind.Autotrupp, 2],
    ],
    funds: [100, 60],
    demoSpawn: { x: 7, y: 55 },
    policeSpawn: { x: 19, y: 19 },
  },
];

export function scenarioById(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

/** Points the AI (and HUD) treat as the scenario's hot spots. */
export function objectivePoints(o: Objective): Point[] {
  if (o.type === 'blockade') return o.points;
  const cx = Math.floor((o.rect.x0 + o.rect.x1) / 2);
  const cy = Math.floor((o.rect.y0 + o.rect.y1) / 2);
  return [{ x: cx, y: cy }];
}
