import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SKIN,
  DEFAULT_TARGET,
  EMPTY_DAILY,
  SKINS,
  applyDailyEvent,
  currentStreak,
  dateKey,
  getBoss,
  type DailyEvent,
  type DailyResult,
  type DailyState,
  type Difficulty,
  type PenSkin,
  type TableThemeId,
} from '@biro/shared';

export interface Stats {
  aiWins: number;
  aiLosses: number;
  beatHard: boolean;
  onlineWins: number;
  onlineLosses: number;
  /** Career opponents beaten (ids). */
  careerCleared: string[];
  /** Longest run of days with a finished game. */
  bestStreak: number;
}

export interface Prefs {
  name: string;
  skin: string;
  table: TableThemeId;
  sound: boolean;
  music: boolean;
  haptics: boolean;
  guide: 'short' | 'long';
  target: number;
  difficulty: Difficulty;
  stats: Stats;
  /** Today's goals and the day streak. */
  daily: DailyState;
  seenTutorial: boolean;
  /** Has tried Battle Royale (the NEW badge goes away). */
  seenRoyale: boolean;
}

const KEY = 'biro-soka:prefs:v1';

const DEFAULTS: Prefs = {
  name: '',
  skin: DEFAULT_SKIN,
  table: 'oak',
  sound: true,
  music: true,
  haptics: true,
  guide: 'short',
  target: DEFAULT_TARGET,
  difficulty: 'medium',
  stats: { aiWins: 0, aiLosses: 0, beatHard: false, onlineWins: 0, onlineLosses: 0, careerCleared: [], bestStreak: 0 },
  daily: EMPTY_DAILY,
  seenTutorial: false,
  seenRoyale: false,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // Older saves lack the newer fields: fill them in so nothing is lost and nothing breaks.
    return { ...DEFAULTS, ...parsed, stats: { ...DEFAULTS.stats, ...parsed.stats }, daily: { ...DEFAULTS.daily, ...parsed.daily } };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const next = typeof patch === 'function' ? patch(current) : patch;
  current = { ...current, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode / storage full: prefs just won't persist */
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function isUnlocked(skin: PenSkin, stats: Stats): boolean {
  const u = skin.unlock;
  switch (u.type) {
    case 'free':
      return true;
    case 'wins':
      return stats.aiWins + stats.onlineWins >= u.count;
    case 'beat':
      return stats.beatHard;
    case 'career':
      return stats.careerCleared.includes(u.boss);
    case 'streak':
      return stats.bestStreak >= u.days;
  }
}

export function unlockText(skin: PenSkin): string {
  const u = skin.unlock;
  switch (u.type) {
    case 'free':
      return 'Free';
    case 'wins':
      return `Win ${u.count} games`;
    case 'beat':
      return 'Beat Hard AI';
    case 'career':
      return `Beat ${getBoss(u.boss)?.name ?? 'a Career opponent'}`;
    case 'streak':
      return `Play ${u.days} days in a row`;
  }
}

export function unlockedSkins(stats: Stats): string[] {
  return SKINS.filter((s) => isUnlocked(s, stats)).map((s) => s.id);
}

export function displayName(p: Prefs): string {
  return p.name.trim() || 'You';
}

/**
 * Tell the daily goals something happened (a game finished, a pen was knocked off).
 * Saves the new progress and returns which goals just finished and what the day streak is now.
 */
export function recordDaily(ev: DailyEvent): DailyResult & { streak: number } {
  const today = dateKey();
  const res = applyDailyEvent(getPrefs().daily, ev, today);
  setPrefs((p) => ({ daily: res.daily, stats: { ...p.stats, bestStreak: Math.max(p.stats.bestStreak, res.daily.bestStreak) } }));
  return { ...res, streak: currentStreak(res.daily, today) };
}
