import { Body, Box, Circle, Contact, Vec2, World } from 'planck';
import { PEN, PHYS, TABLE } from './config';
import type { Flick, Pose, ShotResult } from './types';

export type SimEvent =
  | {
      type: 'hit';
      /** Pen indices; the normal points from a to b. */
      a: number;
      b: number;
      x: number;
      y: number;
      nx: number;
      ny: number;
      /** Closing speed along the normal (world units/s). */
      strength: number;
    }
  | {
      type: 'out';
      pen: number;
      pose: Pose;
      vx: number;
      vy: number;
      w: number;
    };

const HIT_DEBOUNCE = 0.06;

export function isOnTable(x: number, y: number): boolean {
  return x >= 0 && x <= TABLE.w && y >= 0 && y <= TABLE.h;
}

/** Distance from a point to the nearest table edge (negative when off the table). */
export function edgeDistance(x: number, y: number): number {
  return Math.min(x, TABLE.w - x, y, TABLE.h - y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Top-down pen physics. A thin wrapper over a planck.js (Box2D) world with:
 * - no gravity (we look down at the table)
 * - table friction applied manually as constant deceleration
 * - pens that fall off when their centre of mass leaves the table
 *
 * The same sequence of calls always produces the same result, which is what lets the
 * AI plan shots, the aim guide predict them, and the server referee online games.
 */
export class Sim {
  readonly world: World;
  readonly bodies: (Body | null)[] = [];
  readonly out: boolean[] = [];
  time = 0;
  steps = 0;
  contact = false;

  private pending: SimEvent[] = [];
  private lastHit = new Map<string, number>();

  constructor(poses: readonly (Pose | null)[]) {
    this.world = new World({ gravity: Vec2(0, 0) });

    const half = PEN.length / 2 - PEN.radius;
    const fixture = {
      density: PHYS.density,
      friction: PHYS.penFriction,
      restitution: PHYS.restitution,
    };

    poses.forEach((p, i) => {
      if (!p) {
        this.bodies.push(null);
        this.out.push(true);
        return;
      }
      const body = this.world.createBody({
        type: 'dynamic',
        position: Vec2(p.x, p.y),
        angle: p.a,
        linearDamping: PHYS.linearDamping,
        angularDamping: PHYS.angularDamping,
        bullet: true,
        allowSleep: false,
      });
      // Capsule: a box with a round cap on each end.
      body.createFixture(new Box(half, PEN.radius), fixture);
      body.createFixture(new Circle(Vec2(-half, 0), PEN.radius), fixture);
      body.createFixture(new Circle(Vec2(half, 0), PEN.radius), fixture);
      body.setUserData(i);
      this.bodies.push(body);
      this.out.push(false);
    });

    this.world.on('begin-contact', (c) => this.onContact(c));
  }

  private onContact(c: Contact) {
    const bodyA = c.getFixtureA().getBody();
    const bodyB = c.getFixtureB().getBody();
    if (bodyA === bodyB) return;
    const a = bodyA.getUserData() as number;
    const b = bodyB.getUserData() as number;

    // Each pen is three fixtures, so one collision can fire several begin-contacts.
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const last = this.lastHit.get(key);
    this.contact = true;
    if (last !== undefined && this.time - last < HIT_DEBOUNCE) return;
    this.lastHit.set(key, this.time);

    const wm = c.getWorldManifold(null);
    const pa = bodyA.getPosition();
    const pb = bodyB.getPosition();
    const point = wm && wm.pointCount > 0 ? wm.points[0] : Vec2((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    const nx = wm ? wm.normal.x : 0;
    const ny = wm ? wm.normal.y : 0;
    const va = bodyA.getLinearVelocityFromWorldPoint(point);
    const vb = bodyB.getLinearVelocityFromWorldPoint(point);
    const strength = Math.abs((va.x - vb.x) * nx + (va.y - vb.y) * ny);

    this.pending.push({ type: 'hit', a, b, x: point.x, y: point.y, nx, ny, strength });
  }

  /** Launch a pen. Spin is predictable: grab offset x perpendicularity x power. */
  applyFlick(pen: number, flick: Flick) {
    const body = this.bodies[pen];
    if (!body) return;
    const len = Math.hypot(flick.dx, flick.dy) || 1;
    const dx = flick.dx / len;
    const dy = flick.dy / len;
    const power = clamp(flick.power, 0, 1);
    const speed = PHYS.maxSpeed * power;
    body.setLinearVelocity(Vec2(dx * speed, dy * speed));

    const angle = body.getAngle();
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const ratio = clamp(flick.gx / (PEN.length / 2), -1, 1);
    // Cross product of pen axis and direction: 0 when flicked along the pen, +-1 when perpendicular.
    const cross = ax * dy - ay * dx;
    body.setAngularVelocity(ratio * cross * power * PHYS.maxSpin);
  }

  step(): SimEvent[] {
    const dt = PHYS.dt;

    for (const body of this.bodies) {
      if (!body) continue;
      const v = body.getLinearVelocity();
      const s = Math.hypot(v.x, v.y);
      if (s > 0) {
        const ns = Math.max(0, s - PHYS.slideDecel * dt);
        const k = ns < PHYS.restSpeed * 0.5 ? 0 : ns / s;
        body.setLinearVelocity(Vec2(v.x * k, v.y * k));
      }
      const w = body.getAngularVelocity();
      if (w !== 0) {
        const nw = Math.max(0, Math.abs(w) - PHYS.spinDecel * dt);
        body.setAngularVelocity(nw < PHYS.restSpin * 0.5 ? 0 : Math.sign(w) * nw);
      }
    }

    this.world.step(dt, PHYS.velIters, PHYS.posIters);
    this.time += dt;
    this.steps++;

    this.bodies.forEach((body, i) => {
      if (!body) return;
      const p = body.getPosition();
      if (isOnTable(p.x, p.y)) return;
      const v = body.getLinearVelocity();
      this.pending.push({
        type: 'out',
        pen: i,
        pose: { x: p.x, y: p.y, a: body.getAngle() },
        vx: v.x,
        vy: v.y,
        w: body.getAngularVelocity(),
      });
      this.world.destroyBody(body);
      this.bodies[i] = null;
      this.out[i] = true;
    });

    const events = this.pending;
    this.pending = [];
    return events;
  }

  settled(): boolean {
    if (this.time >= PHYS.maxShotTime) return true;
    for (const body of this.bodies) {
      if (!body) continue;
      const v = body.getLinearVelocity();
      if (Math.hypot(v.x, v.y) > PHYS.restSpeed) return false;
      if (Math.abs(body.getAngularVelocity()) > PHYS.restSpin) return false;
    }
    return true;
  }

  pose(i: number): Pose | null {
    const body = this.bodies[i];
    if (!body) return null;
    const p = body.getPosition();
    return { x: p.x, y: p.y, a: body.getAngle() };
  }

  poses(): (Pose | null)[] {
    return this.bodies.map((_, i) => this.pose(i));
  }

  speed(i: number): number {
    const body = this.bodies[i];
    if (!body) return 0;
    const v = body.getLinearVelocity();
    return Math.hypot(v.x, v.y);
  }
}

/** Run a whole shot to completion without rendering. */
export function simulateShot(poses: readonly (Pose | null)[], shooter: number, flick: Flick): ShotResult {
  const sim = new Sim(poses);
  sim.applyFlick(shooter, flick);
  while (!sim.settled()) sim.step();
  return { final: sim.poses(), out: [...sim.out], contact: sim.contact, steps: sim.steps };
}

export interface ShotPreview {
  /** Path of the shooter's centre, sampled every couple of steps. */
  path: { x: number; y: number }[];
  /** First contact with another pen, if the guide reaches it. */
  hit: {
    x: number;
    y: number;
    /** Direction the struck pen gets pushed. */
    pushX: number;
    pushY: number;
    target: number;
    /** Shooter pose at the moment of contact. */
    shooter: Pose;
  } | null;
  /** Shooter pose where the guide ends. */
  end: Pose | null;
  /** The shooter would fall off the table (only known if the guide reaches that far). */
  endsOut: boolean;
  /** The guide stopped before the shot finished. */
  truncated: boolean;
}

/** Predict the first part of a shot, up to the first collision or `maxLen` of travel. */
export function previewShot(
  poses: readonly (Pose | null)[],
  shooter: number,
  flick: Flick,
  maxLen: number,
): ShotPreview {
  const sim = new Sim(poses);
  sim.applyFlick(shooter, flick);
  const start = sim.pose(shooter);
  const preview: ShotPreview = { path: [], hit: null, end: start, endsOut: false, truncated: false };
  if (!start) return preview;
  preview.path.push({ x: start.x, y: start.y });

  let len = 0;
  let last = start;
  while (!sim.settled()) {
    const events = sim.step();
    const out = events.find((e) => e.type === 'out' && e.pen === shooter);
    if (out && out.type === 'out') {
      preview.path.push({ x: out.pose.x, y: out.pose.y });
      preview.end = out.pose;
      preview.endsOut = true;
      return preview;
    }
    const cur = sim.pose(shooter)!;
    len += Math.hypot(cur.x - last.x, cur.y - last.y);
    last = cur;
    if (sim.steps % 2 === 0) preview.path.push({ x: cur.x, y: cur.y });

    const hit = events.find((e) => e.type === 'hit' && (e.a === shooter || e.b === shooter));
    if (hit && hit.type === 'hit') {
      const sign = hit.a === shooter ? 1 : -1;
      preview.path.push({ x: cur.x, y: cur.y });
      preview.hit = {
        x: hit.x,
        y: hit.y,
        pushX: hit.nx * sign,
        pushY: hit.ny * sign,
        target: hit.a === shooter ? hit.b : hit.a,
        shooter: cur,
      };
      preview.end = cur;
      preview.truncated = true;
      return preview;
    }
    if (len >= maxLen) {
      preview.path.push({ x: cur.x, y: cur.y });
      preview.end = cur;
      preview.truncated = true;
      return preview;
    }
  }
  preview.end = last;
  preview.path.push({ x: last.x, y: last.y });
  return preview;
}
