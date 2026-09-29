import { INPUT, PEN, TABLE, TARGET_SCORES } from './config';
import { mulberry32 } from './rng';
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
    { x: TABLE.w / 2 + j(0.8), y: TABLE.h * 0.75 + j(0.3), a: j(0.4) },
    { x: TABLE.w / 2 + j(0.8), y: TABLE.h * 0.25 + j(0.3), a: Math.PI + j(0.4) },
  ];
}

export function newMatch(target: number, seed: number, firstTurn: Seat = 0): MatchState {
  return {
    target: (TARGET_SCORES as readonly number[]).includes(target) ? target : 5,
    scores: [0, 0],
    turn: firstTurn,
    pens: startPoses(seed, 0),
    winner: null,
    shotNo: 0,
    seed,
    firstTurn,
  };
}

/**
 * Scoring rules (PRD 4.2):
 * - knock the opponent off and stay on: +1
 * - fall off yourself without taking them with you: -1
 * - both off: nothing
 */
export function scoreShot(shooter: Seat, out: readonly boolean[]): { outcome: Outcome; delta: number } {
  const selfOut = out[shooter];
  const oppOut = out[other(shooter)];
  if (selfOut && oppOut) return { outcome: 'both-off', delta: 0 };
  if (oppOut) return { outcome: 'knockout', delta: 1 };
  if (selfOut) return { outcome: 'own-goal', delta: -1 };
  return { outcome: 'none', delta: 0 };
}

export function applyShotResult(
  before: MatchState,
  shooter: Seat,
  flick: Flick,
  result: ShotResult,
): ResolvedShot {
  const { outcome, delta } = scoreShot(shooter, result.out);
  const scores: [number, number] = [...before.scores];
  scores[shooter] += delta;
  const winner = scores[shooter] >= before.target ? shooter : null;
  const reset = result.out.some(Boolean);
  const shotNo = before.shotNo + 1;
  const pens: [Pose, Pose] = reset
    ? startPoses(before.seed, shotNo)
    : [result.final[0] as Pose, result.final[1] as Pose];

  const after: MatchState = { ...before, scores, winner, pens, shotNo, turn: other(shooter) };
  return { shooter, flick, result, outcome, delta, reset, before, after };
}

/** Authoritative resolution: simulate the shot and apply the rules. Used by the server. */
export function resolveShot(before: MatchState, shooter: Seat, flick: Flick): ResolvedShot {
  const result = simulateShot(before.pens, shooter, flick);
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
