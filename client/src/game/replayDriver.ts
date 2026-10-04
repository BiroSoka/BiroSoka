import { ReplayPlayer, type Pose, type ReplayData, type SimEvent } from '@biro/shared';

/**
 * Remembers the last shot and plays it back on request. The replay runs in its own simulation, so it can
 * never change the real game; the table just draws its poses instead of the live ones while it plays.
 */
export class ReplayDriver {
  private last: ReplayData | null = null;
  private player: ReplayPlayer | null = null;
  /** Seconds left to linger on the final frame before the replay ends. */
  private linger = 0;

  /** Remember a shot that is about to be played for real. */
  record(data: ReplayData) {
    this.player = null; // a real shot always wins over a replay
    this.last = { ...data, pens: data.pens.map((p) => (p ? { ...p } : null)) };
  }

  /** Forget everything (a new match started). */
  reset() {
    this.last = null;
    this.player = null;
  }

  get has(): boolean {
    return this.last !== null;
  }

  get playing(): boolean {
    return this.player !== null;
  }

  start(): boolean {
    if (!this.last || this.player) return false;
    this.player = new ReplayPlayer(this.last);
    this.linger = 0.8;
    return true;
  }

  stop() {
    this.player = null;
  }

  /** Move on by `dt` seconds. Returns the hits and falls to play sounds and effects for. */
  advance(dt: number): SimEvent[] {
    if (!this.player) return [];
    const events = this.player.advance(dt);
    if (this.player.done) {
      this.linger -= dt;
      if (this.linger <= 0) this.player = null;
    }
    return events;
  }

  poses(): (Pose | null)[] | null {
    return this.player ? this.player.poses() : null;
  }
}
