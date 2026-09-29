import { mulberry32, TABLE, type TableThemeId } from '@biro/shared';

interface Palette {
  base: [string, string, string];
  grainDark: string;
  grainLight: string;
  ink: string;
  kind: 'wood' | 'speckle';
}

const THEMES: Record<TableThemeId, Palette> = {
  oak: {
    base: ['#d7a263', '#c68d4f', '#b97f43'],
    grainDark: '98,58,24',
    grainLight: '255,226,180',
    ink: '28,58,160',
    kind: 'wood',
  },
  walnut: {
    base: ['#7a4c2c', '#653b20', '#562f18'],
    grainDark: '30,14,5',
    grainLight: '200,140,95',
    ink: '190,210,255',
    kind: 'wood',
  },
  formica: {
    base: ['#cfd7dc', '#bfc9cf', '#b3bec5'],
    grainDark: '60,72,82',
    grainLight: '255,255,255',
    ink: '40,52,70',
    kind: 'speckle',
  },
};

export const RIM_COLORS: Record<TableThemeId, [string, string]> = {
  oak: ['#8b5a2b', '#4f2f12'],
  walnut: ['#3e2413', '#1b0e06'],
  formica: ['#7f8b93', '#3f474d'],
};

/**
 * Paint the desk surface once into an offscreen canvas (world-aligned, portrait).
 * Everything is procedural: wood grain, knots, scratches and schoolkid doodles.
 */
