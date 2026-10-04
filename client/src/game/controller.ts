import {
  applyShotResult,
  getSkin,
  isOpeningPosition,
  GUIDE,
  INPUT,

  PEN,
  PACE,
  PHYS,
  previewShot,
  skipTurn,
  TURN,
  wobbleFlick,
  wobbleSigma,
  Sim,
  type Ack,
  type Difficulty,
  type DifficultyProfile,
  type Flick,
  type MatchState,
  type Outcome,
  type Pose,
  type Seat,
  type ShotMessage,
  type ShotPreview,
  type SimEvent,
  type TableThemeId,
} from '@biro/shared';
import { sfx, vibrate } from '../lib/audio';
import { requestAiShot } from './aiClient';
import { ReplayDriver } from './replayDriver';
import { grabInfo, Renderer, type AimVisual, type PenSprite } from './renderer';
import type { Insets } from './view';

/**
 * Turn flow:
 *   ready (my turn) -> aiming -> moving -> [settling: waiting for server verdict] -> resolving -> next turn
 *   thinking (AI) -> ai-aiming -> moving -> ...
 *   waiting (online opponent) -> moving -> ...
 */
export type Phase = 'intro' | 'ready' | 'aiming' | 'thinking' | 'ai-aiming' | 'waiting' | 'moving' | 'settling' | 'resolving' | 'over';

export interface LastShot {
  id: number;
  shooter: Seat;
  outcome: Outcome;
  delta: number;
  /** Whether it was the opening flick of a round (a knockout with it is an ace), and how much spin it had (0..1). */
  opening: boolean;
  spin: number;
}

export interface HudState {
  match: MatchState;
  phase: Phase;
  lastShot: LastShot | null;
  /** The last shot can be watched again right now. */
  replayable: boolean;
  /** A replay is playing (the live game is paused on screen, not stopped). */
  replaying: boolean;
}

/** Phases in which watching a replay cannot get in the way of the live game. */
const REPLAY_PHASES: Phase[] = ['ready', 'waiting', 'thinking', 'over'];

export interface ControllerPrefs {
  guide: 'short' | 'long';
  haptics: boolean;
  theme: TableThemeId;
}

export interface ControllerOptions {
  canvas: HTMLCanvasElement;
  mode: 'ai' | 'online';
  mySeat: Seat;
  skins: [string, string];
  difficulty: Difficulty;
  /** Career opponents: their own settings instead of the level's. */
  aiProfile?: DifficultyProfile;
  match: MatchState;
  /** Hold the first turn (coin toss on screen) until release() is called. */
  startHeld?: boolean;
  prefs: ControllerPrefs;
  onHud: (hud: HudState) => void;
  /** Online only: send my flick to the server. */
  sendShot?: (flick: Flick, shotNo: number) => Promise<Ack>;
  /** Short messages for the player, e.g. when their time runs out. */
  onNotice?: (text: string) => void;
}

interface Resolution {
  shooter: Seat;
  after: MatchState;
  final: (Pose | null)[];
  outcome: Outcome;
  delta: number;
  reset: boolean;
}

interface Drag {
  pointerId: number;
  gx: number;
  grab: { x: number; y: number };
  pointer: { x: number; y: number };
  preview: ShotPreview | null;
  dirty: boolean;
}

interface AiAim {
  flick: Flick;
  grab: { x: number; y: number };
  preview: ShotPreview | null;
  t: number;
  dur: number;
}

interface PenAnim {
  lift: number;
  alpha: number;
  tweenFrom: Pose | null;
  tweenT: number;
}

const TWEEN_TIME = 0.25;
const PLACE_TIME = 0.45;

export class GameController {
  readonly renderer: Renderer;
  private opts: ControllerOptions;
  private match: MatchState;
  private phase: Phase = 'ready';
  private lastShot: LastShot | null = null;
  private shotCounter = 0;

  private sim: Sim | null = null;
  private simAcc = 0;
  private shooter: Seat = 0;
  private flick: Flick | null = null;
  private spinStrength = 0;
  private shotWasOpening = false;
  private expectedShotNo = -1;
  private authority: ShotMessage | null = null;
  private queued: ShotMessage[] = [];

  private display: (Pose | null)[];
  private anims: PenAnim[] = [0, 1].map(() => ({ lift: 0, alpha: 1, tweenFrom: null, tweenT: 1 }));
  private drag: Drag | null = null;
  private aiAim: AiAim | null = null;

