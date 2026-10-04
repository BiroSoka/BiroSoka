// How strong is each Career opponent? Plays them against the normal Medium AI, or against another opponent.
//   npx tsx scripts/career-duel.ts <boss id> [games] [rival boss id]
// Sides alternate every game so the first move does not decide it. Games are first to 3.
import { getBoss, newMatch, planAiShot, resolveShot } from '../src';

const boss = getBoss(process.argv[2]);
const games = Number(process.argv[3] ?? 10);
const rival = process.argv[4] ? getBoss(process.argv[4]) : undefined;
if (!boss || (process.argv[4] && !rival)) {
  console.error('Unknown boss id. Try: new-kid class-rep spin-doctor big-hitter head-prefect desk-champ');
  process.exit(1);
}

let wins = 0;
let plans = 0;
let ms = 0;
for (let g = 0; g < games; g++) {
  const bossSeat = (g % 2) as 0 | 1;
  let m = newMatch(3, 31000 + g, 0);
  let shots = 0;
  while (m.winner === null && shots < 120) {
    const seed = shots * 61 + g * 7 + 3;
    const t0 = performance.now();
    let f;
    if (m.turn === bossSeat) {
      f = planAiShot(m, m.turn, boss.level, seed, boss.profile);
      ms += performance.now() - t0;
      plans++;
    } else {
      f = rival ? planAiShot(m, m.turn, rival.level, seed + 1, rival.profile) : planAiShot(m, m.turn, 'medium', seed + 1);
    }
    m = resolveShot(m, m.turn, f).after;
    shots++;
  }
  if (m.winner === bossSeat) wins++;
}
console.log(`${boss.name.padEnd(13)} beat ${(rival?.name ?? 'Medium').padEnd(13)} in ${wins}/${games} games (${Math.round((wins / games) * 100)}%) | plans in ${(ms / plans).toFixed(0)}ms on average`);
