import { ROYALE, TABLE } from './config';
import { mulberry32 } from './rng';
import { wobbleFlick } from './rules';
import { simulateShot } from './sim';
import type { Flick, Pose, ShotResult } from './types';

/**
 * Battle Royale rules (2 to 4 players on one desk).
 *
 * - Players take turns clockwise (seat 0 -> 1 -> 2 -> 3 ...), skipping anyone already out.
 * - A pen that falls off is out for the rest of the round, whether it was knocked off or the
 *   owner flicked it off themselves. There are no negative points.
 * - The last pen standing scores +1. If the final pens fall in the same flick (or everyone falls
 *   at once) nobody scores.
 * - The next round starts with the next player clockwise after whoever opened the last one.
 * - First to `target` points wins (5 or 10).
 */
export interface RoyaleState {
  target: number;
  /** Per seat, always ROYALE.maxPlayers long. */
  scores: number[];
  /** Still on the desk this round. */
  alive: boolean[];
  /** Still in the match (false = empty seat, or the player left). */
  active: boolean[];
  pens: (Pose | null)[];
  turn: number;
  /** Who opened this round. */
  starter: number;
  roundNo: number;
  /** The shotNo at which the pens were last set out; seeds the layout. */
  round: number;
  /** Increments every flick or skipped turn. */
  shotNo: number;
  seed: number;
  firstStarter: number;
  winner: number | null;
}

export interface RoyaleResolved {
  shooter: number;
  flick: Flick;
  result: ShotResult;
  /** Seats whose pens fell off during this flick. */
  eliminated: number[];
  roundOver: boolean;
  /** Who scored the round. null with roundOver = nobody did. */
  roundWinner: number | null;
  /** The pens were set out again for a new round. */
  newRound: boolean;
  before: RoyaleState;
  after: RoyaleState;
}

/** Starting spots, in clockwise order, for 2, 3 or 4 players. Fractions of the table. */
const SLOTS: Record<number, [number, number][]> = {
  2: [
    [0.5, 0.75],
    [0.5, 0.25],
  ],
  3: [
    [0.28, 0.74],
    [0.5, 0.24],
    [0.72, 0.74],
  ],
  4: [
    [0.28, 0.74],
    [0.28, 0.26],
    [0.72, 0.26],
    [0.72, 0.74],
  ],
};

const count = (flags: readonly boolean[]) => flags.filter(Boolean).length;

/** The next seat clockwise after `from` whose flag is set (null if there is none). */
export function nextSeat(flags: readonly boolean[], from: number): number | null {
  const n = flags.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (flags[i]) return i;
  }
  return null;
}

/**
 * Where the pens are set out at the start of a round. Active players take the starting spots in
 * clockwise order. Derived from the match seed so every device computes the same layout.
 */
export function royaleLayout(seed: number, round: number, active: readonly boolean[]): (Pose | null)[] {
  const players = Math.max(2, Math.min(ROYALE.maxPlayers, count(active)));
  const slots = SLOTS[players];
  const rand = mulberry32((seed ^ Math.imul(round + 1, 0x9e3779b1) ^ 0x51ed270b) >>> 0);
  const j = (amt: number) => (rand() * 2 - 1) * amt;
  let rank = 0;
  return active.map((on) => {
    if (!on) return null;
    const [fx, fy] = slots[Math.min(rank++, slots.length - 1)];
    const x = TABLE.w * fx + j(0.3);
    const y = TABLE.h * fy + j(0.3);
    // Lie roughly across the line to the middle of the desk, so every pen is a fair target.
    const toCentre = Math.atan2(TABLE.h / 2 - y, TABLE.w / 2 - x);
    return { x, y, a: toCentre + Math.PI / 2 + j(1.0) };
  });
}

export function newRoyale(target: number, seed: number, starter: number, active: readonly boolean[]): RoyaleState {
  const flags = active.slice(0, ROYALE.maxPlayers);
  while (flags.length < ROYALE.maxPlayers) flags.push(false);
  return {
    target: ROYALE.targets.includes(target) ? target : ROYALE.defaultTarget,
    scores: flags.map(() => 0),
    alive: [...flags],
    active: [...flags],
    pens: royaleLayout(seed, 0, flags),
    turn: starter,
    starter,
    roundNo: 0,
    round: 0,
    shotNo: 0,
    seed,
    firstStarter: starter,
    winner: null,
  };
}

