import { getPrefs, setPrefs } from './prefs';
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
  session(): Promise<{ session: string }>;
  purchase(productId: string): Promise<{ purchaseId: string; productId: string }>;
  purchases(): Promise<{ purchaseId: string; productId: string }[]>;
  onPurchase(fn: (p: { purchaseId: string; productId: string }) => void): void;
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

  sdk.onPurchase((p) => void claimPurchase(p.purchaseId));
  sdk
    .init()
    .then((res) => {
      player = res.player;
      // Lagos Life already knows who this is, so use their name instead of asking again.
      if (res.player.name) setPrefs({ name: res.player.name.slice(0, 16) });
      void restorePurchases();
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

// ---- Purchases (cosmetic pens) ----------------------------------------------------------------------------------

function addPurchase(productId: string) {
  setPrefs((p) => (p.stats.purchases.includes(productId) ? {} : { stats: { ...p.stats, purchases: [...p.stats.purchases, productId] } }));
}

async function post(path: string, body: Record<string, unknown>) {
  const { session } = await window.Vatar!.session();
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, ...body }) });
  return res;
}

/** Ask OUR server to check the purchase with Lagos Life. The pen is only unlocked once the server says yes. */
export async function claimPurchase(purchaseId: string): Promise<boolean> {
  try {
    const res = await post('/api/vatar/claim', { purchaseId });
    if (!res.ok) return false;
    const { productId } = (await res.json()) as { productId: string };
    addPurchase(productId);
    return true;
  } catch {
    return false;
  }
}

/** Opens Lagos Life's pay sheet. Resolves true when the pen is unlocked. */
export async function buyProduct(productId: string): Promise<boolean> {
  const sdk = window.Vatar;
  if (!sdk) return false;
  const bought = await sdk.purchase(productId);
  return claimPurchase(bought.purchaseId);
}

/** After a reload or a trip to the payment page: finish anything paid but not yet delivered, and re-learn what we own. */
async function restorePurchases() {
  const sdk = window.Vatar;
  if (!sdk) return;
  try {
    for (const p of await sdk.purchases()) await claimPurchase(p.purchaseId);
    const res = await post('/api/vatar/owned', {});
    if (res.ok) for (const id of ((await res.json()) as { products: string[] }).products) if (!getPrefs().stats.purchases.includes(id)) addPurchase(id);
  } catch {
    /* offline: try again next visit */
  }
}
