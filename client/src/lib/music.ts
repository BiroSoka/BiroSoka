import { sfx } from './audio';

/**
 * Background music: a relaxed lo-fi loop generated live (chords, bass, soft drums and a
 * randomly picked pentatonic melody), so it never repeats exactly. Plays only while a match
 * is on screen and has its own on/off switch, separate from sound effects.
 */
const BPM = 84;
const BEAT = 60 / BPM;
const STEP = BEAT / 2; // eighth notes
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Am9 - Fmaj7 - C6 - G6, one bar each.
const PROGRESSION: { bass: number; chord: number[] }[] = [
  { bass: 45, chord: [57, 60, 64, 67, 71] },
  { bass: 41, chord: [53, 57, 60, 64, 67] },
  { bass: 36, chord: [55, 60, 64, 67, 69] },
  { bass: 43, chord: [55, 59, 62, 67, 69] },
];
const SCALE = [69, 72, 74, 76, 79, 81, 84]; // A minor pentatonic, upper register
const MUSIC_LEVEL = 0.32;

class Music {
  private out: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private playing = false;
  private lastMelody = 3;

  get isPlaying() {
    return this.playing;
  }

  /** Safe to call repeatedly; does nothing until audio is unlocked by a user gesture. */
  start() {
    if (this.playing || !sfx.enabled) return;
    const g = sfx.graph();
    if (!g) return;
    const { ctx, master } = g;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, ctx.currentTime + 2.5);
    this.out.connect(master);
    this.playing = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.15;
    this.timer = window.setInterval(() => this.schedule(), 100);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const g = sfx.graph();
    const out = this.out;
    this.out = null;
    if (!g || !out) return;
    const t = g.ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    window.setTimeout(() => out.disconnect(), 800);
  }

  /** Background tabs throttle timers; silence the music rather than let it stutter. */
  private onVisibility = () => {
    const g = sfx.graph();
    if (!g) return;
    if (document.hidden) void g.ctx.suspend();
    else {
      void g.ctx.resume();
      this.nextTime = Math.max(this.nextTime, g.ctx.currentTime + 0.1);
    }
  };

  private schedule() {
    const g = sfx.graph();
    if (!g || !this.out) return;
    while (this.nextTime < g.ctx.currentTime + 0.4) {
      this.playStep(g.ctx, g.noise, this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  private playStep(ctx: AudioContext, noise: AudioBuffer, step: number, t: number) {
    const inBar = step % 8;
    const bar = Math.floor(step / 8) % PROGRESSION.length;
    const { bass, chord } = PROGRESSION[bar];
    // Slight swing on the off-beat eighths for a lazy feel.
    const time = inBar % 2 === 1 ? t + STEP * 0.18 : t;

    if (inBar === 0) chord.forEach((n, i) => this.pad(ctx, midi(n), time + i * 0.012, BEAT * 7.6, 0.05));
    if (inBar === 0 || inBar === 5) this.bassNote(ctx, midi(bass - 12), time, BEAT * 1.6);
    if (inBar === 3 && bar % 2 === 1) this.bassNote(ctx, midi(bass - 5), time, BEAT);

    if (inBar === 0 || inBar === 5) this.kick(ctx, time);
    if (inBar === 4) this.snare(ctx, noise, time);
    if (inBar % 2 === 0 || Math.random() < 0.25) this.hat(ctx, noise, time, inBar % 4 === 2 ? 0.05 : 0.03);

    // Sparse melody: mostly stepwise moves through the scale, with plenty of rests.
    if ((inBar === 2 || inBar === 6 || inBar === 7) && Math.random() < 0.55) {
      const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
      this.lastMelody = Math.max(0, Math.min(SCALE.length - 1, this.lastMelody + move));
      this.pluck(ctx, midi(SCALE[this.lastMelody]), time, 0.06 + Math.random() * 0.03);
    }
  }

  private env(ctx: AudioContext, t: number, attack: number, hold: number, release: number, peak: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  private pad(ctx: AudioContext, freq: number, t: number, dur: number, gain: number) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = this.env(ctx, t, 0.5, dur * 0.5, dur * 0.4, gain);
    lp.connect(g).connect(this.out!);
    for (const detune of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private bassNote(ctx: AudioContext, freq: number, t: number, dur: number) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this.env(ctx, t, 0.02, dur * 0.4, dur * 0.6, 0.32);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private pluck(ctx: AudioContext, freq: number, t: number, gain: number) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
    const g = this.env(ctx, t, 0.005, 0.03, 0.55, gain);
    o.connect(lp).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.7);
  }

  private kick(ctx: AudioContext, t: number) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(ctx, t, 0.003, 0.02, 0.2, 0.55);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(ctx: AudioContext, noise: AudioBuffer, t: number) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = this.env(ctx, t, 0.002, 0.01, 0.16, 0.22);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.3, 0.25);
  }

  private hat(ctx: AudioContext, noise: AudioBuffer, t: number, gain: number) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.env(ctx, t, 0.002, 0.005, 0.05, gain);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.3, 0.1);
  }
}

export const music = new Music();