export function paintTable(theme: TableThemeId, ppu: number): HTMLCanvasElement {
  const pal = THEMES[theme];
  const W = Math.round(TABLE.w * ppu);
  const H = Math.round(TABLE.h * ppu);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rand = mulberry32(theme === 'oak' ? 7 : theme === 'walnut' ? 21 : 33);
  const u = ppu / 100; // unit helper so detail scales with resolution

  // Base colour with gentle variation.
  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, pal.base[0]);
  base.addColorStop(0.55, pal.base[1]);
  base.addColorStop(1, pal.base[2]);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  if (pal.kind === 'wood') {
    // Broad figure bands.
    for (let i = 0; i < 9; i++) {
      const x0 = rand() * W;
      const width = (20 + rand() * 60) * u;
      g.strokeStyle = `rgba(${rand() < 0.5 ? pal.grainDark : pal.grainLight},${0.05 + rand() * 0.06})`;
      g.lineWidth = width;
      wavyLine(g, x0, H, rand, 14 * u, 0.004 / u);
    }
    // Fine grain lines.
    const lines = Math.round(W / (3.2 * u));
    for (let i = 0; i < lines; i++) {
      const x0 = rand() * W;
      const dark = rand() < 0.75;
      g.strokeStyle = `rgba(${dark ? pal.grainDark : pal.grainLight},${(dark ? 0.07 : 0.05) + rand() * 0.14})`;
      g.lineWidth = (0.4 + rand() * 1.8) * u;
      wavyLine(g, x0, H, rand, (3 + rand() * 7) * u, (0.006 + rand() * 0.01) / u);
    }
    // Knots.
    for (let k = 0; k < 2; k++) {
      const kx = W * (0.15 + rand() * 0.7);
      const ky = H * (0.1 + rand() * 0.8);
      for (let r = 1; r < 9; r++) {
        g.strokeStyle = `rgba(${pal.grainDark},${0.22 - r * 0.02})`;
        g.lineWidth = (1 + rand()) * u;
        g.beginPath();
        g.ellipse(kx, ky, r * 3.2 * u, r * 9 * u, (rand() - 0.5) * 0.2, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = `rgba(${pal.grainDark},0.45)`;
      g.beginPath();
      g.ellipse(kx, ky, 3 * u, 7 * u, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Laminate speckle.
    const dots = Math.round((W * H) / (26 * u * u));
    for (let i = 0; i < dots; i++) {
      g.fillStyle = `rgba(${rand() < 0.6 ? pal.grainDark : pal.grainLight},${0.06 + rand() * 0.18})`;
      const s = (0.5 + rand() * 1.6) * u;
      g.fillRect(rand() * W, rand() * H, s, s);
    }
  }

  // Scratches and scuffs.
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const len = (6 + rand() * 40) * u;
    const ang = Math.PI / 2 + (rand() - 0.5) * 1.4;
    g.strokeStyle = `rgba(${pal.grainLight},${0.08 + rand() * 0.14})`;
    g.lineWidth = (0.4 + rand() * 0.8) * u;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }

  drawDoodles(g, W, H, u, pal, rand);

  // Worn centre line: where everyone has been flicking pens for years.
  g.save();
  g.setLineDash([10 * u, 12 * u]);
  g.strokeStyle = `rgba(${pal.grainLight},0.16)`;
  g.lineWidth = 2 * u;
  g.beginPath();
  g.moveTo(W * 0.06, H / 2);
  g.lineTo(W * 0.94, H / 2);
  g.stroke();
  g.restore();

  // Overhead light: bright pool in the middle, darker toward the edges.
  const lamp = g.createRadialGradient(W * 0.45, H * 0.4, W * 0.1, W * 0.5, H * 0.5, H * 0.75);
  lamp.addColorStop(0, 'rgba(255,248,230,0.16)');
  lamp.addColorStop(0.6, 'rgba(255,248,230,0)');
  lamp.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, W, H);

  // Edge wear / bevel.
  const bevel = 6 * u;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = bevel;
  g.strokeRect(bevel / 2, bevel / 2, W - bevel, H - bevel);
  g.strokeStyle = `rgba(${pal.grainLight},0.25)`;
  g.lineWidth = 1.5 * u;
  g.strokeRect(bevel + u, bevel + u, W - 2 * bevel - 2 * u, H - 2 * bevel - 2 * u);

  return c;
}

function wavyLine(g: CanvasRenderingContext2D, x0: number, H: number, rand: () => number, amp: number, freq: number) {
  const ph = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const drift = (rand() - 0.5) * 0.05;
  g.beginPath();
  for (let y = -10; y <= H + 10; y += 6) {
    const x = x0 + Math.sin(y * freq + ph) * amp + Math.sin(y * freq * 2.7 + ph2) * amp * 0.35 + y * drift;
    if (y === -10) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

function drawDoodles(g: CanvasRenderingContext2D, W: number, H: number, u: number, pal: Palette, rand: () => number) {
  g.save();
  const ink = (a: number) => `rgba(${pal.ink},${a})`;

  // Carved title in the middle of the desk, like a pool table logo.
  g.translate(W / 2, H / 2);
  g.rotate(-0.08);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${46 * u}px "Permanent Marker", "Baloo 2", sans-serif`;
  g.fillStyle = 'rgba(0,0,0,0.13)';
  g.fillText('BIRO SOKA', 0, 2 * u);
  g.fillStyle = `rgba(${pal.grainLight},0.12)`;
  g.fillText('BIRO SOKA', -1.2 * u, 0);
  g.restore();

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = ink(0.32);
  g.fillStyle = ink(0.32);
  g.lineWidth = 2 * u;

  // Tally marks, bottom-left.
  g.save();
  g.translate(W * 0.1, H * 0.9);
  g.rotate(-0.1);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 9 * u, 0);
    g.lineTo(i * 9 * u + 2 * u, -24 * u);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(-6 * u, -6 * u);
  g.lineTo(34 * u, -18 * u);
  g.stroke();
  g.restore();

  // Heart with initials, top-right.
  g.save();
  g.translate(W * 0.8, H * 0.1);
  g.rotate(0.15);
  g.beginPath();
  const s = 16 * u;
  g.moveTo(0, s * 0.35);
  g.bezierCurveTo(-s, -s * 0.4, -s * 0.4, -s * 1.2, 0, -s * 0.5);
  g.bezierCurveTo(s * 0.4, -s * 1.2, s, -s * 0.4, 0, s * 0.35);
  g.stroke();
  g.font = `${13 * u}px Caveat, cursive`;
  g.textAlign = 'center';
  g.fillText('T + K', 0, -s * 0.3);
  g.restore();

  // Smiley, left edge.
  g.save();
  g.translate(W * 0.13, H * 0.3);
  g.beginPath();
  g.arc(0, 0, 13 * u, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 2 * u, 7 * u, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  g.fillRect(-5 * u, -5 * u, 2.5 * u, 3 * u);
  g.fillRect(3 * u, -5 * u, 2.5 * u, 3 * u);
  g.restore();

  // Handwritten scribble, right side.
  g.save();
  g.translate(W * 0.86, H * 0.66);
  g.rotate(-Math.PI / 2 + 0.05);
  g.font = `${17 * u}px Caveat, cursive`;
  g.textAlign = 'center';
  g.fillText('no flicking in class!!', 0, 0);
  g.restore();

  // Random pen jabs.
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.arc(rand() * W, rand() * H, (0.8 + rand() * 1.4) * u, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
