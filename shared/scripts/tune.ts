// Headless physics check: npx tsx scripts/tune.ts
import { Sim, simulateShot, newMatch, planAiShot, resolveShot, PEN } from '../src';

const pose = { x: 2.6, y: 7.5, a: 0 };
for (const power of [0.1, 0.25, 0.5, 0.75, 1]) {
  const sim = new Sim([{ ...pose }]);
  sim.applyFlick(0, { gx: 0, dx: 0, dy: -1, power });
  let t = 0;
  // run without table edges mattering: we only care about distance, so use a tall table check
  while (!sim.settled()) { sim.step(); t++; }
  const p = sim.pose(0);
  console.log(`power ${power}: travelled ${p ? (pose.y - p.y).toFixed(2) : 'OFF'} in ${(t / 120).toFixed(2)}s`);
}
// spin check: tip flick, perpendicular
{
  const sim = new Sim([{ x: 2.6, y: 4.2, a: 0 }]);
  sim.applyFlick(0, { gx: PEN.length / 2 * 0.9, dx: 0, dy: -1, power: 0.5 });
  let t = 0; while (!sim.settled()) { sim.step(); t++; }
  console.log('tip flick 50%:', sim.pose(0), (t / 120).toFixed(2) + 's');
}
// head-on hit
{
  const m = newMatch(5, 1234);
  const [a, b] = m.pens;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  for (const power of [0.5, 0.75, 1]) {
    const r = simulateShot(m.pens, 0, { gx: 0, dx: dx / d, dy: dy / d, power });
    console.log(`direct hit p=${power}: out=${r.out} contact=${r.contact} final=${JSON.stringify(r.final.map(p => p && { x: +p.x.toFixed(2), y: +p.y.toFixed(2) }))}`);
  }
}
// AI timing
for (const diff of ['easy', 'medium', 'hard'] as const) {
  const m = newMatch(5, 99);
  const t0 = performance.now();
  const f = planAiShot(m, 1, diff, 42);
  const dt = performance.now() - t0;
  const r = resolveShot(m, 1, f);
  console.log(`AI ${diff}: ${dt.toFixed(0)}ms -> outcome ${r.outcome}`);
}
// AI win rate hard vs easy over a few games
let wins = [0, 0];
for (let g = 0; g < 6; g++) {
  let m = newMatch(3, 1000 + g, (g % 2) as 0 | 1);
  let shots = 0;
  while (m.winner === null && shots < 200) {
    const f = planAiShot(m, m.turn, m.turn === 0 ? 'hard' : 'easy', shots * 31 + g);
    m = resolveShot(m, m.turn, f).after; shots++;
  }
  if (m.winner !== null) wins[m.winner]++;
  console.log(`game ${g}: winner ${m.winner} scores ${m.scores} shots ${shots}`);
}
console.log('hard vs easy wins', wins);
