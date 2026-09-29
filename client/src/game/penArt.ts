import { PEN, type PenSkin } from '@biro/shared';

/*
 * A Bic-Cristal-style biro drawn with gradients in pen-local world units.
 * x runs along the pen: tip at -length/2, posted cap at +length/2.
 * `light` (-1..1) says which side of the barrel faces the lamp so the
 * highlights stay put as the pen spins, which sells the 3D look.
 */

const H = PEN.length / 2; // 0.75
const R = PEN.radius; // 0.085

const TIP_X = -H;
const CONE_X = -H + 0.04;
const BARREL_X = -H + 0.15;
const CAP_X = H - 0.36;
const END_X = H + 0.01;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, amt: number, alpha = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgba(${f(r)},${f(g)},${f(b)},${alpha})`;
}

/** Outline of the whole pen, used for shadows and hit glow. */
export function penPath(ctx: CanvasRenderingContext2D, grow = 0) {
  const r = R + grow;
  ctx.beginPath();
  ctx.moveTo(TIP_X - grow, 0);
  ctx.lineTo(CONE_X, -0.03 - grow);
  ctx.lineTo(BARREL_X, -r);
  ctx.lineTo(CAP_X, -r);
  ctx.lineTo(CAP_X, -r - 0.013);
  ctx.lineTo(END_X - r, -r - 0.013);
  ctx.arc(END_X - r, 0, r + 0.013, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(CAP_X, r + 0.013);
  ctx.lineTo(CAP_X, r);
  ctx.lineTo(BARREL_X, r);
  ctx.lineTo(CONE_X, 0.03 + grow);
  ctx.closePath();
}

/**
 * Draw a soft drop shadow for a pen. Canvas shadow offsets ignore the transform,
 * so the shadow always falls toward the bottom-right of the screen no matter how
 * the pen or table is rotated: one fixed lamp, like a real room.
 */
export function drawPenShadow(ctx: CanvasRenderingContext2D, offX: number, offY: number, blur: number, alpha: number) {
  const m = ctx.getTransform();
  const FAR = 10000;
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e - FAR, m.f);
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = FAR + offX;
  ctx.shadowOffsetY = offY;
  ctx.fillStyle = '#000';
  penPath(ctx);
  ctx.fill();
  ctx.restore();
}

/** Gradient across the barrel width with three hexagonal facets. */
function facetGradient(ctx: CanvasRenderingContext2D, hw: number, light: number, lit: string, mid: string, dark: string) {
  const g = ctx.createLinearGradient(0, -hw, 0, hw);
  const top = light < 0 ? lit : dark; // facet on the -y side
  const bottom = light < 0 ? dark : lit;
  g.addColorStop(0, top);
  g.addColorStop(0.3, top);
  g.addColorStop(0.31, mid);
  g.addColorStop(0.69, mid);
  g.addColorStop(0.7, bottom);
  g.addColorStop(1, bottom);
  return g;
}

function roundGradient(ctx: CanvasRenderingContext2D, hw: number, light: number, color: string) {
  const g = ctx.createLinearGradient(0, -hw, 0, hw);
  const hl = 0.5 - light * 0.28;
  g.addColorStop(0, shade(color, -0.55));
  g.addColorStop(Math.max(0.05, hl - 0.25), shade(color, -0.05));
  g.addColorStop(hl, shade(color, 0.45));
  g.addColorStop(Math.min(0.95, hl + 0.22), color);
  g.addColorStop(1, shade(color, -0.6));
  return g;
}

export function drawPen(ctx: CanvasRenderingContext2D, skin: PenSkin, light: number) {
  const L = Math.max(-1, Math.min(1, light));
  const bw = BARREL_X;
  const bLen = CAP_X + 0.02 - bw;

  // --- Metal tip + ball --------------------------------------------------
  const tip = ctx.createLinearGradient(0, -0.03, 0, 0.03);
  tip.addColorStop(0, '#5d636b');
  tip.addColorStop(0.45 - L * 0.2, '#f4f6f8');
  tip.addColorStop(1, '#4a4f56');
  ctx.fillStyle = tip;
  ctx.beginPath();
  ctx.moveTo(TIP_X + 0.012, -0.011);
  ctx.lineTo(CONE_X, -0.03);
  ctx.lineTo(CONE_X, 0.03);
  ctx.lineTo(TIP_X + 0.012, 0.011);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2b2e33';
  ctx.beginPath();
  ctx.arc(TIP_X + 0.012, 0, 0.012, 0, Math.PI * 2);
  ctx.fill();

  // --- Front cone (plastic) --------------------------------------------------
  const coneColor = skin.barrel === 'clear' ? shade(skin.barrelColor, 0, 0.75) : skin.barrel === 'metal' ? skin.barrelColor : shade(skin.barrelColor, -0.1);
  ctx.fillStyle = roundGradient(ctx, R, L, skin.barrel === 'clear' ? '#c9d3de' : coneColor);
  ctx.globalAlpha = skin.barrel === 'clear' ? 0.8 : 1;
  ctx.beginPath();
  ctx.moveTo(CONE_X, -0.03);
  ctx.lineTo(bw, -R * 0.92);
  ctx.lineTo(bw, R * 0.92);
  ctx.lineTo(CONE_X, 0.03);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // --- Barrel ------------------------------------------------------------
  if (skin.barrel === 'clear') {
    // Translucent tint, visible ink tube, glassy facets.
    ctx.fillStyle = shade(skin.barrelColor, -0.1, 0.45);
    ctx.fillRect(bw, -R, bLen, R * 2);

    // Ink tube: filled with ink toward the tip, empty toward the cap.
    const tubeHW = R * 0.26;
    const inkEnd = 0.2;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(CONE_X + 0.02, -tubeHW, CAP_X - CONE_X - 0.02, tubeHW * 2);
    const ink = ctx.createLinearGradient(0, -tubeHW, 0, tubeHW);
    ink.addColorStop(0, shade(skin.inkColor, -0.3));
    ink.addColorStop(0.45, shade(skin.inkColor, 0.25));
    ink.addColorStop(1, shade(skin.inkColor, -0.45));
    ctx.fillStyle = ink;
    ctx.fillRect(CONE_X + 0.02, -tubeHW, inkEnd - CONE_X - 0.02, tubeHW * 2);
    // Meniscus
    ctx.fillStyle = shade(skin.inkColor, 0.4, 0.9);
    ctx.fillRect(inkEnd - 0.006, -tubeHW, 0.012, tubeHW * 2);

    ctx.fillStyle = facetGradient(ctx, R, L, 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.12)', 'rgba(40,55,75,0.28)');
    ctx.fillRect(bw, -R, bLen, R * 2);
  } else if (skin.barrel === 'metal') {
    const g = ctx.createLinearGradient(0, -R, 0, R);
    const c = skin.barrelColor;
    const flip = L < 0 ? 0 : 1;
    const stops: [number, string][] = [
      [0, shade(c, -0.6)],
      [0.18, shade(c, 0.75)],
      [0.32, shade(c, -0.15)],
      [0.5, shade(c, 0.2)],
      [0.66, shade(c, -0.35)],
      [0.84, shade(c, 0.5)],
      [1, shade(c, -0.65)],
    ];
    for (const [o, col] of stops) g.addColorStop(flip ? 1 - o : o, col);
    ctx.fillStyle = g;
    ctx.fillRect(bw, -R, bLen, R * 2);
    // Knurled grip rings
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = bw + 0.03; x < bw + 0.2; x += 0.022) ctx.fillRect(x, -R, 0.008, R * 2);
  } else {
    ctx.fillStyle = facetGradient(ctx, R, L, shade(skin.barrelColor, 0.35), skin.barrelColor, shade(skin.barrelColor, -0.35));
    ctx.fillRect(bw, -R, bLen, R * 2);
  }

  // Specular streak along the lit facet.
  const sy = -L * R * 0.55;
  const streak = ctx.createLinearGradient(bw, 0, CAP_X, 0);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.15, `rgba(255,255,255,${skin.barrel === 'solid' ? 0.45 : 0.8})`);
  streak.addColorStop(0.8, `rgba(255,255,255,${skin.barrel === 'solid' ? 0.3 : 0.6})`);
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(bw + 0.02, sy - R * 0.08, bLen - 0.04, R * 0.16);

  // Barrel edge lines.
  ctx.strokeStyle = skin.barrel === 'clear' ? 'rgba(30,40,55,0.45)' : 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.008;
  ctx.beginPath();
  ctx.moveTo(bw, -R + 0.004);
  ctx.lineTo(CAP_X, -R + 0.004);
  ctx.moveTo(bw, R - 0.004);
  ctx.lineTo(CAP_X, R - 0.004);
  ctx.stroke();

  // --- Posted cap ------------------------------------------------------------
  const cr = R + 0.013;
  ctx.fillStyle = roundGradient(ctx, cr, L, skin.capColor);
  ctx.beginPath();
  ctx.moveTo(CAP_X, -cr);
  ctx.lineTo(END_X - cr, -cr);
  ctx.arc(END_X - cr, 0, cr, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(CAP_X, cr);
  ctx.closePath();
  ctx.fill();
  // Cap rim
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(CAP_X, -cr, 0.012, cr * 2);

  // Pocket clip (sits on top, casts its own tiny shadow).
  const clipY = -0.004;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(ctx, CAP_X + 0.06, clipY - 0.012, END_X - CAP_X - 0.1, 0.04, 0.02);
  ctx.fill();
  const clip = ctx.createLinearGradient(0, clipY - 0.02, 0, clipY + 0.02);
  clip.addColorStop(0, shade(skin.capColor, 0.55));
  clip.addColorStop(0.5, shade(skin.capColor, 0.2));
  clip.addColorStop(1, shade(skin.capColor, -0.3));
  ctx.fillStyle = clip;
  roundRect(ctx, CAP_X + 0.05, clipY - 0.018, END_X - CAP_X - 0.1, 0.036, 0.018);
  ctx.fill();
  // Vent hole
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(END_X - 0.03, 0, 0.011, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** Render a pen into a standalone canvas (menus, skin picker). */
export function renderPenPreview(canvas: HTMLCanvasElement, skin: PenSkin, cssW: number, cssH: number, angle = 0) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const span = Math.abs(Math.cos(angle)) * (PEN.length + 0.1) + Math.abs(Math.sin(angle)) * 0.3;
  const spanY = Math.abs(Math.sin(angle)) * (PEN.length + 0.1) + Math.abs(Math.cos(angle)) * 0.3;
  const s = Math.min((cssW * 0.86) / span, (cssH * 0.8) / spanY) * dpr;
  const c = Math.cos(angle) * s;
  const si = Math.sin(angle) * s;
  ctx.setTransform(c, si, -si, c, (canvas.width / 2) * 0.98, (canvas.height / 2) * 0.96);
  drawPenShadow(ctx, 0.05 * s, 0.07 * s, 0.05 * s, 0.35);
  drawPen(ctx, skin, -0.6);
}
