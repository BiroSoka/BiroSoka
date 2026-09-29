import { PEN, PHYS } from './config';
import { gaussian, mulberry32 } from './rng';
import { other, scoreShot } from './rules';
import { clamp, edgeDistance, simulateShot } from './sim';
import type { Difficulty, Flick, MatchState, Pose, Seat, ShotResult } from './types';

export interface DifficultyProfile {
  /** How many candidate shots are simulated. */
  samples: number;
  /** Execution error applied to the chosen shot. */
  angleNoise: number;
  powerNoise: number;
  /** Chance to settle for a random "decent" shot instead of the best one. */
  sloppiness: number;
  /** Best candidates that get fine-tuned with small aim/power tweaks. */
  refineTop: number;
  refineTweaks: number;
  /** Best candidates that are checked against the opponent's best reply. */
  lookaheadTop: number;
  lookaheadSamples: number;
  /** How much a dangerous reply counts against a candidate (1 = as much as a real loss). */
  caution: number;
  /** Hard stop for planning time, so slow phones don't stall the game. */
  budgetMs: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: { samples: 24, angleNoise: 0.11, powerNoise: 0.16, sloppiness: 0.45, refineTop: 0, refineTweaks: 0, lookaheadTop: 0, lookaheadSamples: 0, caution: 0, budgetMs: 1500 },
  medium: { samples: 90, angleNoise: 0.045, powerNoise: 0.07, sloppiness: 0.12, refineTop: 0, refineTweaks: 0, lookaheadTop: 0, lookaheadSamples: 0, caution: 0, budgetMs: 2000 },
  // Desk Champ: searches wider, polishes its best shots, thinks about your reply, barely misses.
  hard: { samples: 320, angleNoise: 0.006, powerNoise: 0.012, sloppiness: 0, refineTop: 8, refineTweaks: 12, lookaheadTop: 8, lookaheadSamples: 28, caution: 0.85, budgetMs: 3000 },
};

/** The previous Desk Champ settings, kept so benchmarks can measure improvements. */
export const LEGACY_HARD: DifficultyProfile = {
  samples: 240, angleNoise: 0.012, powerNoise: 0.025, sloppiness: 0,
  refineTop: 0, refineTweaks: 0, lookaheadTop: 0, lookaheadSamples: 0, caution: 0, budgetMs: 10000,
};

function axisOf(p: Pose) {
  return { x: Math.cos(p.a), y: Math.sin(p.a) };
}

function rotate(x: number, y: number, t: number) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Power needed to slide roughly `dist` units (ignores the small linear drag). */
function powerForDistance(dist: number) {
  return Math.sqrt(2 * PHYS.slideDecel * Math.max(dist, 0)) / PHYS.maxSpeed;
}

/** How good a finished shot is for `seat`. Higher is better. */
function evaluate(result: ShotResult, seat: Seat): number {
  const { delta } = scoreShot(seat, result.out);
  let value = delta * 100;
  if (result.out[seat] && result.out[other(seat)]) value -= 5;

  const me = result.final[seat];
  const opp = result.final[other(seat)];
  if (me && opp) {
    // Push the opponent towards an edge, keep yourself away from one.
    value += 8 * (1 - clamp(edgeDistance(opp.x, opp.y) / 2, 0, 1));
    value += 6 * clamp(edgeDistance(me.x, me.y) / 1.6, 0, 1);
    if (result.contact) value += 2;
  }
  return value;
}

/** Random candidate flick for `seat`: mostly aimed at the other pen, some exploratory. */
function sampleFlick(pens: readonly Pose[], seat: Seat, rand: () => number): Flick {
  const me = pens[seat];
  const opp = pens[other(seat)];
  const meAxis = axisOf(me);
  const oppAxis = axisOf(opp);
  const halfLen = PEN.length / 2;

  const gx = (rand() * 2 - 1) * halfLen * 0.55;
  const grab = { x: me.x + meAxis.x * gx, y: me.y + meAxis.y * gx };

  if (rand() < 0.82) {
    // Aimed shot: go for a point on the opponent pen and follow through.
    const t = (rand() * 2 - 1) * halfLen * 0.8;
    const aim = { x: opp.x + oppAxis.x * t, y: opp.y + oppAxis.y * t };
    const dx = aim.x - grab.x;
    const dy = aim.y - grab.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dir = rotate(dx / dist, dy / dist, gaussian(rand) * 0.035);
    const follow = 0.8 + rand() * 4.5;
    return { gx, dx: dir.x, dy: dir.y, power: clamp(powerForDistance(dist + follow), 0.12, 1) };
  }
  // Exploratory shot, including safe repositioning.
  const t = rand() * Math.PI * 2;
  return { gx, dx: Math.cos(t), dy: Math.sin(t), power: 0.1 + rand() * 0.6 };
}

