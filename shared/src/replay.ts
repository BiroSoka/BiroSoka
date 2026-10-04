import { PHYS } from './config';
import { wobbleFlick } from './rules';
import { Sim, type SimEvent } from './sim';
import type { Flick, Pose } from './types';

/**
 * Everything needed to play a shot again: where the pens were, who flicked, the flick, and the
 * match seed and shot number (which decide the high-power wobble). The physics is deterministic,
 * so replaying this always shows exactly what happened, with nothing extra to record or send.
 */
export interface ReplayData {
  /** Pen poses before the flick (null = no pen in that seat). */
  pens: readonly (Pose | null)[];
  shooter: number;
  /** The flick as the player aimed it (the wobble is added when it is played). */
  flick: Flick;
  seed: number;
  shotNo: number;
}

/** Plays a recorded shot back in a separate simulation, so it never touches the live game. */
export class ReplayPlayer {
  private sim: Sim;
  private acc = 0;
  done = false;

  constructor(readonly data: ReplayData) {
    this.sim = new Sim(data.pens);
    this.sim.applyFlick(data.shooter, wobbleFlick(data.seed, data.shotNo, data.flick));
  }

  /** Move the replay on by `dt` seconds. Returns the hits and falls that happened in that time. */
  advance(dt: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.done) return events;
    this.acc += Math.min(dt, 0.05);
    let steps = 0;
    while (this.acc >= PHYS.dt && steps < 30) {
      this.acc -= PHYS.dt;
      steps++;
      if (this.sim.settled()) {
        this.done = true;
        break;
      }
      events.push(...this.sim.step());
    }
    if (this.sim.settled()) this.done = true;
    return events;
  }

  /** Current pose of every pen (null = fell off). */
  poses(): (Pose | null)[] {
    return this.sim.poses();
  }
}
