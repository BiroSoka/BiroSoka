/**
 * All sound effects are synthesised with the Web Audio API: no audio files to
 * download, license or cache, and they react to impact strength.
 */
class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Shared audio graph, for the music engine. Null until unlock() has run. */
  graph(): { ctx: AudioContext; master: GainNode; noise: AudioBuffer } | null {
    return this.ctx && this.master && this.noise ? { ctx: this.ctx, master: this.master, noise: this.noise } : null;
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    return this.ctx;
  }

  private burst(at: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at, Math.random() * 0.3, dur + 0.02);
  }

  private tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  tap() {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx.currentTime, 900, 0.05, 0.08, 'triangle', 600);
  }

  /** The finger flick: a snap plus a little plastic thunk. */
  flick(power: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.burst(t, 0.035, 0.35 + power * 0.4, 'highpass', 2200);
    this.tone(t, 260 + power * 120, 0.07, 0.25, 'triangle', 120);
  }

  /** Pen on pen: hard plastic clack, louder and brighter for harder hits. */
  hit(strength: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const k = Math.min(1, strength / 9);
    if (k < 0.03) return;
    const t = ctx.currentTime;
    this.burst(t, 0.04 + k * 0.03, 0.25 + k * 0.6, 'bandpass', 2600 + Math.random() * 900, 2.5);
    this.tone(t, 1700 + Math.random() * 400, 0.05, 0.12 + k * 0.22, 'square', 1200);
    this.tone(t, 3400 + Math.random() * 500, 0.03, 0.06 + k * 0.08, 'sine');
  }

  /** Pen drops off the desk and clatters on the floor. */
  fall() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.28;
    this.tone(t, 140, 0.12, 0.3, 'sine', 70);
    let at = t;
    let gain = 0.35;
    for (let i = 0; i < 4; i++) {
      this.burst(at, 0.03, gain, 'bandpass', 3000 - i * 300, 3);
      this.tone(at, 1400 - i * 120, 0.04, gain * 0.5, 'square', 900);
      at += 0.09 - i * 0.015;
      gain *= 0.55;
    }
  }

  place() {
    const ctx = this.ready();
    if (!ctx) return;
    this.burst(ctx.currentTime, 0.03, 0.18, 'bandpass', 1800, 2);
    this.tone(ctx.currentTime, 500, 0.06, 0.08, 'triangle', 300);
  }

  private arp(notes: number[], step: number, dur: number, gain: number, type: OscillatorType) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    notes.forEach((n, i) => this.tone(t + i * step, n, dur, gain, type));
  }

  score() {
    this.arp([523.25, 659.25, 783.99], 0.07, 0.25, 0.18, 'triangle');
  }

  ownGoal() {
    this.arp([392, 311.13, 233.08], 0.1, 0.3, 0.14, 'sawtooth');
  }

  neutral() {
    this.arp([440, 440], 0.12, 0.12, 0.1, 'triangle');
  }

  turn() {
    this.arp([880, 1174.66], 0.06, 0.12, 0.07, 'sine');
  }

  win() {
    this.arp([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], 0.1, 0.4, 0.18, 'triangle');
  }

  lose() {
    this.arp([392, 369.99, 349.23, 329.63], 0.18, 0.45, 0.14, 'triangle');
  }
}

export const sfx = new Sfx();

export function vibrate(enabled: boolean, pattern: number | number[]) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