  /** Bumped whenever pending timers/promises should be ignored. */
  private epoch = 0;
  private raf = 0;
  private lastTime = 0;
  private resizeObs: ResizeObserver;
  private destroyed = false;
  private held = false;
  private replay = new ReplayDriver();
  /** vs Computer: seconds the human has used on the current turn (online, the server keeps the clock). */
  private turnElapsed = 0;
  private paused = false;
  /** A skip from the server that arrived while a shot was still playing out. */
  private pendingSkip: MatchState | null = null;
  /** vs Computer: the Computer's next shot, already being planned while the last result is on screen. */
  private aiPlan: { shotNo: number; seed: number; started: number; promise: Promise<Flick> } | null = null;

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.held = !!opts.startHeld;
    this.match = opts.match;
    this.display = [...opts.match.pens];
    this.renderer = new Renderer(opts.canvas);
    this.renderer.setTheme(opts.prefs.theme);

    const c = opts.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(c.parentElement ?? c);
    this.resize();
    document.fonts?.ready.then(() => !this.destroyed && this.renderer.invalidateTable());

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.placePens();
    this.nextTurn();
  }

  destroy() {
    this.destroyed = true;
    this.epoch++;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const c = this.opts.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKey);
  }

  // ---- public API ---------------------------------------------------------

  setPrefs(prefs: ControllerPrefs) {
    this.opts.prefs = prefs;
    this.renderer.setTheme(prefs.theme);
  }

  setSkins(skins: [string, string]) {
    this.opts.skins = skins;
  }

  /** Start a fresh match (rematch). */
  newMatch(match: MatchState) {
    this.epoch++;
    this.sim = null;
    this.drag = null;
    this.aiAim = null;
    this.aiPlan = null;
    this.replay.reset();
    this.queued = [];
    this.authority = null;
    this.match = match;
    this.lastShot = null;
    this.display = [...match.pens];
    this.placePens();
    this.nextTurn();
  }

  /** Online: a shot refereed by the server. */
  receiveShot(msg: ShotMessage) {
    if (msg.shooter === this.opts.mySeat) {
      if (msg.shotNo !== this.expectedShotNo) return;
      this.authority = msg;
      if (this.phase === 'settling') this.resolve(fromMessage(msg));
      return;
    }
    this.queued.push(msg);
    this.tryStartQueued();
  }

  /** Online: latest room state from the server. Used to recover from reconnects/desyncs. */
  offerSnapshot(match: MatchState) {
    if (match.seed !== this.match.seed) {
      this.newMatch(match);
      return;
    }
    const idle = this.phase === 'ready' || this.phase === 'waiting' || this.phase === 'over';
    if (idle && this.queued.length === 0 && match.shotNo > this.match.shotNo) {
      this.epoch++;
      this.match = match;
      this.display = [...match.pens];
      this.nextTurn();
    }
  }

  get state(): HudState {
    return {
      match: this.match,
      phase: this.phase,
      lastShot: this.lastShot,
      replayable: this.replay.has && !this.replay.playing && REPLAY_PHASES.includes(this.phase),
      replaying: this.replay.playing,
    };
  }

  /** Watch the last shot again. Only when nothing is moving; any real shot cancels it. */
  startReplay() {
    if (!REPLAY_PHASES.includes(this.phase) || this.drag) return;
    if (this.replay.start()) this.emit();
  }

  stopReplay() {
    if (!this.replay.playing) return;
    this.replay.stop();
    this.emit();
  }

  /** Freeze the turn clock while the pause menu is open (vs Computer only; online games cannot pause). */
  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** vs Computer: seconds left on the human's turn, or null when no turn is being timed. */
  timeLeft(): number | null {
    if (this.opts.mode !== 'ai') return null;
    if (this.phase !== 'ready' && this.phase !== 'aiming') return null;
    return Math.max(0, TURN.seconds - this.turnElapsed);
  }

  /** Online: the server skipped a turn (time ran out). Adopt the new state. */
  applySkip(next: MatchState) {
    if (next.seed !== this.match.seed || next.shotNo <= this.match.shotNo) return;
    if (this.phase === 'moving' || this.phase === 'settling' || this.phase === 'resolving') {
      this.pendingSkip = next; // applied as soon as the current shot has finished
      return;
    }
    this.drag = null;
    this.aiAim = null;
    this.match = next;
    this.display = [...next.pens];
    this.nextTurn();
  }

  /** vs Computer: the human ran out of time, so the turn passes to the Computer. */
  private forfeitTurn() {
    this.drag = null;
    this.match = skipTurn(this.match);
    this.opts.onNotice?.("Time's up! Your turn passes");
    sfx.neutral();
    this.nextTurn();
  }

  // ---- turn flow ----------------------------------------------------------

  private emit() {
    this.opts.onHud(this.state);
  }

  private later(ms: number, fn: () => void) {
    const epoch = this.epoch;
    window.setTimeout(() => {
      if (!this.destroyed && epoch === this.epoch) fn();
    }, ms);
  }

  /** Ends the intro hold (coin toss finished) and lets the first turn begin. */
  release() {
    if (!this.held) return;
    this.held = false;
    if (this.phase === 'intro') this.nextTurn();
  }

  private nextTurn() {
    this.turnElapsed = 0;
    if (this.pendingSkip && this.pendingSkip.shotNo > this.match.shotNo) {
      this.match = this.pendingSkip;
      this.display = [...this.match.pens];
    }
    this.pendingSkip = null;
    const m = this.match;
    if (m.winner !== null) {
      this.phase = 'over';
      this.emit();
      return;
    }
    if (this.held) {
      this.phase = 'intro';
      this.emit();
      return;
    }
    if (m.turn === this.opts.mySeat) {
      this.phase = 'ready';
      if (m.shotNo > 0) sfx.turn();
    } else if (this.opts.mode === 'ai') {
      this.phase = 'thinking';
      this.thinkAi();
    } else {
      this.phase = 'waiting';
    }
    this.emit();
    if (this.phase === 'waiting') this.tryStartQueued();
  }

  private thinkAi() {
    const epoch = this.epoch;
    const seat = this.match.turn;
    // A reply planned during the result pause has already been "thinking" since then.
    const pre = this.aiPlan && this.aiPlan.shotNo === this.match.shotNo && this.aiPlan.seed === this.match.seed ? this.aiPlan : null;
    this.aiPlan = null;
    const started = pre?.started ?? performance.now();
    const minThink = 400 + Math.random() * 400;
    void (pre?.promise ?? requestAiShot(this.match, seat, this.opts.difficulty, this.opts.aiProfile)).then((flick) => {
      if (epoch !== this.epoch || this.destroyed) return;
      const wait = Math.max(0, minThink - (performance.now() - started));
      this.later(wait, () => {
        const pose = this.match.pens[seat];
        const grab = { x: pose.x + Math.cos(pose.a) * flick.gx, y: pose.y + Math.sin(pose.a) * flick.gx };
        this.aiAim = {
          flick,
          grab,
          preview: previewShot(this.match.pens, seat, flick, GUIDE.short),
          t: 0,
          dur: 0.4 + flick.power * 0.3,
        };
        this.phase = 'ai-aiming';
        this.emit();
      });
    });
  }

  /** vs Computer: start planning the Computer's reply while the last shot's result is still on screen. */
  private prefetchAi(next: MatchState) {
    if (next.winner !== null || next.turn === this.opts.mySeat) return;
    this.aiPlan = {
      shotNo: next.shotNo,
      seed: next.seed,
      started: performance.now(),
      promise: requestAiShot(next, next.turn, this.opts.difficulty, this.opts.aiProfile),
    };
  }

  private tryStartQueued() {
    if (this.phase !== 'waiting') return;
    while (this.queued.length) {
      const msg = this.queued.shift()!;
      if (msg.shotNo < this.match.shotNo) continue; // already applied (e.g. via snapshot)
      if (msg.shotNo > this.match.shotNo) this.match = msg.before; // we missed something; trust the server
      this.authority = msg;
      this.expectedShotNo = msg.shotNo;
      this.startShot(msg.shooter, msg.flick, msg.before.pens, msg.before.seed, msg.shotNo, msg.before.round);
      return;
    }
  }

  private fire(flick: Flick) {
    const seat = this.opts.mySeat;
    this.expectedShotNo = this.match.shotNo;
    this.authority = null;
    if (this.opts.mode === 'online' && this.opts.sendShot) {
      const epoch = this.epoch;
      void this.opts.sendShot(flick, this.match.shotNo).then((ack) => {
        if (!ack.ok && epoch === this.epoch) this.abortShot();
      });
    }
    this.startShot(seat, flick, this.match.pens, this.match.seed, this.match.shotNo, this.match.round);
  }

  /** The server rejected our shot: put everything back and let the snapshot resync us. */
  private abortShot() {
    this.epoch++;
    this.sim = null;
    this.display = [...this.match.pens];
    this.nextTurn();
  }

  /**
   * `seed` and `shotNo` identify the shot for the high-power wobble, which the server
   * recomputes identically, so both players and the referee see the same result.
   */
  private startShot(shooter: Seat, flick: Flick, pens: readonly Pose[], seed: number, shotNo: number, round: number) {
    this.sim = new Sim(pens);
    this.sim.applyFlick(shooter, wobbleFlick(seed, shotNo, flick));
    this.replay.record({ pens, shooter, flick, seed, shotNo });
    this.simAcc = 0;
    this.shooter = shooter;
    this.flick = flick;
    this.shotWasOpening = isOpeningPosition(pens, seed, round);
    {
      const pose = pens[shooter];
      const cross = Math.cos(pose.a) * flick.dy - Math.sin(pose.a) * flick.dx;
      this.spinStrength = Math.abs((flick.gx / (PEN.length / 2)) * cross) * flick.power;
    }
    this.drag = null;
    this.aiAim = null;
    this.display = this.sim.poses();
    this.phase = 'moving';
    sfx.flick(flick.power);
    vibrate(this.opts.prefs.haptics, 8);
    this.emit();
  }

  private handleEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'hit') {
        sfx.hit(e.strength);
        this.renderer.hit(e.x, e.y, e.strength);
        if (e.strength > 1.5) vibrate(this.opts.prefs.haptics, Math.min(40, 8 + e.strength * 3));
      } else {
        sfx.fall();
        this.renderer.fall(e.pose, e.vx, e.vy, e.w, getSkin(this.opts.skins[e.pen]));
        vibrate(this.opts.prefs.haptics, [20, 40, 30]);
      }
    }
  }

  /** Sounds and effects for a replay (no vibration, no scoring). */
  private replayEffects(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === 'hit') {
        sfx.hit(e.strength);
        this.renderer.hit(e.x, e.y, e.strength);
      } else {
        sfx.fall();
        this.renderer.fall(e.pose, e.vx, e.vy, e.w, getSkin(this.opts.skins[e.pen]));
      }
    }
  }

  private onSettled() {
    const sim = this.sim!;
    if (this.opts.mode === 'ai') {
      const r = applyShotResult(this.match, this.shooter, this.flick!, {
        final: sim.poses(),
        out: [...sim.out],
        contact: sim.contact,
        steps: sim.steps,
      });
      this.resolve({ shooter: r.shooter, after: r.after, final: r.result.final, outcome: r.outcome, delta: r.delta, reset: r.reset });
      return;
    }
    if (this.authority && this.authority.shotNo === this.expectedShotNo) {
      this.resolve(fromMessage(this.authority));
    } else {
      this.phase = 'settling';
      this.emit();
    }
  }

  private resolve(res: Resolution) {
    this.sim = null;
    this.authority = null;

    // Reconcile our local animation with the authoritative result (usually identical).
    res.final.forEach((auth, i) => {
      const local = this.display[i];
      if (auth && local) {
        if (Math.hypot(auth.x - local.x, auth.y - local.y) > 0.01 || Math.abs(auth.a - local.a) > 0.02) {
          this.anims[i].tweenFrom = { ...local };
          this.anims[i].tweenT = 0;
        }
      } else if (!auth && local) {
        this.renderer.fall(local, 0, 0, 0, getSkin(this.opts.skins[i]));
        sfx.fall();
      }
    });
    this.display = [...res.final];

    const me = this.opts.mySeat;
    this.lastShot = {
      id: ++this.shotCounter,
      shooter: res.shooter,
      outcome: res.outcome,
      delta: res.delta,
      opening: this.shotWasOpening,
      spin: this.spinStrength,
    };
    // A knockout is good for whoever flicked; an own goal gives the point to the other player.
    const goodForMe = res.outcome === 'knockout' ? res.shooter === me : res.shooter !== me;
    if (res.outcome === 'both-off') sfx.neutral();
    else if (res.outcome !== 'none') {
      if (goodForMe) sfx.score();
      else sfx.ownGoal();
    }

    if (this.opts.mode === 'ai') this.prefetchAi(res.after);
    this.phase = 'resolving';
    this.emit();

    this.later(res.outcome === 'none' ? PACE.quietMs : PACE.eventMs, () => {
      this.match = res.after;
      if (res.reset) {
        this.display = [...this.match.pens];
        this.placePens();
      }
      if (this.match.winner !== null) {
        if (this.match.winner === me) sfx.win();
        else sfx.lose();
      }
      this.nextTurn();
    });
  }

  private placePens() {
    for (const a of this.anims) {
      a.lift = 1;
      a.alpha = 0;
      a.tweenFrom = null;
      a.tweenT = 1;
    }
    this.later(120, () => sfx.place());
  }

  // ---- frame loop ---------------------------------------------------------

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.phase === 'moving' && this.sim) {
      this.simAcc += dt;
      let steps = 0;
      while (this.simAcc >= PHYS.dt && steps < 30) {
        this.simAcc -= PHYS.dt;
        steps++;
        if (this.sim.settled()) break;
        this.handleEvents(this.sim.step());
      }
      this.display = this.sim.poses();
      if (this.sim.settled()) this.onSettled();
    }

    if (this.replay.playing) {
      if (!REPLAY_PHASES.includes(this.phase)) {
        this.replay.stop(); // the live game moved on (a real shot started)
        this.emit();
      } else {
        this.replayEffects(this.replay.advance(dt));
        if (!this.replay.playing) this.emit();
      }
    }

    if (this.opts.mode === 'ai' && !this.paused && !this.replay.playing && (this.phase === 'ready' || this.phase === 'aiming')) {
      this.turnElapsed += dt;
      if (this.turnElapsed >= TURN.seconds) this.forfeitTurn();
    }

    if (this.phase === 'ai-aiming' && this.aiAim) {
      this.aiAim.t += dt;
      if (this.aiAim.t >= this.aiAim.dur + 0.12) this.startShot(this.match.turn, this.aiAim.flick, this.match.pens, this.match.seed, this.match.shotNo, this.match.round);
    }

    for (const a of this.anims) {
      if (a.lift > 0) a.lift = Math.max(0, a.lift - dt / PLACE_TIME);
      if (a.alpha < 1) a.alpha = Math.min(1, a.alpha + dt / (PLACE_TIME * 0.5));
      if (a.tweenT < 1) a.tweenT = Math.min(1, a.tweenT + dt / TWEEN_TIME);
    }

    if (this.drag?.dirty) this.updatePreview();
    this.renderer.render(dt, this.sprites(), this.aimVisual());
  };

  private sprites(): PenSprite[] {
    const replayPoses = this.replay.poses();
    if (replayPoses) {
      return replayPoses.flatMap((pose, i) => (pose ? [{ pose, skin: getSkin(this.opts.skins[i]), lift: 0, alpha: 1, glow: null }] : []));
    }
    const out: PenSprite[] = [];
    const turn = this.match.turn;
    this.display.forEach((pose, i) => {
      if (!pose) return;
      const a = this.anims[i];
      let p = pose;
      if (a.tweenFrom && a.tweenT < 1) {
        const k = easeOut(a.tweenT);
        p = {
          x: a.tweenFrom.x + (pose.x - a.tweenFrom.x) * k,
          y: a.tweenFrom.y + (pose.y - a.tweenFrom.y) * k,
          a: a.tweenFrom.a + (pose.a - a.tweenFrom.a) * k,
        };
      }
      let glow: PenSprite['glow'] = null;
      if (i === turn) {
        if (this.phase === 'ready') glow = 'mine';
        else if (this.phase === 'thinking' || this.phase === 'waiting') glow = 'theirs';
      }
      out.push({ pose: p, skin: getSkin(this.opts.skins[i]), lift: easeOut(a.lift), alpha: a.alpha, glow });
    });
    return out;
  }

  private aimVisual(): AimVisual | null {
    if (this.replay.playing) return null;
    if (this.phase === 'aiming' && this.drag) {
      const d = this.drag;
      const { pull, power } = pullFor(d.grab, d.pointer);
      return { grab: d.grab, pull, power, spread: wobbleSigma(power), preview: power >= INPUT.minPower ? d.preview : null, label: true };
    }
    if (this.phase === 'ai-aiming' && this.aiAim) {
      const a = this.aiAim;
      const k = easeInOut(Math.min(1, a.t / a.dur));
      const len = a.flick.power * INPUT.maxDrag * k;
      return {
        grab: a.grab,
        pull: { x: a.grab.x - a.flick.dx * len, y: a.grab.y - a.flick.dy * len },
        power: a.flick.power * k,
        spread: 0,
        preview: k > 0.5 ? a.preview : null,
        label: false,
      };
    }
    return null;
  }

  private currentFlick(d: Drag): Flick | null {
    const vx = d.pointer.x - d.grab.x;
    const vy = d.pointer.y - d.grab.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-4) return null;
    return { gx: d.gx, dx: -vx / len, dy: -vy / len, power: Math.min(1, len / INPUT.maxDrag) };
  }

  private updatePreview() {
    const d = this.drag!;
    d.dirty = false;
    const flick = this.currentFlick(d);
    d.preview =
      flick && flick.power >= INPUT.minPower
        ? previewShot(this.match.pens, this.opts.mySeat, flick, GUIDE[this.opts.prefs.guide])
        : null;
  }

  // ---- input --------------------------------------------------------------

  private resize() {
    const parent = this.opts.canvas.parentElement;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    this.opts.canvas.style.width = `${w}px`;
    this.opts.canvas.style.height = `${h}px`;
    this.renderer.resize(w, h, this.opts.mySeat === 1, layoutInsets(w, h));
  }

  private toWorld(e: PointerEvent) {
    const r = this.opts.canvas.getBoundingClientRect();
    return this.renderer.view.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  private onDown = (e: PointerEvent) => {
    sfx.unlock();
    if (this.replay.playing) {
      this.stopReplay(); // a tap skips the replay
      return;
    }
    if (this.phase !== 'ready' || this.drag) return;
    const pose = this.match.pens[this.opts.mySeat];
    const w = this.toWorld(e);
    // Scale the grab tolerance so it stays finger-sized on small screens.
    const slop = Math.max(INPUT.grabSlop, 26 / this.renderer.view.scale);
    const info = grabInfo(pose, w.x, w.y);
    if (info.dist > slop) return;
    e.preventDefault();
    this.opts.canvas.setPointerCapture(e.pointerId);
    this.drag = { pointerId: e.pointerId, gx: info.gx, grab: info.point, pointer: w, preview: null, dirty: true };
    this.phase = 'aiming';
    vibrate(this.opts.prefs.haptics, 5);
    this.emit();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag.pointer = this.toWorld(e);
    this.drag.dirty = true;
  };

  private onUp = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag.pointer = this.toWorld(e);
    const flick = this.currentFlick(this.drag);
    this.drag = null;
    if (flick && flick.power >= INPUT.minPower) {
      this.fire(flick);
    } else {
      this.phase = 'ready';
      this.emit();
    }
  };

  private cancelDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.phase = 'ready';
    this.emit();
  }

  private onCancel = () => this.cancelDrag();

  private onContext = (e: Event) => {
    e.preventDefault();
    this.cancelDrag();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.cancelDrag();
  };
}

function fromMessage(msg: ShotMessage): Resolution {
  return {
    shooter: msg.shooter,
    after: msg.after,
    final: msg.final,
    outcome: msg.outcome,
    delta: msg.delta,
    reset: msg.reset,
  };
}

export function pullFor(grab: { x: number; y: number }, pointer: { x: number; y: number }) {
  const vx = pointer.x - grab.x;
  const vy = pointer.y - grab.y;
  const len = Math.hypot(vx, vy);
  const k = len > INPUT.maxDrag ? INPUT.maxDrag / len : 1;
  return { pull: { x: grab.x + vx * k, y: grab.y + vy * k }, power: Math.min(1, len / INPUT.maxDrag) };
}

/** Space reserved for the HUD so it never covers the desk. */
export function layoutInsets(w: number, h: number): Insets {
  const css = getComputedStyle(document.documentElement);
  const sat = parseFloat(css.getPropertyValue('--sat')) || 0;
  const sab = parseFloat(css.getPropertyValue('--sab')) || 0;
  const landscape = w > h * 1.08;
  if (landscape) return { top: 64 + sat, bottom: 8 + sab, left: 12, right: 12 };
  return { top: 86 + sat, bottom: 58 + sab, left: 6, right: 6 };
}

export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

