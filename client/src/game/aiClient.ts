import { planAiShot, type Difficulty, type DifficultyProfile, type Flick, type MatchState, type Seat } from '@biro/shared';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (f: Flick) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; flick: Flick }>) => {
      pending.get(e.data.id)?.(e.data.flick);
      pending.delete(e.data.id);
    };
    return worker;
  } catch {
    return null;
  }
}

/** `profile` overrides the level's settings (Career opponents have their own quirks). */
export function requestAiShot(match: MatchState, seat: Seat, difficulty: Difficulty, profile?: DifficultyProfile): Promise<Flick> {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const w = getWorker();
  if (!w) return Promise.resolve(planAiShot(match, seat, difficulty, seed, profile));
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, match, seat, difficulty, seed, profile });
  });
}
