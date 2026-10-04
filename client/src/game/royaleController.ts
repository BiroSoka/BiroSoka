import {
  getSkin,
  GUIDE,
  INPUT,
  PEN,
  PACE,
  PHYS,
  previewShot,
  Sim,
  wobbleFlick,
  wobbleSigma,
  type Ack,
  type Flick,
  type Pose,
  type RoyaleShotMessage,
  type RoyaleState,
  type ShotPreview,
  type SimEvent,
} from '@biro/shared';
import { sfx, vibrate } from '../lib/audio';
import { easeOut, layoutInsets, pullFor, type ControllerPrefs } from './controller';
import { grabInfo, Renderer, type AimVisual, type PenSprite } from './renderer';
import { ReplayDriver } from './replayDriver';

/**
 * Battle Royale table controller (2 to 4 players). Turn flow:
 *   ready (my turn) -> aiming -> moving -> [settling: waiting for the server's verdict] -> resolving -> next turn
 *   waiting (someone else's turn, or I'm out for the round) -> moving -> ...
 * The server referees every flick; this controller only plays it back, exactly like the 1 v 1 table.
 */
export type RoyalePhase = 'intro' | 'ready' | 'aiming' | 'waiting' | 'moving' | 'settling' | 'resolving' | 'over';

/** What just happened, for toasts and commentary. */
export interface RoyaleEvent {
  id: number;
  shooter: number;
  eliminated: number[];
  roundOver: boolean;
  roundWinner: number | null;
  /** How much spin the shooter put on it (0..1). */
  spin: number;
}

export interface RoyaleHud {
  state: RoyaleState;
  phase: RoyalePhase;
  event: RoyaleEvent | null;
  /** The last shot can be watched again right now. */
  replayable: boolean;
  replaying: boolean;
}

/** Phases in which watching a replay cannot get in the way of the live game. */
const REPLAY_PHASES: RoyalePhase[] = ['ready', 'waiting', 'over'];

export interface RoyaleOptions {
  canvas: HTMLCanvasElement;
  mySeat: number;
  /** One per seat (length 4); made distinct before being passed in. */
  skins: string[];
  names: string[];
  state: RoyaleState;
  /** Hold the first turn (intro overlay on screen) until release() is called. */
  startHeld?: boolean;
  prefs: ControllerPrefs;
  onHud: (hud: RoyaleHud) => void;
  sendShot: (flick: Flick, shotNo: number) => Promise<Ack>;
}

interface Drag {
  pointerId: number;
  gx: number;
  grab: { x: number; y: number };
  pointer: { x: number; y: number };
  preview: ShotPreview | null;
  dirty: boolean;
}

interface PenAnim {
  lift: number;
  alpha: number;
  tweenFrom: Pose | null;
  tweenT: number;
}

const TWEEN_TIME = 0.25;
const PLACE_TIME = 0.45;
const SEATS = 4;

export class RoyaleController {
  readonly renderer: Renderer;
  private opts: RoyaleOptions;
  private state: RoyaleState;
  private phase: RoyalePhase = 'ready';
  private event: RoyaleEvent | null = null;
  private eventCounter = 0;

  private sim: Sim | null = null;
  private simAcc = 0;
  private spinStrength = 0;
  private expectedShotNo = -1;
  private authority: RoyaleShotMessage | null = null;
  private queued: RoyaleShotMessage[] = [];
  /** A state the server pushed (skipped turn, player left) while a shot was still playing out. */
  private pendingState: RoyaleState | null = null;

  private display: (Pose | null)[];
  private anims: PenAnim[] = Array.from({ length: SEATS }, () => ({ lift: 0, alpha: 1, tweenFrom: null, tweenT: 1 }));
  private drag: Drag | null = null;

  private epoch = 0;
  private raf = 0;
  private lastTime = 0;
  private resizeObs: ResizeObserver;
  private destroyed = false;
  private held = false;
  private replay = new ReplayDriver();

