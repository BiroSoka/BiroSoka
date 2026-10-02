// 1 v 1 scoring check: npx tsx scripts/rules-check.ts
import { applyShotResult, cleanChat, CHAT_MAX, mulberry32, newMatch, resolveShot, scoreShot, type Flick, type MatchState, type ShotResult } from '../src';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/** A pretend finished shot where the listed seats fell off. */
const fake = (m: MatchState, fell: number[]): ShotResult => ({
  final: m.pens.map((p, i) => (fell.includes(i) ? null : p)),
  out: m.pens.map((_, i) => fell.includes(i)),
  contact: true,
  steps: 100,
});
const flick: Flick = { gx: 0, dx: 0, dy: -1, power: 0.5 };
const play = (m: MatchState, shooter: 0 | 1, fell: number[]) => applyShotResult(m, shooter, flick, fake(m, fell));

let m = newMatch(5, 123, 0);
let r = play(m, 0, [1]);
check('knockout: shooter +1, opponent unchanged', r.outcome === 'knockout' && r.after.scores.join() === '1,0');
r = play(m, 0, [0]);
check('own goal: the OPPONENT gets +1, the shooter stays at 0 (no minus)', r.outcome === 'own-goal' && r.after.scores.join() === '0,1', `scores ${r.after.scores}`);
r = play(m, 1, [1]);
check('own goal by seat 1 gives the point to seat 0', r.after.scores.join() === '1,0');
r = play(m, 0, [0, 1]);
check('both fall: nobody scores', r.outcome === 'both-off' && r.after.scores.join() === '0,0');
r = play(m, 0, []);
check('nothing falls: nothing changes', r.outcome === 'none' && r.after.scores.join() === '0,0');
check('scoreShot reports who gets the point', scoreShot(0, [true, false]).oppDelta === 1 && scoreShot(0, [true, false]).delta === 0);

const matchPoint: MatchState = { ...m, scores: [0, 4] };
r = play(matchPoint, 0, [0]);
check('an own goal at match point hands the opponent the win', r.after.winner === 1 && r.after.scores[1] === 5);
r = play({ ...m, scores: [4, 0] }, 0, [1]);
check('a knockout at match point still wins it', r.after.winner === 0);

// Whole games with the real physics and random flicks: scores never go negative and every point is explained.
const rand = mulberry32(99);
let games = 0, negatives = 0, mismatched = 0, ownGoals = 0, knockouts = 0;
for (let g = 0; g < 40; g++) {
  let st = newMatch(5, 7000 + g, (g % 2) as 0 | 1);
  let points = 0;
  for (let n = 0; n < 400 && st.winner === null; n++) {
    const me = st.pens[st.turn];
    const opp = st.pens[1 - st.turn];
    const aim = Math.atan2(opp.y - me.y, opp.x - me.x) + (rand() - 0.5) * 0.9;
    const f: Flick = { gx: (rand() - 0.5) * 0.8, dx: Math.cos(aim), dy: Math.sin(aim), power: 0.2 + rand() * 0.8 };
    const res = resolveShot(st, st.turn, f);
    if (res.outcome === 'knockout') { points++; knockouts++; }
    if (res.outcome === 'own-goal') { points++; ownGoals++; }
    if (res.after.scores.some((s) => s < 0)) negatives++;
    st = res.after;
  }
  if (st.scores[0] + st.scores[1] !== points) mismatched++;
  if (st.winner !== null) games++;
}
check('40 full games: no negative score, every point came from a knockout or an own goal', negatives === 0 && mismatched === 0 && games === 40, `${knockouts} knockouts, ${ownGoals} own goals, ${games}/40 finished`);

// chat tidying
check('chat: trims and collapses spaces', cleanChat('  hi    there  ') === 'hi there');
check('chat: strips control characters', cleanChat('a\u0000b\u0007c‮d') === 'a b c d');
check(`chat: limited to ${CHAT_MAX} characters`, Array.from(cleanChat('x'.repeat(200))).length === CHAT_MAX);
check('chat: does not split an emoji in half', cleanChat('😀'.repeat(60)) === '😀'.repeat(CHAT_MAX));
check('chat: rejects non-text', cleanChat(42) === '' && cleanChat(null) === '' && cleanChat({ a: 1 }) === '' && cleanChat('   ') === '');

console.log(failures === 0 ? '\nALL RULES CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
