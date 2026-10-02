export type Seat = 0 | 1;

/** A pen resting on the table: centre position and rotation (radians). */
export interface Pose {
  x: number;
  y: number;
  a: number;
}

/**
 * A flick, as sent over the network.
 * - gx: where along the pen it was grabbed, in pen-local units (-length/2 = tip, +length/2 = cap end)
 * - dx, dy: launch direction (unit vector, world space)
 * - power: 0..1
 */
export interface Flick {
  gx: number;
  dx: number;
  dy: number;
  power: number;
}

export type Outcome = 'knockout' | 'own-goal' | 'both-off' | 'none';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface MatchState {
  target: number;
  scores: [number, number];
  turn: Seat;
  pens: [Pose, Pose];
  winner: Seat | null;
  /** Increments every shot or skipped turn; used to reject stale/duplicate shots and to seed the shot wobble. */
  shotNo: number;
  /** The shotNo at which the pens were last put in the starting layout (0 at the start of a match). */
  round: number;
  seed: number;
  firstTurn: Seat;
}

export interface ShotResult {
  /** Pose of each pen when everything came to rest (null = fell off). */
  final: (Pose | null)[];
  out: boolean[];
  contact: boolean;
  steps: number;
}

export interface ResolvedShot {
  shooter: Seat;
  flick: Flick;
  result: ShotResult;
  outcome: Outcome;
  delta: number;
  /** Pens were placed back at the start after someone fell off. */
  reset: boolean;
  before: MatchState;
  after: MatchState;
}
