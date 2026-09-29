import { getSkin, INPUT, PEN, TABLE, type PenSkin, type Pose, type ShotPreview, type TableThemeId } from '@biro/shared';
import { drawPen, drawPenShadow, penPath } from './penArt';
import { paintTable, RIM_COLORS } from './tableArt';
import { View, type Insets } from './view';

export interface PenSprite {
  pose: Pose;
  skin: PenSkin;
  /** 0 = resting on the desk, 1 = held up high (placing animation). */
  lift: number;
  alpha: number;
  /** Pulsing ring showing whose turn it is. */
  glow: 'mine' | 'theirs' | null;
}

export interface AimVisual {
  grab: { x: number; y: number };
  pull: { x: number; y: number };
  power: number;
  /** Launch-angle uncertainty (1 standard deviation, radians); 0 = the aim is exact. */
  spread: number;
  preview: ShotPreview | null;
  /** Show the percentage label (the human's own aim). */
  label: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  t: number;
  max: number;
  size: number;
}

interface Faller {
  pose: Pose;
  vx: number;
  vy: number;
  w: number;
  t: number;
  skin: PenSkin;
}

const FALL_TIME = 0.6;
/** Screen-space light direction (toward the lamp): up and to the left. */
const LIGHT = { x: -0.45, y: -0.89 };

export class Renderer {
  readonly view = new View();
  private ctx: CanvasRenderingContext2D;
  private theme: TableThemeId = 'oak';
  private tableTex: HTMLCanvasElement | null = null;
  private texPpu = 0;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private fallers: Faller[] = [];
  private shake = 0;
  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setTheme(theme: TableThemeId) {
    if (theme === this.theme && this.tableTex) return;
    this.theme = theme;
    this.tableTex = null;
  }

  /** Fonts load asynchronously; repaint the desk doodles once they're ready. */
  invalidateTable() {
    this.tableTex = null;
  }

