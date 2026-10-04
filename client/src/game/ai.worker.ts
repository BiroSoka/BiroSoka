/// <reference lib="webworker" />
import { planAiShot, type Difficulty, type DifficultyProfile, type MatchState, type Seat } from '@biro/shared';

// Plans the AI's shot off the main thread so the table keeps animating while it "thinks".
self.onmessage = (e: MessageEvent<{ id: number; match: MatchState; seat: Seat; difficulty: Difficulty; seed: number; profile?: DifficultyProfile }>) => {
  const { id, match, seat, difficulty, seed, profile } = e.data;
  const flick = planAiShot(match, seat, difficulty, seed, profile);
  (self as unknown as Worker).postMessage({ id, flick });
};
