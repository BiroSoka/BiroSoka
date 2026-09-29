import { TABLE } from '@biro/shared';

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Maps world units (the table) to CSS pixels.
 * The table is portrait in world space; in landscape windows it is rotated a
 * quarter turn so it fills the screen, and it is flipped 180deg for seat 1 so
 * each player always sees their own pen nearest to them.
 */
export class View {
  cssW = 1;
  cssH = 1;
  dpr = 1;
  /** CSS px per world unit. */
  scale = 1;
  /** Quarter turns applied to the world. */
  quarter = 0;
  cx = 0;
  cy = 0;
  cos = 1;
  sin = 0;
  /** Extra screen-space offset (camera shake). */
  shakeX = 0;
  shakeY = 0;

  /** Margin around the table in world units, room for the rim and falling pens. */
  static MARGIN = 0.42;

  update(cssW: number, cssH: number, dpr: number, flipped: boolean, insets: Insets) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const landscape = cssW > cssH * 1.08;
    this.quarter = (landscape ? 1 : 0) + (flipped ? 2 : 0);
    this.cos = [1, 0, -1, 0][this.quarter];
    this.sin = [0, 1, 0, -1][this.quarter];

    const m = View.MARGIN;
    const worldW = (landscape ? TABLE.h : TABLE.w) + m * 2;
    const worldH = (landscape ? TABLE.w : TABLE.h) + m * 2 + 0.2; // + front rim
    const availW = Math.max(50, cssW - insets.left - insets.right);
    const availH = Math.max(50, cssH - insets.top - insets.bottom);
    this.scale = Math.min(availW / worldW, availH / worldH);
    this.cx = insets.left + availW / 2;
    this.cy = insets.top + availH / 2 - 0.1 * this.scale;
  }

  toScreen(x: number, y: number) {
    const dx = x - TABLE.w / 2;
    const dy = y - TABLE.h / 2;
    return {
      x: this.cx + this.shakeX + this.scale * (this.cos * dx - this.sin * dy),
      y: this.cy + this.shakeY + this.scale * (this.sin * dx + this.cos * dy),
    };
  }

  toWorld(sx: number, sy: number) {
    const dx = (sx - this.cx - this.shakeX) / this.scale;
    const dy = (sy - this.cy - this.shakeY) / this.scale;
    return {
      x: TABLE.w / 2 + this.cos * dx + this.sin * dy,
      y: TABLE.h / 2 - this.sin * dx + this.cos * dy,
    };
  }

  /** Rotate a screen-space direction into world space. */
  dirToWorld(x: number, y: number) {
    return { x: this.cos * x + this.sin * y, y: -this.sin * x + this.cos * y };
  }

  /** Set ctx so that drawing uses world units. */
  applyWorld(ctx: CanvasRenderingContext2D) {
    const s = this.scale * this.dpr;
    const o = this.toScreen(0, 0);
    ctx.setTransform(s * this.cos, s * this.sin, -s * this.sin, s * this.cos, o.x * this.dpr, o.y * this.dpr);
  }

  /** Set ctx so that drawing uses CSS pixels. */
  applyScreen(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** The table's on-screen rectangle (always axis-aligned). */
  tableRect() {
    const a = this.toScreen(0, 0);
    const b = this.toScreen(TABLE.w, TABLE.h);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }
}
