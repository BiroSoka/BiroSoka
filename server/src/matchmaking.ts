export interface Waiting {
  socketId: string;
  name: string;
  skin: string;
  since: number;
}

/**
 * The Quick match waiting list: first come, first served. Whoever has waited longest is paired with the
 * next player to ask. A player is never paired with themselves, and players who have gone away are skipped.
 */
export class MatchQueue {
  private waiting: Waiting[] = [];

  get size() {
    return this.waiting.length;
  }

  has(socketId: string) {
    return this.waiting.some((w) => w.socketId === socketId);
  }

  /** Pair with the longest-waiting player (returned), or join the queue (returns null). */
  join(entry: Waiting, isAlive: (socketId: string) => boolean): Waiting | null {
    this.cancel(entry.socketId);
    this.waiting = this.waiting.filter((w) => isAlive(w.socketId));
    const mate = this.waiting.shift();
    if (mate) return mate;
    this.waiting.push(entry);
    return null;
  }

  cancel(socketId: string): boolean {
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((w) => w.socketId !== socketId);
    return this.waiting.length !== before;
  }

  /** Forget players who left or have waited far too long. */
  sweep(maxAgeMs: number, isAlive: (socketId: string) => boolean, now = Date.now()) {
    this.waiting = this.waiting.filter((w) => now - w.since <= maxAgeMs && isAlive(w.socketId));
  }
}
