import { useSyncExternalStore } from 'react';
import { DEFAULT_SKIN, DEFAULT_TARGET, SKINS, type Difficulty, type PenSkin, type TableThemeId } from '@biro/shared';

export interface Stats {
  aiWins: number;
  aiLosses: number;
  beatHard: boolean;
  onlineWins: number;
  onlineLosses: number;
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
  stats: { aiWins: 0, aiLosses: 0, beatHard: false, onlineWins: 0, onlineLosses: 0 },
  seenTutorial: false,
  seenRoyale: false,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULTS, ...parsed, stats: { ...DEFAULTS.stats, ...parsed.stats } };
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
  if (u.type === 'free') return true;
  if (u.type === 'wins') return stats.aiWins + stats.onlineWins >= u.count;
  return stats.beatHard;
}

export function unlockText(skin: PenSkin): string {
  const u = skin.unlock;
  if (u.type === 'free') return 'Free';
  if (u.type === 'wins') return `Win ${u.count} games`;
  return 'Beat Hard AI';
}

export function unlockedSkins(stats: Stats): string[] {
  return SKINS.filter((s) => isUnlocked(s, stats)).map((s) => s.id);
}

export function displayName(p: Prefs): string {
  return p.name.trim() || 'You';
}
