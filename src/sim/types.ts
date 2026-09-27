// Shared simulation types and balance constants.

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

export enum Side {
  Police = 0,
  Demo = 1,
  Neutral = 2,
}

export enum Tile {
  Grass = 0,
  Road = 1,
  Building = 2,
  Plaza = 3,
  Park = 4,
  Water = 5,
  Parking = 6,
}

export enum District {
  Altstadt = 0,
  Regierungsviertel = 1,
  Geschaeftsviertel = 2,
  Wohngebiet = 3,
  Industriegebiet = 4,
}

export enum Kind {
  Polizist = 0,
  Bereitschaft = 1,
  Reiter = 2,
  Wasserwerfer = 3,
  Transporter = 4,
  Loesetrupp = 5,
  Demonstrant = 10,
  Kleber = 11,
  Organisator = 12,
  Autotrupp = 13,
  Passant = 20,
  Presse = 21,
}

export interface KindStats {
  side: Side;
  speed: number; // tiles per tick
  sight: number; // tiles
  cost: number;
  vehicle: boolean; // vehicles only drive on roads, plazas and parking
}

export const STATS: Record<number, KindStats> = {
  [Kind.Polizist]: { side: Side.Police, speed: 0.11, sight: 6, cost: 10, vehicle: false },
  [Kind.Bereitschaft]: { side: Side.Police, speed: 0.09, sight: 6, cost: 22, vehicle: false },
  [Kind.Reiter]: { side: Side.Police, speed: 0.2, sight: 8, cost: 30, vehicle: false },
  [Kind.Wasserwerfer]: { side: Side.Police, speed: 0.12, sight: 7, cost: 55, vehicle: true },
  [Kind.Transporter]: { side: Side.Police, speed: 0.15, sight: 5, cost: 25, vehicle: true },
  [Kind.Loesetrupp]: { side: Side.Police, speed: 0.1, sight: 5, cost: 18, vehicle: false },
  [Kind.Demonstrant]: { side: Side.Demo, speed: 0.1, sight: 5, cost: 5, vehicle: false },
  [Kind.Kleber]: { side: Side.Demo, speed: 0.1, sight: 5, cost: 14, vehicle: false },
  [Kind.Organisator]: { side: Side.Demo, speed: 0.1, sight: 7, cost: 28, vehicle: false },
  [Kind.Autotrupp]: { side: Side.Demo, speed: 0.12, sight: 5, cost: 24, vehicle: false },
  [Kind.Passant]: { side: Side.Neutral, speed: 0.05, sight: 0, cost: 0, vehicle: false },
  [Kind.Presse]: { side: Side.Neutral, speed: 0.11, sight: 7, cost: 0, vehicle: false },
};

export const POLICE_KINDS: Kind[] = [
  Kind.Polizist,
  Kind.Bereitschaft,
  Kind.Reiter,
  Kind.Wasserwerfer,
  Kind.Transporter,
  Kind.Loesetrupp,
];
export const DEMO_KINDS: Kind[] = [Kind.Demonstrant, Kind.Kleber, Kind.Organisator, Kind.Autotrupp];

export type Ability = 'sit' | 'glue' | 'carblock' | 'burn' | 'megaphone' | 'stance';

export const ABILITIES: Record<number, Ability[]> = {
  [Kind.Polizist]: ['stance'],
  [Kind.Bereitschaft]: ['stance'],
  [Kind.Reiter]: ['stance'],
  [Kind.Wasserwerfer]: ['stance'],
  [Kind.Transporter]: [],
  [Kind.Loesetrupp]: [],
  [Kind.Demonstrant]: ['sit'],
  [Kind.Kleber]: ['sit', 'glue'],
  [Kind.Organisator]: ['sit', 'megaphone'],
  [Kind.Autotrupp]: ['carblock', 'burn'],
};

/** Balance numbers. Opinion: 0 = fully pro police, 100 = fully pro demonstrators. */
export const BAL = {
  startOpinion: 50,
  pressRadius: 6,
  pressMultiplier: 3,
  arrestTicks: 20,
  arrestTicksSitting: 45,
  arrestTicksRiot: 12,
  transporterCapacity: 10,
  loadTicks: 4,
  releaseTicks: 600,
  ungluedTicks: 70,
  glueTicks: 20,
  clearBarrierTicks: 50,
  carblockTicks: 30,
  burnTicks: 900,
  extinguishTicks: 25,
  sprayInterval: 20,
  sprayRange: 4.5,
  horseInterval: 20,
  megaphoneCooldown: 200,
  recruitInterval: 50,
  moraleStart: 70,
  moraleHome: 12,
  passants: 45,
  pressCrews: 2,
  trafficCars: 140,
  // opinion deltas (positive = toward demonstrators)
  opArrestPeaceful: 0.35,
  opArrestViolent: -0.3,
  opSpray: 0.9,
  opInjury: 1.2,
  opExtinguish: -0.4,
  opBurn: -4.0,
  opCarblock: -0.6,
  opMegaphone: 0.15,
  opJamPerCarPerSec: -0.004,
  opDriftPerSec: 0.01,
};

export const PARKED_BURNING = 1;
export const PARKED_WRECK = 2;
export const PARKED_OK = 0;
