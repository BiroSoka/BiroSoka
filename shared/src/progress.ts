import { mulberry32 } from './rng';

/** Daily goals and the day streak. Pure functions so they are easy to test and the app only has to store the result. */

export type GoalKind = 'wins' | 'knockouts' | 'games' | 'ai-wins' | 'spin-knockouts';

export interface GoalTemplate {
  id: string;
  kind: GoalKind;
  target: number;
  text: string;
}

export interface Goal extends GoalTemplate {
  progress: number;
}

export interface DailyState {
  /** The day (local date, YYYY-MM-DD) the goals below belong to. */
  date: string;
  goals: Goal[];
  /** Days in a row with at least one finished game, as of `lastPlayed`. */
  streak: number;
  bestStreak: number;
  /** Local date of the last finished game. */
  lastPlayed: string;
}

export const EMPTY_DAILY: DailyState = { date: '', goals: [], streak: 0, bestStreak: 0, lastPlayed: '' };

export type DailyEvent =
  /** A game finished (win or lose). `ai` = against the Computer. */
  | { type: 'game'; won: boolean; ai: boolean }
  /** You knocked `count` (default 1) pens off the desk. */
  | { type: 'knockout'; spin: boolean; count?: number };

/** One goal is drawn from each row every day, so the three are always different in kind. */
export const GOAL_ROWS: GoalTemplate[][] = [
  [
    { id: 'win-1', kind: 'wins', target: 1, text: 'Win a game' },
    { id: 'win-2', kind: 'wins', target: 2, text: 'Win 2 games' },
  ],
  [
    { id: 'ko-3', kind: 'knockouts', target: 3, text: 'Knock off 3 pens' },
    { id: 'ko-5', kind: 'knockouts', target: 5, text: 'Knock off 5 pens' },
  ],
  [
    { id: 'play-3', kind: 'games', target: 3, text: 'Play 3 games' },
    { id: 'ai-win-1', kind: 'ai-wins', target: 1, text: 'Beat the Computer' },
    { id: 'spin-1', kind: 'spin-knockouts', target: 1, text: 'Knock a pen off with a spin shot' },
  ],
];

/** Pens won by playing on enough days in a row. */
export const STREAK_REWARDS = [
  { days: 3, skin: 'lime' },
  { days: 7, skin: 'galaxy' },
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date on the player's own clock, as YYYY-MM-DD. */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function dayDiff(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The same three goals for everyone on the same date. */
export function goalsForDay(key: string): Goal[] {
  const rand = mulberry32(hashString(key));
  return GOAL_ROWS.map((row) => ({ ...row[Math.floor(rand() * row.length)], progress: 0 }));
}

/** Start a new day's goals if the date has moved on. */
export function ensureToday(d: DailyState, today: string): DailyState {
  return d.date === today ? d : { ...d, date: today, goals: goalsForDay(today) };
}

/** The streak to show: it counts only if you played today or yesterday. */
export function currentStreak(d: DailyState, today: string): number {
  if (!d.lastPlayed) return 0;
  return dayDiff(d.lastPlayed, today) <= 1 ? d.streak : 0;
}

function gain(g: Goal, ev: DailyEvent): number {
  if (ev.type === 'game') {
    if (g.kind === 'games') return 1;
    if (g.kind === 'wins') return ev.won ? 1 : 0;
    if (g.kind === 'ai-wins') return ev.won && ev.ai ? 1 : 0;
    return 0;
  }
  const n = ev.count ?? 1;
  if (g.kind === 'knockouts') return n;
  if (g.kind === 'spin-knockouts') return ev.spin ? n : 0;
  return 0;
}

export interface DailyResult {
  daily: DailyState;
  /** Goals that were finished by this event. */
  completed: Goal[];
  /** The day streak went up (or restarted at 1). */
  streakChanged: boolean;
}

export function applyDailyEvent(d: DailyState, ev: DailyEvent, today: string): DailyResult {
  const state = ensureToday(d, today);
  const completed: Goal[] = [];
  const goals = state.goals.map((g) => {
    const before = g.progress >= g.target;
    const progress = Math.min(g.target, g.progress + gain(g, ev));
    const next = { ...g, progress };
    if (!before && progress >= g.target) completed.push(next);
    return next;
  });

  let { streak, bestStreak, lastPlayed } = state;
  let streakChanged = false;
  if (ev.type === 'game') {
    const gap = lastPlayed ? dayDiff(lastPlayed, today) : Infinity;
    if (gap > 0) {
      // A new day: carry on from yesterday, otherwise start again at 1. (gap < 0 means the clock moved back: ignore.)
      streak = gap === 1 ? streak + 1 : 1;
      lastPlayed = today;
      streakChanged = true;
    }
    bestStreak = Math.max(bestStreak, streak);
  }
  return { daily: { ...state, goals, streak, bestStreak, lastPlayed }, completed, streakChanged };
}
