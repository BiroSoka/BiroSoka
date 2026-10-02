// Battle Royale rules check: npx tsx scripts/royale-check.ts
import {
  PEN,
  TABLE,
  applyRoyaleResult,
  mulberry32,
  newRoyale,
  resolveRoyaleShot,
  royaleLayout,
  royaleRemovePlayer,
  royaleSkip,
  type Flick,
  type RoyaleState,
  type ShotResult,
} from '../src';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/** A fake simulation result where exactly the listed seats fell off. */
const outcome = (state: RoyaleState, fell: number[]): ShotResult => ({
  final: state.pens.map((p, i) => (fell.includes(i) ? null : p)),
  out: state.pens.map((_, i) => fell.includes(i) || !state.alive[i]),
  contact: true,
  steps: 100,
});
const flick: Flick = { gx: 0, dx: 0, dy: -1, power: 0.5 };
const shot = (s: RoyaleState, shooter: number, fell: number[]) => applyRoyaleResult(s, shooter, flick, outcome(s, fell));

const all4 = [true, true, true, true];
let s = newRoyale(5, 777, 0, all4);

// --- turn order and elimination -------------------------------------------------------------
let r = shot(s, 0, [1]);
check('knocking pen 1 off: turn skips the eliminated seat (0 -> 2)', r.after.turn === 2 && !r.after.alive[1] && !r.roundOver);
s = r.after;
r = shot(s, 2, [2]);
check('own goal just eliminates, no negative points', !r.after.alive[2] && r.after.scores.every((x) => x === 0) && r.after.turn === 3);
s = r.after;
r = shot(s, 3, [0]);
check('last pen standing scores +1', r.roundOver && r.roundWinner === 3 && r.after.scores[3] === 1);
check('next round: everyone back, starter moves clockwise (0 -> 1), 4 pens set out', r.newRound && r.after.starter === 1 && r.after.turn === 1 && r.after.alive.every(Boolean) && r.after.pens.every((p) => p !== null));
s = r.after;

// --- simultaneous eliminations --------------------------------------------------------------
r = shot(s, 1, [0]);
s = r.after; // 1,2,3 left, turn 2
r = shot(s, 2, [3]);
s = r.after; // 1,2 left
r = shot(s, 1, [1, 2]);
check('final two fall together: nobody scores', r.roundOver && r.roundWinner === null && r.after.scores[3] === 1 && r.after.scores.reduce((a, b) => a + b, 0) === 1);
check('...and the round still moves on (starter 1 -> 2)', r.newRound && r.after.starter === 2 && r.after.turn === 2);
s = r.after;

r = shot(s, 2, [0, 1, 2, 3]);
check('everyone falls at once: nobody scores', r.roundOver && r.roundWinner === null && r.after.scores.reduce((a, b) => a + b, 0) === 1);
s = r.after;

r = shot(s, 3, [0, 1]);
s = r.after;
r = shot(s, 2, [2]);
s = r.after;
check('3 left, 2 fall, one survives: survivor scores', r.roundWinner === 3 && r.after.scores[3] === 2, `scores ${r.after.scores}`);
s = r.after;

// --- reaching the target ---------------------------------------------------------------------
s = { ...s, scores: [0, 0, 0, 4] };
r = shot(s, s.turn, [0, 1, 2].filter((i) => i !== 3 && s.alive[i]));
check('first to the target wins the match, no new round', r.after.winner === 3 && !r.newRound);

// --- skipped turns ----------------------------------------------------------------------------
s = newRoyale(5, 888, 1, all4);
const skipped = royaleSkip(s);
check('a skipped turn passes clockwise and nothing else changes', skipped.turn === 2 && skipped.shotNo === 1 && skipped.alive.every(Boolean));
const afterOut = shot(s, 1, [2]).after;
const skipOver = royaleSkip(afterOut);
check('skip passes over eliminated players', afterOut.turn === 3 && skipOver.turn === 0);

// --- players leaving ---------------------------------------------------------------------------
s = newRoyale(5, 999, 0, [true, true, true, false]);
check('empty seat 3 is never alive or in turn order', !s.alive[3] && s.pens[3] === null && royaleSkip(royaleSkip(royaleSkip(s))).turn === 0);
let rm = royaleRemovePlayer(s, 0);
check('player whose turn it is leaves: turn passes on', rm.state.turn === 1 && !rm.state.active[0] && !rm.roundOver);
rm = royaleRemovePlayer(rm.state, 1);
check('only one player left in the match: they win', rm.state.winner === 2, `winner ${rm.state.winner}`);

// --- layouts ---------------------------------------------------------------------------------
let minGap = Infinity, off = 0, overlapped = 0;
for (let players = 2; players <= 4; players++) {
  const active = [0, 1, 2, 3].map((i) => i < players);
  for (let seed = 1; seed <= 600; seed++) {
    const poses = royaleLayout(seed, seed % 7, active).filter((p) => p !== null);
    for (const p of poses) if (p!.x < 0.9 || p!.x > TABLE.w - 0.9 || p!.y < 0.9 || p!.y > TABLE.h - 0.9) off++;
    for (let i = 0; i < poses.length; i++)
      for (let j = i + 1; j < poses.length; j++) {
        const d = Math.hypot(poses[i]!.x - poses[j]!.x, poses[i]!.y - poses[j]!.y);
        minGap = Math.min(minGap, d);
        if (d < PEN.length) overlapped++;
      }
  }
}
check('layouts: pens never overlap and start well inside the desk', overlapped === 0 && off === 0, `closest centres ${minGap.toFixed(2)} (pen length ${PEN.length})`);

// --- full games with the real physics (random bots) ------------------------------------------
const rand = mulberry32(2024);
let games = 0, shots = 0, soleWinnerRounds = 0, noPointRounds = 0, invariantBreaks = 0, unfinished = 0;
for (let g = 0; g < 12; g++) {
  const players = 2 + (g % 3);
  const active = [0, 1, 2, 3].map((i) => i < players);
  let st = newRoyale(g % 2 ? 10 : 5, 5000 + g, g % players, active);
  let n = 0;
  while (st.winner === null && n < 900) {
    const me = st.pens[st.turn]!;
    const foes = st.pens.map((p, i) => ({ p, i })).filter((x) => x.p && x.i !== st.turn);
    const t = foes[Math.floor(rand() * foes.length)].p!;
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    const aim = Math.atan2(t.y - me.y, t.x - me.x) + (rand() - 0.5) * 0.3;
    const f: Flick = { gx: (rand() - 0.5) * 0.8, dx: Math.cos(aim), dy: Math.sin(aim), power: Math.min(1, 0.25 + rand() * 0.6 + d * 0.02) };
    const res = resolveRoyaleShot(st, st.turn, f);
    if (res.roundOver) res.roundWinner === null ? noPointRounds++ : soleWinnerRounds++;
    const a = res.after;
    if (a.winner === null && (!a.alive[a.turn] || a.alive.some((x, i) => x !== (a.pens[i] !== null)) || a.alive.filter(Boolean).length < 2)) invariantBreaks++;
    st = a;
    n++;
    shots++;
  }
  if (st.winner === null) unfinished++;
  else games++;
}
check('12 bot games (2-4 players) all reach a winner with consistent state', games === 12 && invariantBreaks === 0, `${shots} flicks, ${soleWinnerRounds} rounds won, ${noPointRounds} rounds with no point, ${unfinished} unfinished`);

console.log(failures === 0 ? '\nALL ROYALE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
