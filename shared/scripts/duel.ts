// AI vs AI benchmark: npx tsx scripts/duel.ts <difficultyA> <difficultyB> [games]
// Seat roles alternate every game so first-move advantage cancels out.
import { LEGACY_HARD, newMatch, planAiShot, resolveShot, type Difficulty } from '../src';
type Name = Difficulty | 'legacy';
const plan = (m: Parameters<typeof planAiShot>[0], seat: 0 | 1, d: Name, seed: number) =>
  d === 'legacy' ? planAiShot(m, seat, 'hard', seed, LEGACY_HARD) : planAiShot(m, seat, d, seed);

const [a, b, n] = [process.argv[2] as Name, process.argv[3] as Name, Number(process.argv[4] ?? 8)];
const wins = { a: 0, b: 0, none: 0 };
let totalMs = 0, plans = 0, maxMs = 0;
for (let g = 0; g < n; g++) {
  const aSeat = (g % 2) as 0 | 1;
  let m = newMatch(3, 5000 + g, 0);
  let shots = 0;
  while (m.winner === null && shots < 120) {
    const diff = m.turn === aSeat ? a : b;
    const t0 = performance.now();
    const f = plan(m, m.turn, diff, shots * 97 + g * 13 + 1);
    const ms = performance.now() - t0;
    if (diff === a) { totalMs += ms; plans++; maxMs = Math.max(maxMs, ms); }
    m = resolveShot(m, m.turn, f).after;
    shots++;
  }
  if (m.winner === null) wins.none++;
  else if (m.winner === aSeat) wins.a++;
  else wins.b++;
  console.log(`game ${g}: ${m.winner === null ? 'draw' : m.winner === aSeat ? a : b} won ${m.scores} in ${shots} shots`);
}
console.log(`\n${a} ${wins.a} - ${wins.b} ${b}  (unfinished ${wins.none}) | ${a} planning avg ${(totalMs / plans).toFixed(0)}ms max ${maxMs.toFixed(0)}ms`);
