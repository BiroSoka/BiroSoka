// A replay must show exactly what happened: npx tsx scripts/replay-check.ts
import { ReplayPlayer, mulberry32, newMatch, newRoyale, resolveRoyaleShot, resolveShot, simulateShot, wobbleFlick, type Flick, type Pose, type ReplayData } from '../src';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const rand = mulberry32(8080);
const same = (a: (Pose | null)[], b: (Pose | null)[]) => a.length === b.length && a.every((p, i) => (p === null && b[i] === null) || (p !== null && b[i] !== null && p.x === b[i]!.x && p.y === b[i]!.y && p.a === b[i]!.a));

/** Run a replay to the end with irregular frame times, like a real phone. */
function runReplay(data: ReplayData) {
  const rp = new ReplayPlayer(data);
  let guard = 0;
  let events = 0;
  while (!rp.done && guard++ < 20000) events += rp.advance(1 / 30 + rand() * (1 / 144 - 1 / 30) * -1).length;
  return { poses: rp.poses(), events, done: rp.done };
}

// ---- 1 v 1: the replay ends exactly where the server's result ended --------------------------------------------------
let duelMatches = 0;
let duelKnockouts = 0;
let wobbled = 0;
let wobbleMattered = 0;
for (let i = 0; i < 60; i++) {
  const m = newMatch(5, 4000 + i, (i % 2) as 0 | 1);
  const me = m.pens[m.turn];
  const opp = m.pens[1 - m.turn];
  const aim = Math.atan2(opp.y - me.y, opp.x - me.x) + (rand() - 0.5) * 0.5;
  const flick: Flick = { gx: (rand() - 0.5) * 1.0, dx: Math.cos(aim), dy: Math.sin(aim), power: 0.3 + rand() * 0.7 };
  const server = resolveShot(m, m.turn, flick);
  const replay = runReplay({ pens: m.pens, shooter: m.turn, flick, seed: m.seed, shotNo: m.shotNo });
  if (same(replay.poses, server.result.final)) duelMatches++;
  if (server.outcome === 'knockout') duelKnockouts++;
  if (flick.power > 0.78) {
    wobbled++;
    // Would the shot have ended somewhere else without the wobble? Then matching proves the wobble is replayed.
    if (!same(simulateShot(m.pens, m.turn, flick).final, server.result.final)) wobbleMattered++;
  }
}
check('60 one-vs-one shots: every replay ends exactly where the real shot ended', duelMatches === 60, `${duelMatches}/60 (${duelKnockouts} knockouts)`);
check('...including shots where the high-power wobble changed the outcome (so the wobble is replayed too)', wobbleMattered > 0 && duelMatches === 60, `${wobbleMattered} of ${wobbled} high-power shots ended differently from an un-wobbled shot, and all were replayed exactly`);

// ---- Battle Royale: same guarantee with 3 and 4 pens -----------------------------------------------------------------
let royaleMatches = 0;
for (let i = 0; i < 40; i++) {
  const players = 3 + (i % 2);
  const st = newRoyale(5, 6000 + i, i % players, [0, 1, 2, 3].map((k) => k < players));
  const me = st.pens[st.turn]!;
  const targetSeat = (st.turn + 1) % players;
  const t = st.pens[targetSeat]!;
  const aim = Math.atan2(t.y - me.y, t.x - me.x) + (rand() - 0.5) * 0.4;
  const flick: Flick = { gx: (rand() - 0.5) * 0.8, dx: Math.cos(aim), dy: Math.sin(aim), power: 0.4 + rand() * 0.6 };
  const server = resolveRoyaleShot(st, st.turn, flick);
  const replay = runReplay({ pens: st.pens, shooter: st.turn, flick, seed: st.seed, shotNo: st.shotNo });
  if (same(replay.poses, server.result.final)) royaleMatches++;
}
check('40 Battle Royale shots (3 and 4 pens): every replay matches', royaleMatches === 40, `${royaleMatches}/40`);

// ---- it is safe and repeatable ---------------------------------------------------------------------------------------------
const m = newMatch(5, 12345, 0);
const f: Flick = { gx: 0.1, dx: 0, dy: -1, power: 0.9 };
const data: ReplayData = { pens: m.pens, shooter: 0, flick: f, seed: m.seed, shotNo: m.shotNo };
const before = JSON.stringify(m.pens);
const a = runReplay(data);
const b = runReplay(data);
check('replaying twice gives the same result', same(a.poses, b.poses) && a.events === b.events);
check('replaying never changes the saved starting positions', JSON.stringify(m.pens) === before);
check('a replay always finishes', a.done);

// frame rate must not matter: a slow phone and a fast one see the same shot
const slow = new ReplayPlayer(data);
while (!slow.done) slow.advance(0.05);
const fast = new ReplayPlayer(data);
while (!fast.done) fast.advance(1 / 144);
check('slow and fast frame rates show the same shot', same(slow.poses(), fast.poses()));

// it matches a straight simulation too
const direct = simulateShot(m.pens, 0, wobbleFlick(m.seed, m.shotNo, f));
check('it also matches the plain simulation', same(a.poses, direct.final));

console.log(failures === 0 ? '\nALL REPLAY CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
