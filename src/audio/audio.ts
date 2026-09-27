import { Synth } from './synth';
import { TRACKS, Track, TrackId } from './tracks';

/** Step sequencer + sound effects. Created lazily on the first user gesture (autoplay policy). */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private synth!: Synth;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private track: Track | null = null;
  private trackId: TrackId | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | undefined;
  private byStep: Map<number, { inst: Track['channels'][number]['inst']; gain: number; midi: number; len: number; vel: number }[]>[] = [];
  musicOn = true;
  sfxOn = true;
  private lastSfx = new Map<string, number>();

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.synth = new Synth(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.6;
    // small hall reverb, generated
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.2;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.sfxBus.connect(this.master);
    this.reverb.connect(wet).connect(this.master);
    if (this.trackId) this.play(this.trackId, true);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.1);
  }

  get current(): TrackId | null {
    return this.trackId;
  }

  play(id: TrackId, force = false) {
    if (this.trackId === id && !force && this.timer !== undefined) return;
    this.trackId = id;
    if (!this.ctx) return;
    const t = TRACKS[id];
    this.track = t;
    this.byStep = t.channels.map((c) => {
      const m = new Map<number, { inst: typeof c.inst; gain: number; midi: number; len: number; vel: number }[]>();
      for (const n of c.notes) {
        const arr = m.get(n.step) ?? [];
        arr.push({ inst: c.inst, gain: c.gain, midi: n.midi, len: n.len, vel: n.vel });
        m.set(n.step, arr);
      }
      return m;
    });
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.12;
    if (this.timer === undefined) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.track = null;
    this.trackId = null;
  }

  private schedule() {
    const ctx = this.ctx;
    const t = this.track;
    if (!ctx || !t) return;
    const stepDur = 60 / t.bpm / 4;
    const total = t.bars * 16;
    while (this.nextTime < ctx.currentTime + 0.15) {
      if (this.step >= total) {
        if (!t.loop) {
          this.track = null;
          return;
        }
        this.step = 0;
      }
      const swing = this.step % 2 === 1 ? t.swing * stepDur * 2 : 0;
      if (this.musicOn) {
        for (const ch of this.byStep) {
          const notes = ch.get(this.step);
          if (!notes) continue;
          for (const n of notes) this.synth.play(n.inst, this.nextTime + swing, n.midi, n.len * stepDur, n.vel * n.gain, this.musicBus);
        }
      }
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // ---------------------------------------------------------------- sound effects

  private can(key: string, gapMs: number): boolean {
    if (!this.ctx || !this.sfxOn) return false;
    const now = performance.now();
    if ((this.lastSfx.get(key) ?? 0) + gapMs > now) return false;
    this.lastSfx.set(key, now);
    return true;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, freq: number, type: BiquadFilterType, vol: number, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.synth.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  click() {
    if (this.can('click', 40)) this.tone('square', 1200, 900, 0.04, 0.08);
  }

  ack(police: boolean) {
    if (!this.can('ack', 120)) return;
    if (police) {
      this.tone('square', 520, 520, 0.06, 0.06);
      this.tone('square', 780, 780, 0.06, 0.06, 0.07);
    } else {
      this.tone('sine', 900, 1500, 0.12, 0.08); // whistle
    }
  }

  /** German "Martinshorn": two alternating tones */
  siren() {
    if (!this.can('siren', 3000)) return;
    for (let i = 0; i < 4; i++) {
      this.tone('sawtooth', 440, 440, 0.32, 0.035, i * 0.64);
      this.tone('sawtooth', 587, 587, 0.32, 0.035, i * 0.64 + 0.32);
    }
  }

  spray() {
    if (this.can('spray', 300)) this.noise(0.9, 1200, 'bandpass', 0.35);
  }

  fire() {
    if (!this.can('fire', 500)) return;
    this.noise(1.2, 400, 'lowpass', 0.4);
    for (let i = 0; i < 6; i++) this.noise(0.04, 3000, 'highpass', 0.2, 0.1 + Math.random() * 0.9);
  }

  arrest() {
    if (!this.can('arrest', 200)) return;
    this.tone('square', 2000, 1800, 0.03, 0.06);
    this.tone('square', 2200, 2000, 0.03, 0.06, 0.08);
  }

  megaphone() {
    if (!this.can('mega', 800)) return;
    // "Wir – sind – hier!" as three bandpassed chant syllables
    [0, 0.28, 0.56].forEach((d, i) => {
      const c = this.ctx!;
      const t = c.currentTime + d;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime([220, 247, 294][i], t);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1100;
      f.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      o.connect(f).connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + 0.3);
    });
  }

  recruit() {
    if (this.can('recruit', 200)) {
      this.tone('triangle', 660, 660, 0.08, 0.1);
      this.tone('triangle', 880, 880, 0.12, 0.1, 0.08);
    }
  }

  injury() {
    if (this.can('injury', 400)) this.tone('sine', 180, 60, 0.35, 0.3);
  }

  news() {
    if (!this.can('news', 4000)) return;
    // TV news jingle
    this.tone('triangle', 784, 784, 0.12, 0.12);
    this.tone('triangle', 988, 988, 0.12, 0.12, 0.13);
    this.tone('triangle', 1175, 1175, 0.3, 0.12, 0.26);
  }

  horse() {
    if (!this.can('horse', 700)) return;
    for (let i = 0; i < 4; i++) this.noise(0.05, 900, 'bandpass', 0.25, i * 0.11 + (i % 2) * 0.03);
  }

  cash() {
    if (this.can('cash', 150)) {
      this.tone('square', 1318, 1318, 0.05, 0.05);
      this.tone('square', 1760, 1760, 0.12, 0.05, 0.05);
    }
  }
}