/** A small random variation of a good shot: nudged aim, power and grab point. */
function tweakFlick(f: Flick, rand: () => number): Flick {
  const dir = rotate(f.dx, f.dy, gaussian(rand) * 0.02);
  const limit = PEN.length / 2 - 0.1;
  return {
    gx: clamp(f.gx + gaussian(rand) * 0.06, -limit, limit),
    dx: dir.x,
    dy: dir.y,
    power: clamp(f.power * (1 + gaussian(rand) * 0.05), 0.08, 1),
  };
}

/**
 * Best value the opponent could get from their next shot in this position.
 * A cheap search (aimed samples only), used to avoid leaving easy knockouts.
 */
function bestReply(pens: readonly Pose[], oppSeat: Seat, samples: number, rand: () => number): number {
  let best = -Infinity;
  for (let i = 0; i < samples; i++) {
    const flick = sampleFlick(pens, oppSeat, rand);
    best = Math.max(best, evaluate(simulateShot(pens, oppSeat, flick), oppSeat));
  }
  return best;
}

/**
 * Pick a flick for the AI by simulating candidate shots with the real physics,
 * refining the best ones, checking what they leave the opponent, and adding
 * human-like error on top.
 */
export function planAiShot(
  match: MatchState,
  seat: Seat,
  difficulty: Difficulty,
  seed: number,
  profileOverride?: DifficultyProfile,
): Flick {
  const profile = profileOverride ?? DIFFICULTY[difficulty];
  const rand = mulberry32(seed);
  const deadline = performance.now() + profile.budgetMs;
  const timeLeft = () => performance.now() < deadline;

  const candidates: { flick: Flick; value: number; result: ShotResult }[] = [];
  const consider = (flick: Flick) => {
    const result = simulateShot(match.pens, seat, flick);
    candidates.push({ flick, value: evaluate(result, seat), result });
  };

  for (let i = 0; i < profile.samples && (i < 24 || timeLeft()); i++) consider(sampleFlick(match.pens, seat, rand));

  candidates.sort((a, b) => b.value - a.value);

  // Stage 2: polish the best shots with small tweaks.
  if (profile.refineTop > 0) {
    const seeds = candidates.slice(0, profile.refineTop).map((c) => c.flick);
    outer: for (const s of seeds) {
      for (let i = 0; i < profile.refineTweaks; i++) {
        if (!timeLeft()) break outer;
        consider(tweakFlick(s, rand));
      }
    }
    candidates.sort((a, b) => b.value - a.value);
  }

  // Stage 3: don't leave the opponent an easy knockout.
  let ranked = candidates;
  if (profile.lookaheadTop > 0) {
    const oppSeat = other(seat);
    const finalists = candidates.slice(0, profile.lookaheadTop);
    for (const c of finalists) {
      const f = c.result.final;
      if (!timeLeft() || c.result.out.some(Boolean) || !f[0] || !f[1]) continue;
      const threat = bestReply(f as Pose[], oppSeat, profile.lookaheadSamples, rand);
      // Only a real knockout threat (>= a point) matters; small positional gains don't.
      if (threat >= 90) c.value -= profile.caution * 100;
      else c.value -= profile.caution * Math.max(0, threat) * 0.15;
    }
    finalists.sort((a, b) => b.value - a.value);
    ranked = finalists; // only shots that were checked against the reply are eligible
  }

  let chosen = ranked[0].flick;
  if (rand() < profile.sloppiness) {
    const pool = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * 0.4)));
    chosen = pool[Math.floor(rand() * pool.length)].flick;
  }

  const dir = rotate(chosen.dx, chosen.dy, gaussian(rand) * profile.angleNoise);
  return {
    gx: chosen.gx,
    dx: dir.x,
    dy: dir.y,
    power: clamp(chosen.power * (1 + gaussian(rand) * profile.powerNoise), 0.08, 1),
  };
}
