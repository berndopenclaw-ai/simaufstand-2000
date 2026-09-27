// Original compositions for SimAufstand 2000, written as step sequences
// (16 steps per bar) in the spirit of mid-90s General MIDI city-builder music.
import type { Instrument } from './synth';

export interface Note {
  step: number; // absolute 16th step in the loop
  midi: number;
  len: number; // in 16th steps
  vel: number;
}

export interface Channel {
  inst: Instrument;
  gain: number;
  notes: Note[];
}

export interface Track {
  name: string;
  bpm: number;
  bars: number;
  swing: number; // 0 = straight, 0.1 = light shuffle
  loop: boolean;
  channels: Channel[];
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteToMidi(n: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) throw new Error(`bad note ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** "C6:4 A5:2 r:2" per bar -> notes. Every bar must add up to 16 steps. */
export function melody(bars: string[], vel = 0.8, startBar = 0): Note[] {
  const out: Note[] = [];
  bars.forEach((bar, b) => {
    let step = 0;
    for (const tok of bar.trim().split(/\s+/)) {
      const [n, l] = tok.split(':');
      const len = Number(l);
      if (n !== 'r') out.push({ step: (startBar + b) * 16 + step, midi: noteToMidi(n), len, vel: vel * (step % 4 === 0 ? 1 : 0.85) });
      step += len;
    }
    if (step !== 16) throw new Error(`bar ${b + 1} has ${step} steps: ${bar}`);
  });
  return out;
}

export interface Chord {
  v: string[]; // voicing
  bass: string; // root in bass octave
}

const ch = (bass: string, ...v: string[]): Chord => ({ bass, v });

/** chord hits at given steps within each bar */
export function comp(chords: Chord[], hits: [number, number, number][]): Note[] {
  const out: Note[] = [];
  chords.forEach((c, b) => {
    for (const [s, len, vel] of hits) for (const n of c.v) out.push({ step: b * 16 + s, midi: noteToMidi(n), len, vel });
  });
  return out;
}

/** bass line: [step, semitone offset from root, len, vel] */
export function bassLine(chords: Chord[], pat: [number, number, number, number][]): Note[] {
  const out: Note[] = [];
  chords.forEach((c, b) => {
    const root = noteToMidi(c.bass);
    for (const [s, off, len, vel] of pat) out.push({ step: b * 16 + s, midi: root + off, len, vel });
  });
  return out;
}

/** drum pattern: map GM drum note -> steps (+ optional velocity per hit) */
export function drums(bars: number, pat: Record<number, number[]>, vel: Record<number, number> = {}, fills: Record<number, Record<number, number[]>> = {}): Note[] {
  const out: Note[] = [];
  for (let b = 0; b < bars; b++) {
    const p = fills[b] ?? pat;
    for (const [n, steps] of Object.entries(p)) {
      for (const s of steps) out.push({ step: b * 16 + s, midi: Number(n), len: 1, vel: (vel[Number(n)] ?? 0.8) * (s % 4 === 0 ? 1 : 0.75) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- "Neustädter Boulevard" (menu, bossa in F)

const boulevardChords: Chord[] = [
  ch('F2', 'A3', 'C4', 'E4', 'A4'),
  ch('D2', 'A3', 'C4', 'F4', 'A4'),
  ch('G2', 'Bb3', 'D4', 'F4', 'Bb4'),
  ch('C2', 'Bb3', 'E4', 'G4', 'Bb4'),
  ch('A2', 'G3', 'C4', 'E4', 'G4'),
  ch('D2', 'A3', 'C4', 'F4', 'A4'),
  ch('G2', 'Bb3', 'D4', 'F4', 'Bb4'),
  ch('C2', 'Bb3', 'E4', 'G4', 'Bb4'),
  ch('Bb2', 'A3', 'D4', 'F4', 'A4'),
  ch('Bb2', 'A3', 'D4', 'F4', 'A4'),
  ch('A2', 'G3', 'C4', 'E4', 'G4'),
  ch('D2', 'A3', 'C4', 'F4', 'A4'),
  ch('G2', 'Bb3', 'D4', 'F4', 'Bb4'),
  ch('C2', 'Bb3', 'E4', 'G4', 'Bb4'),
  ch('F2', 'A3', 'C4', 'E4', 'A4'),
  ch('C2', 'Bb3', 'E4', 'G4', 'Bb4'),
];

export const BOULEVARD: Track = {
  name: 'Neustädter Boulevard',
  bpm: 100,
  bars: 16,
  swing: 0,
  loop: true,
  channels: [
    {
      inst: 'vibes',
      gain: 1,
      notes: melody([
        'C6:4 A5:2 G5:2 A5:6 r:2',
        'F5:4 A5:2 C6:2 D6:6 r:2',
        'D6:4 C6:2 Bb5:2 A5:4 G5:4',
        'E5:4 G5:2 Bb5:2 G5:6 r:2',
        'E5:2 G5:2 A5:2 C6:2 E6:6 r:2',
        'D6:4 C6:2 A5:2 F5:6 r:2',
        'G5:2 A5:2 Bb5:2 D6:2 F6:4 E6:4',
        'D6:4 C6:4 Bb5:4 G5:4',
        'A5:6 F5:2 D5:4 F5:4',
        'A5:2 Bb5:2 C6:2 D6:2 F6:8',
        'E6:4 D6:2 C6:2 A5:8',
        'F5:2 A5:2 D6:4 C6:4 A5:4',
        'Bb5:6 A5:2 G5:4 D5:4',
        'E5:4 G5:4 Bb5:4 C6:4',
        'A5:12 r:4',
        'r:4 G5:2 A5:2 Bb5:2 C6:2 D6:2 E6:2',
      ]),
    },
    {
      inst: 'epiano',
      gain: 0.8,
      notes: comp(boulevardChords, [
        [0, 3, 0.55],
        [3, 2, 0.4],
        [6, 2, 0.45],
        [10, 2, 0.4],
        [13, 3, 0.45],
      ]),
    },
    {
      inst: 'bass',
      gain: 1,
      notes: bassLine(boulevardChords, [
        [0, 0, 3, 0.8],
        [6, 7, 2, 0.6],
        [8, 0, 3, 0.75],
        [14, 7, 2, 0.6],
      ]),
    },
    { inst: 'strings', gain: 0.6, notes: comp(boulevardChords, [[0, 16, 0.35]]) },
    {
      inst: 'drums',
      gain: 0.8,
      notes: drums(16, { 36: [0, 8], 37: [3, 6, 10, 12], 70: [0, 2, 4, 6, 8, 10, 12, 14] }, { 36: 0.7, 37: 0.5, 70: 0.6 }),
    },
  ],
};

// ---------------------------------------------------------------- "Einsatzleitung" (in-game, funk in D dorian)

const einsatzChords: Chord[] = [
  ch('D2', 'F3', 'A3', 'C4', 'E4'),
  ch('D2', 'F3', 'A3', 'C4', 'E4'),
  ch('G2', 'F3', 'B3', 'E4'),
  ch('G2', 'F3', 'B3', 'E4'),
  ch('D2', 'F3', 'A3', 'C4', 'E4'),
  ch('D2', 'F3', 'A3', 'C4', 'E4'),
  ch('G2', 'F3', 'B3', 'E4'),
  ch('G2', 'F3', 'B3', 'E4'),
  ch('Bb2', 'A3', 'D4', 'F4', 'A4'),
  ch('C3', 'A3', 'C4', 'E4', 'G4'),
  ch('A2', 'G3', 'C4', 'E4'),
  ch('D2', 'F3', 'A3', 'C4', 'E4'),
  ch('Bb2', 'A3', 'D4', 'F4', 'A4'),
  ch('C3', 'A3', 'C4', 'E4', 'G4'),
  ch('G2', 'Bb3', 'D4', 'F4'),
  ch('A2', 'G3', 'C#4', 'E4'),
];

export const EINSATZ: Track = {
  name: 'Einsatzleitung',
  bpm: 104,
  bars: 16,
  swing: 0.08,
  loop: true,
  channels: [
    {
      inst: 'vibes',
      gain: 0.9,
      notes: melody([
        'D5:2 F5:2 A5:2 C6:2 A5:4 G5:4',
        'F5:2 E5:2 D5:4 r:8',
        'F5:2 A5:2 B5:2 D6:2 E6:4 D6:4',
        'B5:2 A5:2 G5:4 r:8',
        'D5:2 F5:2 A5:2 C6:2 A5:4 G5:4',
        'F5:2 E5:2 D5:4 r:4 A5:2 C6:2',
        'D6:2 B5:2 A5:2 F5:2 E6:4 D6:4',
        'B5:2 A5:2 G5:4 r:8',
      ]),
    },
    {
      inst: 'brass',
      gain: 0.9,
      notes: melody(
        [
          'F5:4 D5:2 F5:2 A5:8',
          'G5:4 E5:2 G5:2 C6:8',
          'E5:2 G5:2 A5:2 C6:2 E6:4 C6:4',
          'D6:8 A5:8',
          'D6:4 C6:2 Bb5:2 A5:4 F5:4',
          'E5:4 G5:4 A5:4 C6:4',
          'Bb5:4 A5:4 G5:4 F5:4',
          'A5:4 G5:4 E5:4 C#5:4',
        ],
        0.8,
        8,
      ),
    },
    {
      inst: 'epiano',
      gain: 0.75,
      notes: comp(einsatzChords, [
        [2, 1, 0.45],
        [6, 2, 0.5],
        [11, 1, 0.4],
        [14, 2, 0.45],
      ]),
    },
    {
      inst: 'bass',
      gain: 1.05,
      notes: bassLine(einsatzChords, [
        [0, 0, 2, 0.9],
        [3, 12, 1, 0.6],
        [6, 0, 1, 0.7],
        [8, 10, 2, 0.7],
        [11, 7, 1, 0.6],
        [12, 0, 1, 0.75],
        [14, 12, 2, 0.65],
      ]),
    },
    {
      inst: 'drums',
      gain: 0.85,
      notes: drums(
        16,
        { 36: [0, 7, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12], 46: [14] },
        { 36: 0.85, 38: 0.6, 42: 0.5, 46: 0.4 },
        { 7: { 36: [0, 7, 10], 38: [4, 12, 13, 14, 15], 42: [0, 2, 4, 6, 8, 10] }, 15: { 36: [0, 7, 10], 38: [4, 10, 12, 14], 49: [0] } },
      ),
    },
  ],
};

// ---------------------------------------------------------------- "Eskalation" (tension, E minor)

const eskChords: Chord[] = [
  ch('E2', 'G3', 'B3', 'E4'),
  ch('C2', 'G3', 'C4', 'E4'),
  ch('A2', 'A3', 'C4', 'E4'),
  ch('B2', 'F#3', 'A3', 'D#4'),
  ch('E2', 'G3', 'B3', 'E4'),
  ch('C2', 'G3', 'C4', 'E4'),
  ch('D2', 'F#3', 'A3', 'D4'),
  ch('B2', 'F#3', 'A3', 'D#4'),
];

export const ESKALATION: Track = {
  name: 'Eskalation',
  bpm: 128,
  bars: 8,
  swing: 0,
  loop: true,
  channels: [
    {
      inst: 'lead',
      gain: 1,
      notes: melody([
        'E5:4 G5:2 B5:2 A5:4 G5:4',
        'E5:4 G5:2 C6:2 B5:8',
        'A5:4 C6:2 E6:2 D6:4 C6:4',
        'B5:4 A5:2 F#5:2 D#5:8',
        'E5:2 E5:2 G5:2 B5:2 E6:8',
        'D6:4 C6:4 B5:4 G5:4',
        'F#5:4 A5:4 D6:4 C6:4',
        'B5:6 A5:2 F#5:4 D#5:4',
      ]),
    },
    { inst: 'strings', gain: 1, notes: comp(eskChords, [[0, 16, 0.45]]) },
    {
      inst: 'brass',
      gain: 0.9,
      notes: comp(eskChords, [
        [0, 2, 0.55],
        [3, 1, 0.45],
        [10, 2, 0.5],
      ]),
    },
    {
      inst: 'bass',
      gain: 1,
      notes: bassLine(eskChords, [
        [0, 0, 2, 0.9],
        [2, 0, 2, 0.6],
        [4, 0, 2, 0.75],
        [6, 12, 2, 0.6],
        [8, 0, 2, 0.8],
        [10, 0, 2, 0.6],
        [12, 7, 2, 0.7],
        [14, 12, 2, 0.6],
      ]),
    },
    {
      inst: 'drums',
      gain: 0.9,
      notes: drums(8, { 36: [0, 4, 8, 10, 12], 38: [4, 12], 42: [2, 6, 10, 14] }, { 36: 0.9, 38: 0.7, 42: 0.5 }, { 0: { 36: [0, 4, 8, 12], 38: [4, 12], 42: [2, 6, 10, 14], 49: [0] }, 4: { 36: [0, 4, 8, 12], 38: [4, 12], 42: [2, 6, 10, 14], 49: [0] }, 7: { 36: [0, 4, 8], 38: [8, 10, 12, 13, 14, 15] } }),
    },
  ],
};

// ---------------------------------------------------------------- jingles

export const SIEG: Track = {
  name: 'Sieg',
  bpm: 120,
  bars: 2,
  swing: 0,
  loop: false,
  channels: [
    { inst: 'brass', gain: 1.2, notes: melody(['C5:2 E5:2 G5:2 C6:2 G5:2 C6:6', 'C6:16']) },
    { inst: 'strings', gain: 1, notes: comp([ch('C3', 'E4', 'G4', 'C5'), ch('C3', 'E4', 'G4', 'C5')], [[0, 16, 0.5]]) },
    { inst: 'drums', gain: 1, notes: drums(2, { 36: [0], 49: [0] }, {}, { 0: { 38: [0, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15] } }) },
  ],
};

export const NIEDERLAGE: Track = {
  name: 'Niederlage',
  bpm: 84,
  bars: 2,
  swing: 0,
  loop: false,
  channels: [
    { inst: 'epiano', gain: 1.2, notes: melody(['G5:4 Eb5:4 C5:4 B4:4', 'C5:16']) },
    { inst: 'strings', gain: 1, notes: comp([ch('C3', 'C4', 'Eb4', 'G4'), ch('C3', 'Ab3', 'C4', 'Eb4')], [[0, 16, 0.45]]) },
  ],
};

export const TRACKS = { menu: BOULEVARD, game: EINSATZ, tension: ESKALATION, win: SIEG, lose: NIEDERLAGE };
export type TrackId = keyof typeof TRACKS;
