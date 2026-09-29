import Avatar from 'boring-avatars';
import { getSkin } from '@biro/shared';

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend a hex colour toward another by `amt` (0..1). Returns hex, which boring-avatars needs for its contrast maths. */
function mix(hex: string, toward: string, amt: number): string {
  const a = toRgb(hex);
  const b = toRgb(toward);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amt));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A five-colour palette taken from a pen skin, so a player's avatar matches their pen:
 * clear-barrel biros use their cap colour, solid and metal pens use their barrel colour.
 */
export function avatarPalette(skinId: string): string[] {
  const skin = getSkin(skinId);
  let primary = skin.barrel === 'clear' ? skin.capColor : skin.barrelColor;
  const [r, g, b] = toRgb(primary);
  // Black pens would give a black blob: lift them to charcoal so the face stays readable.
  if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.25) primary = mix(primary, '#ffffff', 0.4);
  // All light-to-mid tones plus one warm highlight, like the boringavatars.com demo palettes.
  return [primary, mix(primary, '#ffffff', 0.45), skin.accent, mix(primary, '#ffd54a', 0.55), mix(primary, '#ffffff', 0.85)];
}

/** Round "beam" face (boringavatars.com) seeded by the player's name and coloured by their pen. */
export function PlayerAvatar({ name, skin, size = 40, className = '' }: { name: string; skin: string; size?: number; className?: string }) {
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, ['--pen' as string]: getSkin(skin).capColor }} aria-hidden="true">
      <Avatar variant="beam" name={name || 'Player'} colors={avatarPalette(skin)} size={size} />
    </span>
  );
}
