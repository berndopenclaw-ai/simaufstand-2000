// Tiny General-MIDI-flavoured synthesizer on top of the Web Audio API.
// Every instrument is synthesized at runtime – no samples, no downloads.

export type Instrument = 'epiano' | 'bass' | 'vibes' | 'brass' | 'strings' | 'lead' | 'drums' | 'organ';

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Synth {
  noise: AudioBuffer;
  constructor(public ctx: AudioContext) {
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
  }

  private env(t: number, dur: number, vel: number, a: number, d: number, s: number, r: number): GainNode {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(vel, t + a);
    p.setTargetAtTime(vel * s, t + a, d / 3);
    const end = t + Math.max(dur, a + 0.01);
    p.setTargetAtTime(0.0001, end, r / 3);
    return g;
  }

  play(inst: Instrument, t: number, midi: number, dur: number, vel: number, out: AudioNode) {
    switch (inst) {
      case 'epiano':
        return this.epiano(t, midi, dur, vel, out);
      case 'bass':
        return this.bass(t, midi, dur, vel, out);
      case 'vibes':
        return this.vibes(t, midi, dur, vel, out);
      case 'brass':
        return this.brass(t, midi, dur, vel, out);
      case 'strings':
        return this.strings(t, midi, dur, vel, out);
      case 'lead':
        return this.lead(t, midi, dur, vel, out);
      case 'organ':
        return this.organ(t, midi, dur, vel, out);
      case 'drums':
        return this.drum(t, midi, vel, out);
    }
  }

  private osc(type: OscillatorType, hz: number, t: number, stop: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.detune.setValueAtTime(detune, t);
    o.start(t);
    o.stop(stop);
    return o;
  }

  /** GM 5 "Electric Piano 1": two-operator FM with decaying index */
  private epiano(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 1.2;
    const car = this.osc('sine', hz, t, stop);
    const mod = this.osc('sine', hz, t, stop);
    const idx = this.ctx.createGain();
    idx.gain.setValueAtTime(hz * 1.6, t);
    idx.gain.setTargetAtTime(hz * 0.25, t, 0.15);
    mod.connect(idx).connect(car.frequency);
    const tine = this.osc('sine', hz * 4, t, t + 0.3);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(vel * 0.08, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    tine.connect(tg).connect(out);
    const g = this.env(t, dur, vel * 0.32, 0.004, 1.4, 0.35, 0.35);
    car.connect(g).connect(out);
  }

  /** GM 34 "Electric Bass (finger)" */
  private bass(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 0.4;
    const saw = this.osc('sawtooth', hz, t, stop);
    const sub = this.osc('sine', hz, t, stop);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(hz * 7, t);
    f.frequency.setTargetAtTime(hz * 2.2, t, 0.06);
    const g = this.env(t, dur * 0.95, vel * 0.42, 0.005, 0.5, 0.55, 0.08);
    saw.connect(f).connect(g);
    const sg = this.ctx.createGain();
    sg.gain.value = 0.7;
    sub.connect(sg).connect(g);
    g.connect(out);
  }

  /** GM 12 "Vibraphone" with tremolo */
  private vibes(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 1.6;
    const a = this.osc('sine', hz, t, stop);
    const b = this.osc('sine', hz * 4, t, stop);
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(0.25, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const trem = this.osc('sine', 5.5, t, stop);
    const tg = this.ctx.createGain();
    tg.gain.value = 0.25;
    const g = this.env(t, dur, vel * 0.3, 0.003, 1.8, 0.2, 0.9);
    const am = this.ctx.createGain();
    am.gain.value = 0.8;
    trem.connect(tg).connect(am.gain);
    a.connect(am);
    b.connect(bg).connect(am);
    am.connect(g).connect(out);
  }

  /** GM 62 "Synth Brass 1" */
  private brass(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(hz * 1.2, t);
    f.frequency.linearRampToValueAtTime(hz * 6, t + 0.06);
    f.frequency.setTargetAtTime(hz * 3.5, t + 0.06, 0.2);
    const g = this.env(t, dur, vel * 0.16, 0.03, 0.4, 0.75, 0.15);
    for (const dt of [-8, 8]) this.osc('sawtooth', hz, t, stop, dt).connect(f);
    f.connect(g).connect(out);
  }

  /** GM 49 "String Ensemble 1" */
  private strings(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 1;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(5000, hz * 5);
    const g = this.env(t, dur, vel * 0.07, 0.35, 0.8, 0.9, 0.6);
    for (const dt of [-12, 0, 11]) this.osc('sawtooth', hz, t, stop, dt).connect(f);
    f.connect(g).connect(out);
  }

  /** GM 81 "Lead 1 (square)" with delayed vibrato */
  private lead(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 0.3;
    const o = this.osc('square', hz, t, stop);
    const lfo = this.osc('sine', 5.8, t, stop);
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(hz * 0.012, t + 0.3);
    lfo.connect(depth).connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = hz * 5;
    const g = this.env(t, dur, vel * 0.09, 0.01, 0.3, 0.8, 0.1);
    o.connect(f).connect(g).connect(out);
  }

  /** GM 17 "Drawbar Organ" */
  private organ(t: number, m: number, dur: number, vel: number, out: AudioNode) {
    const hz = midiToHz(m);
    const stop = t + dur + 0.2;
    const g = this.env(t, dur, vel * 0.08, 0.01, 0.1, 1, 0.06);
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.6],
      [3, 0.35],
      [4, 0.25],
    ]) {
      const o = this.osc('sine', hz * mult, t, stop);
      const og = this.ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
    }
    g.connect(out);
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }

  /** GM percussion map: 36 kick, 37 rim, 38 snare, 39 clap, 42 closed hat, 46 open hat, 49 crash, 70 shaker */
  drum(t: number, n: number, vel: number, out: AudioNode) {
    const c = this.ctx;
    if (n === 36) {
      const o = this.osc('sine', 140, t, t + 0.4);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(vel * 0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(out);
      return;
    }
    if (n === 38 || n === 39 || n === 37) {
      const dur = n === 37 ? 0.05 : 0.2;
      const s = this.noiseSrc(t, dur + 0.05);
      const f = c.createBiquadFilter();
      f.type = n === 37 ? 'highpass' : 'bandpass';
      f.frequency.value = n === 37 ? 3000 : n === 39 ? 1400 : 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(vel * (n === 37 ? 0.35 : 0.5), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(out);
      if (n === 38) {
        const o = this.osc('triangle', 190, t, t + 0.1);
        const og = c.createGain();
        og.gain.setValueAtTime(vel * 0.35, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(og).connect(out);
      }
      return;
    }
    // hats, crash, shaker
    const dur = n === 42 ? 0.05 : n === 70 ? 0.07 : n === 46 ? 0.3 : 1.2;
    const s = this.noiseSrc(t, dur + 0.05);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = n === 70 ? 5000 : n === 49 ? 5500 : 7500;
    const g = c.createGain();
    g.gain.setValueAtTime(vel * (n === 49 ? 0.25 : n === 70 ? 0.12 : 0.18), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
  }
}
