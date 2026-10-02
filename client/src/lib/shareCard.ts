import { getSkin, type TableThemeId } from '@biro/shared';
import { renderPenPreview } from '../game/penArt';
import { paintTable } from '../game/tableArt';

export interface ShareCardInfo {
  /** The winner's name. */
  name: string;
  /** Big line, e.g. "I beat Desk Champ!" */
  headline: string;
  /** e.g. "5 – 2" */
  score: string;
  /** Small line, e.g. "vs Computer · Hard · first to 5" */
  detail: string;
  skinId: string;
  table: TableThemeId;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'saved' | 'saved-copied' | 'copied' | 'failed';

const SIZE = 1080;

async function loadFonts(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('64px "Permanent Marker"'), document.fonts.load('700 48px Caveat'), document.fonts.load('800 40px "Baloo 2"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

/** Turn the avatar already on screen (an inline SVG) into an image the canvas can draw. */
function svgToImage(svg: SVGElement | null): Promise<HTMLImageElement | null> {
  if (!svg) return Promise.resolve(null);
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '400');
  clone.setAttribute('height', '400');
  const xml = new XMLSerializer().serializeToString(clone);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shrink the font until the text fits the width. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxWidth: number, start: number, min = 28) {
  let px = start;
  ctx.font = font(px);
  while (ctx.measureText(text).width > maxWidth && px > min) {
    px -= 2;
    ctx.font = font(px);
  }
}

/** Draw the 1080 x 1080 win card: the winner's avatar and pen on the desk, with the result. */
export async function renderShareCard(info: ShareCardInfo, avatarSvg: SVGElement | null): Promise<Blob> {
  await loadFonts();
  const skin = getSkin(info.skinId);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // The desk, cropped square from the middle, with the edges darkened.
  const desk = paintTable(info.table, 160);
  const side = Math.min(desk.width, desk.height);
  ctx.drawImage(desk, 0, Math.round((desk.height - side) / 2), side, side, 0, 0, SIZE, SIZE);
  const vignette = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.25, SIZE / 2, SIZE / 2, SIZE * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0.05)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Game name and address.
  ctx.font = '88px "Permanent Marker", "Baloo 2", sans-serif';
  ctx.lineWidth = 16;
  ctx.strokeStyle = 'rgba(20,12,4,0.85)';
  ctx.strokeText('BIRO SOKA', SIZE / 2, 100);
  ctx.fillStyle = '#fff';
  ctx.fillText('BIRO SOKA', SIZE / 2, 100);
  ctx.font = '800 36px "Baloo 2", system-ui, sans-serif';
  ctx.lineWidth = 8;
  ctx.strokeText(window.location.host, SIZE / 2, 170);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(window.location.host, SIZE / 2, 170);

  // Winner's avatar in a ring of their pen colour, with a trophy.
  const cx = SIZE / 2;
  const cy = 365;
  const r = 140;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = skin.capColor;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const face = await svgToImage(avatarSvg);
  if (face) {
    ctx.drawImage(face, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = skin.capColor;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.font = '800 150px "Baloo 2", sans-serif';
    ctx.fillText((info.name[0] ?? '?').toUpperCase(), cx, cy + 8);
  }
  ctx.restore();
  ctx.font = '120px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.fillText('🏆', cx + r - 5, cy - r + 25);

  // Result panel.
  ctx.fillStyle = 'rgba(16,12,26,0.86)';
  roundRectPath(ctx, 70, 545, SIZE - 140, 385, 44);
  ctx.fill();
  ctx.fillStyle = '#ffe27a';
  fit(ctx, info.name, (px) => `800 ${px}px "Baloo 2", system-ui, sans-serif`, 820, 52);
  ctx.fillText(info.name, SIZE / 2, 602);
  ctx.fillStyle = '#fff';
  fit(ctx, info.headline, (px) => `${px}px "Permanent Marker", "Baloo 2", sans-serif`, 880, 74, 34);
  ctx.fillText(info.headline, SIZE / 2, 695);
  fit(ctx, info.score, (px) => `800 ${px}px "Baloo 2", system-ui, sans-serif`, 800, 150, 60);
  ctx.fillText(info.score, SIZE / 2, 818);
  ctx.fillStyle = '#c9d0ff';
  fit(ctx, info.detail, (px) => `700 ${px}px Caveat, "Baloo 2", cursive`, 860, 48, 26);
  ctx.fillText(info.detail, SIZE / 2, 898);

  // The winner's pen across the bottom of the desk.
  const pen = document.createElement('canvas');
  renderPenPreview(pen, skin, 640, 160, 0);
  ctx.save();
  ctx.translate(SIZE / 2, 1000);
  ctx.rotate(-0.05);
  ctx.drawImage(pen, -320, -80, 640, 160);
  ctx.restore();

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/jpeg', 0.9));
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Share the picture. On phones this opens the share sheet with the picture attached.
 * Where there is no share sheet (most desktop browsers) it saves the picture and copies the text instead.
 * Call it straight from a tap: browsers only allow the share sheet right after one.
 */
export async function shareResult(file: File | null, text: string): Promise<ShareOutcome> {
  const url = window.location.origin;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  try {
    if (file && nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: 'Biro Soka', text: `${text} ${url}` });
      return 'shared';
    }
    if (nav.share) {
      await nav.share({ title: 'Biro Soka', text, url });
      return 'shared';
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    /* the share sheet failed: use the fallbacks below */
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    copied = true;
  } catch {
    /* clipboard blocked */
  }
  if (file) {
    try {
      download(file);
      return copied ? 'saved-copied' : 'saved';
    } catch {
      /* ignore */
    }
  }
  return copied ? 'copied' : 'failed';
}