  resize(cssW: number, cssH: number, flipped: boolean, insets: Insets) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.view.update(cssW, cssH, dpr, flipped, insets);
    const ppu = Math.min(260, Math.ceil(this.view.scale * dpr));
    if (Math.abs(ppu - this.texPpu) > 12) this.tableTex = null;
  }

  // ---- effects ------------------------------------------------------------

  hit(x: number, y: number, strength: number) {
    const k = Math.min(1, strength / 9);
    const n = 4 + Math.round(k * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.5 * (0.4 + k);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.25 + Math.random() * 0.3,
        size: 0.02 + Math.random() * 0.025,
        color: Math.random() < 0.7 ? '255,255,255' : '255,220,140',
      });
    }
    this.rings.push({ x, y, t: 0, max: 0.35, size: 0.25 + k * 0.5 });
    this.shake = Math.max(this.shake, k * 7);
  }

  fall(pose: Pose, vx: number, vy: number, w: number, skin: PenSkin) {
    this.fallers.push({ pose: { ...pose }, vx, vy, w, t: 0, skin });
    this.shake = Math.max(this.shake, 3);
  }

  puff(x: number, y: number) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.particles.push({
        x: x + Math.cos(a) * 0.3,
        y: y + Math.sin(a) * 0.1,
        vx: Math.cos(a) * 0.9,
        vy: Math.sin(a) * 0.9,
        life: 0,
        max: 0.4,
        size: 0.04,
        color: '255,245,225',
      });
    }
  }

  // ---- frame --------------------------------------------------------------

  render(dt: number, pens: PenSprite[], aim: AimVisual | null) {
    this.time += dt;
    const { ctx, view } = this;
    this.updateFx(dt);

    this.shake *= Math.pow(0.02, dt);
    view.shakeX = (Math.random() - 0.5) * this.shake;
    view.shakeY = (Math.random() - 0.5) * this.shake;

    view.applyScreen(ctx);
    ctx.clearRect(0, 0, view.cssW, view.cssH);

    this.drawTableBody();
    for (const f of this.fallers) if (f.t > 0.1) this.drawFaller(f);

    view.applyWorld(ctx);
    this.drawSurface();
    for (const p of pens) if (p.glow) this.drawGlow(p);
    if (aim) this.drawGuide(aim);
    for (const p of pens) this.drawSprite(p);
    this.drawFx();
    if (aim) this.drawPull(aim);

    for (const f of this.fallers) if (f.t <= 0.1) this.drawFaller(f);

    if (aim && aim.label) this.drawPowerLabel(aim);
  }

  private updateFx(dt: number) {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.max);
    for (const f of this.fallers) {
      f.t += dt;
      f.pose.x += f.vx * dt;
      f.pose.y += f.vy * dt;
      f.pose.a += f.w * dt;
      f.vx *= 0.93;
      f.vy *= 0.93;
    }
    this.fallers = this.fallers.filter((f) => f.t < FALL_TIME);
  }

  /** Desk thickness, legs shadow: drawn in screen space so the 3D depth always faces the viewer. */
  private drawTableBody() {
    const { ctx, view } = this;
    const r = view.tableRect();
    const depth = Math.max(8, view.scale * 0.2);
    const [rimTop, rimBottom] = RIM_COLORS[this.theme];

    // Floor shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = view.scale * 0.6;
    ctx.shadowOffsetY = view.scale * 0.25;
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x + 4, r.y + 8, r.w - 8, r.h + depth - 8);
    ctx.restore();

    // Front face
    const g = ctx.createLinearGradient(0, r.y + r.h, 0, r.y + r.h + depth);
    g.addColorStop(0, rimTop);
    g.addColorStop(1, rimBottom);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h - 2);
    ctx.lineTo(r.x + r.w, r.y + r.h - 2);
    ctx.lineTo(r.x + r.w - depth * 0.15, r.y + r.h + depth);
    ctx.lineTo(r.x + depth * 0.15, r.y + r.h + depth);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(r.x, r.y + r.h, r.w, 1.5);
  }

  private drawSurface() {
    const { ctx, view } = this;
    if (!this.tableTex) {
      this.texPpu = Math.min(260, Math.ceil(view.scale * view.dpr));
      this.tableTex = paintTable(this.theme, this.texPpu);
    }
    ctx.drawImage(this.tableTex, 0, 0, TABLE.w, TABLE.h);
  }

  private lightFor(pose: Pose) {
    // Light direction in world space, then in pen-local space; we need the local y part.
    const lw = this.view.dirToWorld(LIGHT.x, LIGHT.y);
    return -Math.sin(pose.a) * lw.x + Math.cos(pose.a) * lw.y;
  }

  private penTransform(pose: Pose, scale = 1) {
    const { ctx } = this;
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    if (scale !== 1) ctx.scale(scale, scale);
  }

  private drawSprite(p: PenSprite) {
    const { ctx, view } = this;
    const px = view.scale * view.dpr; // device px per world unit
    ctx.save();
    ctx.globalAlpha = p.alpha;
    this.penTransform(p.pose, 1 + p.lift * 0.25);
    const off = 0.045 + p.lift * 0.35;
    const clear = p.skin.barrel === 'clear';
    drawPenShadow(ctx, off * 0.6 * px, off * px, (0.035 + p.lift * 0.15) * px, (clear ? 0.33 : 0.42) * (1 - p.lift * 0.5));
    drawPen(ctx, p.skin, this.lightFor(p.pose));
    ctx.restore();
  }

  private drawGlow(p: PenSprite) {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.5);
    ctx.save();
    this.penTransform(p.pose);
    const color = p.glow === 'mine' ? '255,236,120' : '170,200,255';
    ctx.strokeStyle = `rgba(${color},${0.35 + pulse * 0.4})`;
    ctx.lineWidth = 0.025 + pulse * 0.02;
    ctx.shadowColor = `rgba(${color},0.9)`;
    ctx.shadowBlur = 10;
    penPath(ctx, 0.07 + pulse * 0.03);
    ctx.stroke();
    ctx.restore();
  }

  private drawFaller(f: Faller) {
    const { ctx, view } = this;
    const k = f.t / FALL_TIME;
    const px = view.scale * view.dpr;
    view.applyWorld(ctx);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    this.penTransform(f.pose, 1 - 0.4 * k);
    drawPenShadow(ctx, (0.05 + k * 0.3) * px, (0.08 + k * 0.6) * px, (0.05 + k * 0.2) * px, 0.35 * (1 - k));
    ctx.filter = `brightness(${1 - k * 0.5})`;
    drawPen(ctx, f.skin, this.lightFor(f.pose));
    ctx.restore();
    view.applyScreen(ctx);
  }

  private drawFx() {
    const { ctx } = this;
    for (const r of this.rings) {
      const k = r.t / r.max;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      ctx.lineWidth = 0.03 * (1 - k) + 0.005;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 0.05 + r.size * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.fillStyle = `rgba(${p.color},${1 - k})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Dotted prediction line, contact marker and push arrow (8 Ball style). */
  private drawGuide(aim: AimVisual) {
    const { ctx } = this;
    const pv = aim.preview;
    if (!pv || pv.path.length < 2) return;

    // Resample the path into evenly spaced dots.
    const spacing = 0.16;
    let carry = 0;
    let total = 0;
    const dots: { x: number; y: number; d: number }[] = [];
    for (let i = 1; i < pv.path.length; i++) {
      const a = pv.path[i - 1];
      const b = pv.path[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      let t = carry;
      while (t < seg) {
        dots.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg, d: total + t });
        t += spacing;
      }
      carry = t - seg;
      total += seg;
    }
    this.drawSpread(aim, pv.path[0], total);
    const danger = pv.endsOut;
    for (const d of dots) {
      if (d.d < 0.35) continue;
      const fade = pv.truncated && !pv.hit ? Math.max(0, 1 - d.d / total) * 0.9 + 0.1 : 0.9;
      const col = danger && d.d > total - 0.8 ? '255,90,90' : '255,255,255';
      ctx.fillStyle = `rgba(${col},${fade})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.035, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pv.hit) {
      const h = pv.hit;
      // Ghost of the shooter at contact.
      ctx.save();
      this.penTransform(h.shooter);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.018;
      ctx.setLineDash([0.05, 0.04]);
      penPath(ctx);
      ctx.stroke();
      ctx.restore();
      // Push arrow on the struck pen.
      const len = 0.5 + aim.power * 0.9;
      const ex = h.x + h.pushX * len;
      const ey = h.y + h.pushY * len;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 0.035;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const ang = Math.atan2(h.pushY, h.pushX);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * 0.12, ey + Math.sin(ang) * 0.12);
      ctx.lineTo(ex + Math.cos(ang + 2.4) * 0.12, ey + Math.sin(ang + 2.4) * 0.12);
      ctx.lineTo(ex + Math.cos(ang - 2.4) * 0.12, ey + Math.sin(ang - 2.4) * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 0.09, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pv.end && !pv.truncated) {
      ctx.save();
      this.penTransform(pv.end);
      ctx.strokeStyle = danger ? 'rgba(255,90,90,0.85)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.018;
      ctx.setLineDash([0.05, 0.04]);
      penPath(ctx);
      ctx.stroke();
      ctx.restore();
    }

    if (danger && pv.end) {
      const e = pv.end;
      ctx.strokeStyle = 'rgba(255,90,90,0.95)';
      ctx.lineWidth = 0.04;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(e.x - 0.1, e.y - 0.1);
      ctx.lineTo(e.x + 0.1, e.y + 0.1);
      ctx.moveTo(e.x + 0.1, e.y - 0.1);
      ctx.lineTo(e.x - 0.1, e.y + 0.1);
      ctx.stroke();
    }
  }

  /** High-power shots wobble: show the cone the pen may really leave in (about 2 in 3 shots land inside it). */
  private drawSpread(aim: AimVisual, origin: { x: number; y: number }, pathLen: number) {
    if (aim.spread < 0.02) return;
    const { ctx } = this;
    const vx = aim.grab.x - aim.pull.x;
    const vy = aim.grab.y - aim.pull.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-4) return;
    const base = Math.atan2(vy, vx);
    const reach = Math.max(2.2, Math.min(7, pathLen));
    const a0 = base - aim.spread;
    const a1 = base + aim.spread;
    const grad = ctx.createRadialGradient(origin.x, origin.y, 0.2, origin.x, origin.y, reach);
    grad.addColorStop(0, 'rgba(255,190,90,0.34)');
    grad.addColorStop(1, 'rgba(255,120,60,0.06)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.arc(origin.x, origin.y, reach, a0, a1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,80,0.55)';
    ctx.lineWidth = 0.02;
    ctx.setLineDash([0.08, 0.06]);
    ctx.beginPath();
    ctx.moveTo(origin.x + Math.cos(a0) * 0.3, origin.y + Math.sin(a0) * 0.3);
    ctx.lineTo(origin.x + Math.cos(a0) * reach, origin.y + Math.sin(a0) * reach);
    ctx.moveTo(origin.x + Math.cos(a1) * 0.3, origin.y + Math.sin(a1) * 0.3);
    ctx.lineTo(origin.x + Math.cos(a1) * reach, origin.y + Math.sin(a1) * reach);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Rubber band from the grab point back to the finger, plus the power arc. */
  private drawPull(aim: AimVisual) {
    const { ctx } = this;
    const { grab, pull, power } = aim;
    const hue = 120 - power * 120; // green -> red
    const color = `hsl(${hue},90%,58%)`;

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(grab.x, grab.y);
    ctx.lineTo(pull.x, pull.y);
    ctx.stroke();
    const band = ctx.createLinearGradient(grab.x, grab.y, pull.x, pull.y);
    band.addColorStop(0, 'rgba(255,255,255,0.95)');
    band.addColorStop(1, color);
    ctx.strokeStyle = band;
    ctx.lineWidth = 0.055;
    ctx.beginPath();
    ctx.moveTo(grab.x, grab.y);
    ctx.lineTo(pull.x, pull.y);
    ctx.stroke();

    // Finger knob
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.arc(pull.x, pull.y, 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Power arc around the finger knob.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(pull.x, pull.y, 0.24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(pull.x, pull.y, 0.24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * power);
    ctx.stroke();

    // Grab point marker on the pen.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(grab.x, grab.y, 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPowerLabel(aim: AimVisual) {
    const { ctx, view } = this;
    view.applyScreen(ctx);
    const s = view.toScreen(aim.pull.x, aim.pull.y);
    const text = `${Math.round(aim.power * 100)}%`;
    ctx.font = '800 15px "Baloo 2", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = s.y - view.scale * 0.24 - 16;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(text, s.x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, s.x, y);
    if (aim.spread > 0.02) {
      ctx.font = '800 11px "Baloo 2", system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeText('shaky aim', s.x, y - 15);
      ctx.fillStyle = '#ffc266';
      ctx.fillText('shaky aim', s.x, y - 15);
    }
  }
}

export function spriteFor(pose: Pose, skinId: string): PenSprite {
  return { pose, skin: getSkin(skinId), lift: 0, alpha: 1, glow: null };
}

/** Distance from a world point to a pen (0 if on it), plus the grab offset along the pen. */
export function grabInfo(pose: Pose, x: number, y: number) {
  const dx = x - pose.x;
  const dy = y - pose.y;
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const half = PEN.length / 2;
  const along = Math.max(-half, Math.min(half, lx));
  const dist = Math.max(0, Math.hypot(lx - along, ly) - PEN.radius);
  const limit = half - INPUT.grabInset;
  const gx = Math.max(-limit, Math.min(limit, lx));
  return { dist, gx, point: { x: pose.x + c * gx, y: pose.y + s * gx } };
}