/** Pick who opens a match: a random active seat. */
export function randomStarter(active: readonly boolean[], rand: () => number): number {
  const seats = active.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  return seats[Math.floor(rand() * seats.length)] ?? 0;
}

interface Advance {
  state: RoyaleState;
  roundOver: boolean;
  roundWinner: number | null;
  newRound: boolean;
}

/**
 * Decide what happens next once `state.alive` / `state.pens` / `state.shotNo` are updated:
 * keep playing, or finish the round (score it) and start the next one, or finish the match.
 * `from` is the seat that just acted; the turn moves clockwise from there unless `keepTurn`.
 */
function advance(state: RoyaleState, from: number, keepTurn = false): Advance {
  const survivors = count(state.alive);
  if (survivors > 1) {
    const turn = keepTurn && state.alive[state.turn] ? state.turn : (nextSeat(state.alive, from) ?? state.turn);
    return { state: { ...state, turn }, roundOver: false, roundWinner: null, newRound: false };
  }

  // Round over: one pen left scores; nobody left means nobody scores.
  const roundWinner = survivors === 1 ? state.alive.indexOf(true) : null;
  const scores = [...state.scores];
  if (roundWinner !== null) scores[roundWinner] += 1;
  if (roundWinner !== null && scores[roundWinner] >= state.target) {
    return { state: { ...state, scores, winner: roundWinner }, roundOver: true, roundWinner, newRound: false };
  }
  if (count(state.active) < 2) {
    // Everyone else has left: the last player standing in the match wins.
    const last = state.active.indexOf(true);
    return { state: { ...state, scores, winner: last >= 0 ? last : null }, roundOver: true, roundWinner, newRound: false };
  }

  const starter = nextSeat(state.active, state.starter) ?? state.starter;
  const round = state.shotNo;
  const next: RoyaleState = {
    ...state,
    scores,
    alive: [...state.active],
    pens: royaleLayout(state.seed, round, state.active),
    turn: starter,
    starter,
    roundNo: state.roundNo + 1,
    round,
  };
  return { state: next, roundOver: true, roundWinner, newRound: true };
}

/** Apply a finished simulation to the match. Pure, so every device and the server agree. */
export function applyRoyaleResult(before: RoyaleState, shooter: number, flick: Flick, result: ShotResult): RoyaleResolved {
  const eliminated = before.alive.map((a, i) => (a && result.out[i] ? i : -1)).filter((i) => i >= 0);
  const alive = before.alive.map((a, i) => a && !result.out[i]);
  const pens = before.pens.map((_, i) => (alive[i] ? (result.final[i] ?? null) : null));
  const adv = advance({ ...before, alive, pens, shotNo: before.shotNo + 1 }, shooter);
  return {
    shooter,
    flick,
    result,
    eliminated,
    roundOver: adv.roundOver,
    roundWinner: adv.roundWinner,
    newRound: adv.newRound,
    before,
    after: adv.state,
  };
}

/** Authoritative resolution: simulate the flick and apply the rules. Used by the server. */
export function resolveRoyaleShot(before: RoyaleState, shooter: number, flick: Flick): RoyaleResolved {
  const result = simulateShot(before.pens, shooter, wobbleFlick(before.seed, before.shotNo, flick));
  return applyRoyaleResult(before, shooter, flick, result);
}

/** The player ran out of time: the turn passes to the next pen still on the desk. */
export function royaleSkip(state: RoyaleState): RoyaleState {
  const turn = nextSeat(state.alive, state.turn) ?? state.turn;
  return { ...state, turn, shotNo: state.shotNo + 1 };
}

/**
 * A player left the match. Their pen is removed; if that leaves one pen standing the round ends,
 * and if only one player is left in the match they win.
 */
export function royaleRemovePlayer(state: RoyaleState, seat: number): Advance {
  if (!state.active[seat]) return { state, roundOver: false, roundWinner: null, newRound: false };
  const active = state.active.map((a, i) => a && i !== seat);
  const alive = state.alive.map((a, i) => a && i !== seat);
  const pens = state.pens.map((p, i) => (i === seat ? null : p));
  const wasTurn = state.turn === seat;
  return advance({ ...state, active, alive, pens, shotNo: state.shotNo + 1 }, seat, !wasTurn);
}
