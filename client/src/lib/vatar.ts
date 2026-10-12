import { setPrefs } from './prefs';
import { sfx } from './audio';

/**
 * Lagos Life ("Vatar Games SDK v1") glue. When the game is opened inside Lagos Life's Games app, the SDK script from
 * lagoslife.app adds `window.Vatar`. Everywhere else (the normal website, a phone browser, tests) it is absent and every
 * function here quietly does nothing, so the game plays exactly as before.
 */

export interface VatarPlayer {
  id: string;
  name: string;
  avatar?: string;
}

interface VatarSdk {
  init(): Promise<{ player: VatarPlayer; session: string; mode: 'test' | 'live' }>;
  onPause(fn: () => void): void;
  onResume(fn: () => void): void;
}

declare global {
  interface Window {
    Vatar?: VatarSdk;
  }
}

/** Fired on `window` when Lagos Life hides or shows the game (a tab switch, a phone call...). */
export const HOST_PAUSE = 'biro:host-pause';
export const HOST_RESUME = 'biro:host-resume';

let player: VatarPlayer | null = null;

/** The Lagos Life player, once `installVatar` has finished. Null on the normal website. */
export function vatarPlayer(): VatarPlayer | null {
  return player;
}

export function insideLagosLife(): boolean {
  return typeof window !== 'undefined' && !!window.Vatar;
}

/** Call once at start-up. Never throws and never blocks the first screen. */
export function installVatar() {
  const sdk = window.Vatar;
  if (!sdk) return;

  // Stop timers and sound while the host says we are not on screen. Sound is only ever started by a tap (see audio.ts).
  sdk.onPause(() => {
    void sfx.graph()?.ctx.suspend();
    window.dispatchEvent(new Event(HOST_PAUSE));
  });
  sdk.onResume(() => {
    void sfx.graph()?.ctx.resume();
    window.dispatchEvent(new Event(HOST_RESUME));
  });

  sdk
    .init()
    .then((res) => {
      player = res.player;
      // Lagos Life already knows who this is, so use their name instead of asking again.
      if (res.player.name) setPrefs({ name: res.player.name.slice(0, 16) });
    })
    .catch(() => {
      /* sandbox hiccup or rate limit: play as a guest */
    });
}

// ---- Leaderboard ----------------------------------------------------------------------------------------------

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
}

interface Board {
  top: BoardRow[];
  me?: { rank?: number; score?: number; label?: string } | null;
}

/** Lagos Life keeps a player's best score and accepts one every 20 seconds, so the newest total waits its turn. */
const SCORE_GAP_MS = 21_000;
let lastSent = 0;
let pending: number | null = null;
let timer: number | null = null;

function flush() {
  timer = null;
  const sdk = window.Vatar as (VatarSdk & { submitScore?: (n: number) => Promise<unknown> }) | undefined;
  if (pending === null || !sdk?.submitScore) return;
  const score = pending;
  pending = null;
  lastSent = Date.now();
  sdk.submitScore(score).catch(() => {
    /* too_soon or offline: the next win sends a fresh total */
  });
}

/** Report total wins (vs Computer and online) to the Lagos Life leaderboard. Does nothing elsewhere. */
export function reportWins(totalWins: number) {
  if (!insideLagosLife() || totalWins <= 0) return;
  pending = totalWins;
  if (timer !== null) return;
  const wait = Math.max(0, lastSent + SCORE_GAP_MS - Date.now());
  timer = window.setTimeout(flush, wait);
}

export async function loadLeaderboard(): Promise<Board> {
  const sdk = window.Vatar as (VatarSdk & { leaderboard?: () => Promise<Board> }) | undefined;
  if (!sdk?.leaderboard) throw new Error('unavailable');
  return sdk.leaderboard();
}
