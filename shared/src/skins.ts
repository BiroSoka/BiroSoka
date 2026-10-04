/**
 * Pen skins are purely cosmetic (PRD section 6: no pay-to-win).
 * Some unlock by playing; later these hooks can be swapped for IAP.
 */
export type BarrelKind = 'clear' | 'solid' | 'metal';

export type SkinUnlock =
  | { type: 'free' }
  | { type: 'wins'; count: number }
  | { type: 'beat'; difficulty: 'hard' }
  /** Won by beating a Career opponent. */
  | { type: 'career'; boss: string }
  /** Won by playing on this many days in a row. */
  | { type: 'streak'; days: number };

export interface PenSkin {
  id: string;
  name: string;
  barrel: BarrelKind;
  /** Barrel base colour (tint for clear barrels). */
  barrelColor: string;
  capColor: string;
  inkColor: string;
  /** Highlight / trim colour. */
  accent: string;
  unlock: SkinUnlock;
}

export const SKINS: PenSkin[] = [
  { id: 'blue', name: 'Classic Blue', barrel: 'clear', barrelColor: '#dfe8f2', capColor: '#1d47b8', inkColor: '#1a3a9e', accent: '#6f95ff', unlock: { type: 'free' } },
  { id: 'red', name: 'Classic Red', barrel: 'clear', barrelColor: '#f2e3e3', capColor: '#c9202a', inkColor: '#b3131d', accent: '#ff7a80', unlock: { type: 'free' } },
  { id: 'black', name: 'Exam Black', barrel: 'clear', barrelColor: '#e4e6ea', capColor: '#1b1c20', inkColor: '#111216', accent: '#8c93a3', unlock: { type: 'free' } },
  { id: 'green', name: 'Teacher Green', barrel: 'clear', barrelColor: '#e2f0e6', capColor: '#17803d', inkColor: '#0f6b31', accent: '#62d68e', unlock: { type: 'free' } },
  { id: 'highlighter', name: 'Highlighter', barrel: 'solid', barrelColor: '#ffe534', capColor: '#2a2a2a', inkColor: '#ffe534', accent: '#fff7a8', unlock: { type: 'wins', count: 2 } },
  { id: 'neon', name: 'Neon Pink', barrel: 'solid', barrelColor: '#ff3ea5', capColor: '#161616', inkColor: '#ff3ea5', accent: '#ffa3d4', unlock: { type: 'wins', count: 5 } },
  { id: 'chrome', name: 'Chrome', barrel: 'metal', barrelColor: '#c9ced6', capColor: '#23262d', inkColor: '#111216', accent: '#ffffff', unlock: { type: 'wins', count: 10 } },
  { id: 'gold', name: 'Gold Nib', barrel: 'metal', barrelColor: '#e2b64a', capColor: '#3a2a0a', inkColor: '#111216', accent: '#fff1b8', unlock: { type: 'beat', difficulty: 'hard' } },
  // Career pens: one for each opponent you beat.
  { id: 'mint', name: 'Mint', barrel: 'solid', barrelColor: '#5ee6b0', capColor: '#14463a', inkColor: '#5ee6b0', accent: '#c9ffe9', unlock: { type: 'career', boss: 'new-kid' } },
  { id: 'tangerine', name: 'Tangerine', barrel: 'solid', barrelColor: '#ff8a1f', capColor: '#3a1c00', inkColor: '#ff8a1f', accent: '#ffd2a0', unlock: { type: 'career', boss: 'class-rep' } },
  { id: 'grape', name: 'Grape', barrel: 'solid', barrelColor: '#8a4dff', capColor: '#1e0f40', inkColor: '#8a4dff', accent: '#d6c2ff', unlock: { type: 'career', boss: 'spin-doctor' } },
  { id: 'rosegold', name: 'Rose Gold', barrel: 'metal', barrelColor: '#e8a79a', capColor: '#4a2a24', inkColor: '#111216', accent: '#fff0ea', unlock: { type: 'career', boss: 'big-hitter' } },
  { id: 'obsidian', name: 'Obsidian', barrel: 'metal', barrelColor: '#3a3f4a', capColor: '#0d0e12', inkColor: '#111216', accent: '#9aa4b8', unlock: { type: 'career', boss: 'head-prefect' } },
  { id: 'emerald', name: 'Emerald Champ', barrel: 'metal', barrelColor: '#2fbf86', capColor: '#06281d', inkColor: '#111216', accent: '#bdf7de', unlock: { type: 'career', boss: 'desk-champ' } },
  // Streak pens.
  { id: 'lime', name: 'Lime Streak', barrel: 'solid', barrelColor: '#9be22a', capColor: '#243d00', inkColor: '#9be22a', accent: '#e6ffa8', unlock: { type: 'streak', days: 3 } },
  { id: 'galaxy', name: 'Galaxy', barrel: 'metal', barrelColor: '#5b4bd6', capColor: '#120e33', inkColor: '#111216', accent: '#c9c2ff', unlock: { type: 'streak', days: 7 } },
];

export const DEFAULT_SKIN = 'blue';

export function getSkin(id: string | undefined | null): PenSkin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** If both players picked the same pen, give the second one a contrasting colour. */
export function distinctSkins(a: string, b: string): [string, string] {
  if (a !== b) return [a, b];
  return [a, a === 'red' ? 'blue' : 'red'];
}

export type TableThemeId = 'oak' | 'walnut' | 'formica';

export const TABLE_THEMES: { id: TableThemeId; name: string }[] = [
  { id: 'oak', name: 'Oak Desk' },
  { id: 'walnut', name: 'Head Teacher' },
  { id: 'formica', name: 'Lab Bench' },
];

/**
 * Give every player a different pen. If two players picked the same skin, the later seat gets the
 * first free skin instead (free skins first). Deterministic, so every device agrees.
 */
export function distinctSkinList(ids: string[]): string[] {
  const used = new Set<string>();
  const spare = [...SKINS.filter((s) => s.unlock.type === 'free'), ...SKINS.filter((s) => s.unlock.type !== 'free')].map((s) => s.id);
  return ids.map((id) => {
    let pick = used.has(id) ? (spare.find((s) => !used.has(s)) ?? id) : id;
    if (!SKINS.some((s) => s.id === pick)) pick = spare.find((s) => !used.has(s)) ?? SKINS[0].id;
    used.add(pick);
    return pick;
  });
}
