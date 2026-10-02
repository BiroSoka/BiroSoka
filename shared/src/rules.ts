import { ACCURACY, INPUT, PEN, START, TABLE, TARGET_SCORES } from './config';
import { gaussian, mulberry32 } from './rng';
import { simulateShot } from './sim';
import type { Flick, MatchState, Outcome, Pose, ResolvedShot, Seat, ShotResult } from './types';

export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/**
 * Where the pens are placed at the start and after every knock-off.
 * Seat 0 is the near side (bottom), seat 1 the far side (top).
 * Derived from the match seed so every client computes the same positions.
 */
export function startPoses(seed: number, round: number): [Pose, Pose] {
  const rand = mulberry32((seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0);
  const j = (amt: number) => (rand() * 2 - 1) * amt;
  return [
    { x: TABLE.w / 2 + j(0.8), y: TABLE.h * 0.75 + j(0.3), a: j(START.angleJitter) },
    { x: TABLE.w / 2 + j(0.8), y: TABLE.h * 0.25 + j(0.3), a: Math.PI + j(START.angleJitter) },
  ];
}

/**
 * True while the pens are still in the starting layout, i.e. the next flick is the opening
 * flick of a round. Knocking the opponent off with it is called an "ace".
 */
export function isOpeningPosition(pens: readonly Pose[], seed: number, round: number): boolean {
  const start = startPoses(seed, round);
  return pens.every((p, i) => Math.abs(p.x - start[i].x) < 1e-6 && Math.abs(p.y - start[i].y) < 1e-6 && Math.abs(p.a - start[i].a) < 1e-6);
}

export function newMatch(target: number, seed: number, firstTurn: Seat = 0): MatchState {
  return {
    target: (TARGET_SCORES as readonly number[]).includes(target) ? target : 5,
    scores: [0, 0],
    turn: firstTurn,
    pens: startPoses(seed, 0),
    winner: null,
    shotNo: 0,
    round: 0,
    seed,
    firstTurn,
  };
}

/** The player ran out of time: their turn passes to the opponent and nothing else changes. */
export function skipTurn(match: MatchState): MatchState {
  return { ...match, turn: other(match.turn), shotNo: match.shotNo + 1 };
}

/**
 * Scoring rules:
 * - knock the opponent off and stay on: +1 to you
 * - fall off yourself without taking them with you: +1 to your opponent (you are simply knocked out;
 *   there are no minus points, which keeps games short)
 * - both off: nothing
 * `delta` is the shooter's change and `oppDelta` the opponent's.
 */
export function scoreShot(shooter: Seat, out: readonly boolean[]): { outcome: Outcome; delta: number; oppDelta: number } {
  const selfOut = out[shooter];
  const oppOut = out[other(shooter)];
  if (selfOut && oppOut) return { outcome: 'both-off', delta: 0, oppDelta: 0 };
  if (oppOut) return { outcome: 'knockout', delta: 1, oppDelta: 0 };
  if (selfOut) return { outcome: 'own-goal', delta: 0, oppDelta: 1 };
  return { outcome: 'none', delta: 0, oppDelta: 0 };
}

export function applyShotResult(
  before: MatchState,
  shooter: Seat,
  flick: Flick,
  result: ShotResult,
): ResolvedShot {
  const { outcome, delta, oppDelta } = scoreShot(shooter, result.out);
  const opp = other(shooter);
  const scores: [number, number] = [...before.scores];
  scores[shooter] += delta;
  scores[opp] += oppDelta;
  const winner = scores[shooter] >= before.target ? shooter : scores[opp] >= before.target ? opp : null;
  const reset = result.out.some(Boolean);
  const shotNo = before.shotNo + 1;
  const pens: [Pose, Pose] = reset
    ? startPoses(before.seed, shotNo)
    : [result.final[0] as Pose, result.final[1] as Pose];

  const after: MatchState = { ...before, scores, winner, pens, shotNo, round: reset ? shotNo : before.round, turn: other(shooter) };
  return { shooter, flick, result, outcome, delta, reset, before, after };
}

/** Authoritative resolution: simulate the shot and apply the rules. Used by the server. */
export function resolveShot(before: MatchState, shooter: Seat, flick: Flick): ResolvedShot {
  const result = simulateShot(before.pens, shooter, wobbleFlick(before.seed, before.shotNo, flick));
  return applyShotResult(before, shooter, flick, result);
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Sanitise an untrusted flick (from the network). Returns null if it is garbage. */
export function sanitizeFlick(f: unknown): Flick | null {
  if (!f || typeof f !== 'object') return null;
  const { gx, dx, dy, power } = f as Record<string, unknown>;
  if (!finite(gx) || !finite(dx) || !finite(dy) || !finite(power)) return null;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const limit = PEN.length / 2 - INPUT.grabInset;
  return {
    gx: Math.max(-limit, Math.min(limit, gx)),
    dx: dx / len,
    dy: dy / len,
    power: Math.max(0, Math.min(1, power)),
  };
}

/** 1 standard deviation of launch-angle error (radians) for a flick at this power. */
export function wobbleSigma(power: number): number {
  if (power <= ACCURACY.startPower) return 0;
  const k = Math.min(1, (power - ACCURACY.startPower) / (1 - ACCURACY.startPower));
  return ACCURACY.sigma * k * k;
}

/**
 * The flick that is really launched: the aimed one plus the high-power wobble.
 * Pure function of (matchSeed, shotNo, flick), so every device and the server agree exactly,
 * but nobody can know the wobble before the shot is taken.
 */
export function wobbleFlick(matchSeed: number, shotNo: number, flick: Flick): Flick {
  const sigma = wobbleSigma(flick.power);
  if (sigma === 0) return flick;
  const rand = mulberry32((matchSeed ^ Math.imul(shotNo + 7, 0x85ebca6b)) >>> 0);
  const limit = ACCURACY.maxDeviations * sigma;
  const err = Math.max(-limit, Math.min(limit, gaussian(rand) * sigma));
  const c = Math.cos(err);
  const s = Math.sin(err);
  return { ...flick, dx: flick.dx * c - flick.dy * s, dy: flick.dx * s + flick.dy * c };
}
