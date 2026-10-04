import { DIFFICULTY, type DifficultyProfile } from './ai';
import type { TableThemeId } from './skins';
import type { Difficulty } from './types';

/** The Career ladder: named opponents you beat one after another. Each has a quirk and a pen as a prize. */
export interface Boss {
  id: string;
  name: string;
  emoji: string;
  /** What makes them different to play against. */
  quirk: string;
  /** What they say before the match. */
  intro: string;
  /** Used for the "beat Hard" unlock and the stats. */
  level: Difficulty;
  profile: DifficultyProfile;
  /** First to this many points. */
  target: number;
  /** The pen they play with. */
  skin: string;
  /** The desk you play on. */
  table: TableThemeId;
  /** The pen you win for beating them. */
  reward: string;
}

export const BOSSES: Boss[] = [
  {
    id: 'new-kid',
    name: 'New Kid',
    emoji: '🐣',
    quirk: 'Still learning which end is the tip.',
    intro: 'I just got my first biro. Go easy on me!',
    level: 'easy',
    profile: DIFFICULTY.easy,
    target: 3,
    skin: 'green',
    table: 'oak',
    reward: 'mint',
  },
  {
    id: 'class-rep',
    name: 'Class Rep',
    emoji: '😎',
    quirk: 'Plays it safe and never flicks too hard.',
    intro: 'Rules are rules. Let us keep this tidy.',
    level: 'medium',
    profile: { ...DIFFICULTY.medium, powerMax: 0.62 },
    target: 3,
    skin: 'red',
    table: 'oak',
    reward: 'tangerine',
  },
  {
    id: 'spin-doctor',
    name: 'Spin Doctor',
    emoji: '🌀',
    quirk: 'Grips the very tip of the pen for wicked spin.',
    intro: 'Straight shots are for beginners.',
    level: 'medium',
    profile: { ...DIFFICULTY.medium, samples: 140, angleNoise: 0.026, gripReach: 0.95 },
    target: 5,
    skin: 'neon',
    table: 'formica',
    reward: 'grape',
  },
  {
    id: 'big-hitter',
    name: 'Big Hitter',
    emoji: '💪',
    quirk: 'Full power, every single flick. Wild, but dangerous.',
    intro: 'Soft flicks? Never heard of them.',
    level: 'medium',
    profile: { ...DIFFICULTY.medium, samples: 100, angleNoise: 0.055, powerMin: 0.88 },
    target: 5,
    skin: 'highlighter',
    table: 'walnut',
    reward: 'rosegold',
  },
  {
    id: 'head-prefect',
    name: 'Head Prefect',
    emoji: '🧐',
    quirk: 'Never leaves you an easy shot.',
    intro: 'I have been watching you. Detention awaits.',
    level: 'medium',
    profile: { ...DIFFICULTY.hard, samples: 170, refineTop: 4, refineTweaks: 8, lookaheadTop: 4, lookaheadSamples: 16, angleNoise: 0.012, powerNoise: 0.025, budgetMs: 1500 },
    target: 5,
    skin: 'chrome',
    table: 'walnut',
    reward: 'obsidian',
  },
  {
    id: 'desk-champ',
    name: 'Desk Champ',
    emoji: '👑',
    quirk: 'Undefeated since Year 7. Barely misses.',
    intro: 'Nobody has ever knocked me off this desk.',
    level: 'hard',
    profile: DIFFICULTY.hard,
    target: 7,
    skin: 'gold',
    table: 'walnut',
    reward: 'emerald',
  },
];

export function getBoss(id: string | undefined | null): Boss | undefined {
  return BOSSES.find((b) => b.id === id);
}

export type BossState = 'cleared' | 'current' | 'locked';

/** Opponents are beaten in order: the first one you have not beaten is the current one. */
export function bossStates(cleared: readonly string[]): { boss: Boss; state: BossState }[] {
  let currentFound = false;
  return BOSSES.map((boss) => {
    if (cleared.includes(boss.id)) return { boss, state: 'cleared' as const };
    if (!currentFound) {
      currentFound = true;
      return { boss, state: 'current' as const };
    }
    return { boss, state: 'locked' as const };
  });
}

/** The next opponent to beat, or null when the whole ladder is cleared. */
export function nextBoss(cleared: readonly string[]): Boss | null {
  return bossStates(cleared).find((b) => b.state === 'current')?.boss ?? null;
}
