/**
 * Pen skins are purely cosmetic (PRD section 6: no pay-to-win).
 * Some unlock by playing; later these hooks can be swapped for IAP.
 */
export type BarrelKind = 'clear' | 'solid' | 'metal';

export type SkinUnlock =
  | { type: 'free' }
  | { type: 'wins'; count: number }
  | { type: 'beat'; difficulty: 'hard' };

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
