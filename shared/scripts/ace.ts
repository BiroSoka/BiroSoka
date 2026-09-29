// How often does a dead-straight shot at the opponent's pen knock it off? npx tsx scripts/ace.ts
import { Sim, startPoses, PEN, simulateShot, wobbleFlick, type Flick } from '../src';

const LAYOUTS = 300;
const DRAWS = 6; // wobble draws per layout
console.log('power  ace-rate (knockout, shooter stays on)   own-goal   miss');
for (const power of [0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1]) {
  let ace = 0, own = 0, miss = 0;
  for (let i = 0; i < LAYOUTS * DRAWS; i++) {
    const layout = i % LAYOUTS, draw = Math.floor(i / LAYOUTS);
    const [a, b] = startPoses(1000 + layout, 0);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    const flick: Flick = { gx: 0, dx: dx / d, dy: dy / d, power };
    const r = simulateShot([a, b], 0, wobbleFlick(1000 + layout, draw, flick));
    if (r.out[1] && !r.out[0]) ace++;
    else if (r.out[0] && !r.out[1]) own++;
    else miss++;
  }
  const pct = (n: number) => `${((n / (LAYOUTS * DRAWS)) * 100).toFixed(0).padStart(3)}%`;
  console.log(`${power.toFixed(2)}   ${pct(ace)}                                  ${pct(own)}       ${pct(miss)}`);
}
void Sim; void PEN;