  constructor(opts: RoyaleOptions) {
    this.opts = opts;
    this.held = !!opts.startHeld;
    this.state = opts.state;
    this.display = [...opts.state.pens];
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

  setLooks(skins: string[], names: string[]) {
    this.opts.skins = skins;
    this.opts.names = names;
  }

  get hud(): RoyaleHud {
    return {
      state: this.state,
      phase: this.phase,
      event: this.event,
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

  /** Ends the intro hold and lets the first turn begin. */
  release() {
    if (!this.held) return;
    this.held = false;
    if (this.phase === 'intro') this.nextTurn();
  }

  /** The host started another match. */
  newMatch(state: RoyaleState) {
    this.epoch++;
    this.sim = null;
    this.drag = null;
    this.queued = [];
    this.authority = null;
    this.pendingState = null;
    this.replay.reset();
    this.state = state;
    this.event = null;
    this.display = [...state.pens];
    this.placePens();
    this.nextTurn();
  }

  /** A flick refereed by the server (everyone, including the shooter, gets it). */
  receiveShot(msg: RoyaleShotMessage) {
    if (msg.shooter === this.opts.mySeat) {
      if (msg.shotNo !== this.expectedShotNo) return;
      this.authority = msg;
      if (this.phase === 'settling') this.resolve(msg);
      return;
    }
    this.queued.push(msg);
    this.tryStartQueued();
  }

  /** The server replaced the state: a turn was skipped, or a player left. */
  applyServerState(next: RoyaleState) {
    if (next.seed !== this.state.seed || next.shotNo <= this.state.shotNo) return;
    if (this.phase === 'moving' || this.phase === 'settling' || this.phase === 'resolving') {
      this.pendingState = next; // applied as soon as the current flick has finished
      return;
    }
    this.adopt(next);
  }

  /** Latest room state from the server; recovers from reconnects and missed messages. */
  offerSnapshot(next: RoyaleState) {
    if (next.seed !== this.state.seed) {
      this.newMatch(next);
      return;
    }
    const idle = this.phase === 'ready' || this.phase === 'waiting' || this.phase === 'over';
    if (idle && this.queued.length === 0 && next.shotNo > this.state.shotNo) this.adopt(next);
  }

  private adopt(next: RoyaleState) {
    const reset = next.round !== this.state.round;
    this.epoch++;
    this.drag = null;
    this.state = next;
    this.display = [...next.pens];
    if (reset) this.placePens();
    this.nextTurn();
  }

  // ---- turn flow ----------------------------------------------------------

  private emit() {
    this.opts.onHud(this.hud);
  }

  private later(ms: number, fn: () => void) {
    const epoch = this.epoch;
    window.setTimeout(() => {
      if (!this.destroyed && epoch === this.epoch) fn();
    }, ms);
  }

  private nextTurn() {
    if (this.pendingState && this.pendingState.shotNo > this.state.shotNo) {
      const reset = this.pendingState.round !== this.state.round;
      this.state = this.pendingState;
      this.display = [...this.state.pens];
      if (reset) this.placePens();
    }
    this.pendingState = null;
    const s = this.state;
    if (s.winner !== null) {
      this.phase = 'over';
      this.emit();
      return;
    }
    if (this.held) {
      this.phase = 'intro';
      this.emit();
      return;
    }
    if (s.turn === this.opts.mySeat && s.alive[this.opts.mySeat]) {
      this.phase = 'ready';
      if (s.shotNo > 0) sfx.turn();
    } else {
      this.phase = 'waiting';
    }
    this.emit();
    if (this.phase === 'waiting') this.tryStartQueued();
  }

  private tryStartQueued() {
    if (this.phase !== 'waiting') return;
    while (this.queued.length) {
      const msg = this.queued.shift()!;
      if (msg.shotNo < this.state.shotNo) continue; // already applied (e.g. via a snapshot)
      if (msg.shotNo > this.state.shotNo) this.state = msg.before; // we missed something; trust the server
      this.authority = msg;
      this.expectedShotNo = msg.shotNo;
      this.startShot(msg.shooter, msg.flick, msg.before);
      return;
    }
  }

  private fire(flick: Flick) {
    this.expectedShotNo = this.state.shotNo;
    this.authority = null;
    const epoch = this.epoch;
    void this.opts.sendShot(flick, this.state.shotNo).then((ack) => {
      if (!ack.ok && epoch === this.epoch) this.abortShot();
    });
    this.startShot(this.opts.mySeat, flick, this.state);
  }

  /** The server rejected our flick: put everything back and let the snapshot resync us. */
  private abortShot() {
    this.epoch++;
    this.sim = null;
    this.display = [...this.state.pens];
    this.nextTurn();
  }

  /** `from` is the state the flick was taken from; its seed and shotNo drive the high-power wobble, like on the server. */
  private startShot(shooter: number, flick: Flick, from: RoyaleState) {
    this.sim = new Sim(from.pens);
    this.sim.applyFlick(shooter, wobbleFlick(from.seed, from.shotNo, flick));
    this.replay.record({ pens: from.pens, shooter, flick, seed: from.seed, shotNo: from.shotNo });
    this.simAcc = 0;
    const pose = from.pens[shooter];
    if (pose) {
      const cross = Math.cos(pose.a) * flick.dy - Math.sin(pose.a) * flick.dx;
      this.spinStrength = Math.abs((flick.gx / (PEN.length / 2)) * cross) * flick.power;
    }
    this.drag = null;
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
    if (this.authority && this.authority.shotNo === this.expectedShotNo) {
      this.resolve(this.authority);
    } else {
      this.phase = 'settling';
      this.emit();
    }
  }

  private resolve(msg: RoyaleShotMessage) {
    this.sim = null;
    this.authority = null;

    // Reconcile our local animation with the server's result (normally identical).
    msg.final.forEach((auth, i) => {
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
    this.display = msg.final.map((p, i) => (msg.before.alive[i] ? p : null));

    const me = this.opts.mySeat;
    this.event = {
      id: ++this.eventCounter,
      shooter: msg.shooter,
      eliminated: msg.eliminated,
      roundOver: msg.roundOver,
      roundWinner: msg.roundWinner,
      spin: this.spinStrength,
    };
    if (msg.roundOver) {
      if (msg.roundWinner === me) sfx.score();
      else if (msg.roundWinner === null) sfx.neutral();
      else sfx.ownGoal();
    } else if (msg.eliminated.includes(me)) sfx.ownGoal();

    this.phase = 'resolving';
    this.emit();

    const interesting = msg.eliminated.length > 0 || msg.roundOver;
    this.later(interesting ? PACE.eventMs : PACE.quietMs, () => {
      const reset = msg.after.round !== this.state.round;
      this.state = msg.after;
      if (reset) {
        this.display = [...this.state.pens];
        this.placePens();
      }
      if (this.state.winner !== null) {
        if (this.state.winner === me) sfx.win();
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
      return replayPoses.flatMap((pose, i) => {
        if (!pose) return [];
        const name = this.opts.names[i] ?? '';
        return [{ pose, skin: getSkin(this.opts.skins[i]), lift: 0, alpha: 1, glow: null, label: i === this.opts.mySeat ? 'YOU' : name.length > 9 ? `${name.slice(0, 8)}…` : name }];
      });
    }
    const out: PenSprite[] = [];
    const turn = this.state.turn;
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
      if (i === turn && this.state.alive[i]) {
        if (this.phase === 'ready') glow = 'mine';
        else if (this.phase === 'waiting') glow = 'theirs';
      }
      const name = this.opts.names[i] ?? '';
      out.push({
        pose: p,
        skin: getSkin(this.opts.skins[i]),
        lift: easeOut(a.lift),
        alpha: a.alpha,
        glow,
        label: i === this.opts.mySeat ? 'YOU' : name.length > 9 ? `${name.slice(0, 8)}…` : name,
      });
    });
    return out;
  }

  private aimVisual(): AimVisual | null {
    if (this.replay.playing) return null;
    if (this.phase !== 'aiming' || !this.drag) return null;
    const d = this.drag;
    const { pull, power } = pullFor(d.grab, d.pointer);
    return { grab: d.grab, pull, power, spread: wobbleSigma(power), preview: power >= INPUT.minPower ? d.preview : null, label: true };
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
        ? previewShot(this.state.pens, this.opts.mySeat, flick, GUIDE[this.opts.prefs.guide])
        : null;
  }

  // ---- input --------------------------------------------------------------

  private resize() {
    const parent = this.opts.canvas.parentElement;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    this.opts.canvas.style.width = `${w}px`;
    this.opts.canvas.style.height = `${h}px`;
    // Everyone sees the desk the same way up; pens are labelled so you can tell whose is whose.
    this.renderer.resize(w, h, false, layoutInsets(w, h));
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
    const pose = this.state.pens[this.opts.mySeat];
    if (!pose) return;
    const w = this.toWorld(e);
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

