// All gameplay tuning lives here so client, server and AI always agree.
// World units are roughly decimetres: the pen is 15cm, the desk 52cm x 84cm.

export const TABLE = {
  w: 5.2,
  h: 8.4,
} as const;

export const PEN = {
  length: 1.5,
  radius: 0.085,
} as const;

export const PHYS = {
  /** Fixed timestep. Every simulation (live, server, AI, preview) uses the same one. */
  dt: 1 / 120,
  velIters: 8,
  posIters: 3,

  density: 1,
  /** Pen-on-pen friction (plastic on plastic). */
  penFriction: 0.22,
  /** Pen-on-pen bounciness. */
  restitution: 0.55,

  /** Table friction: constant (Coulomb) deceleration so pens stop decisively. */
  slideDecel: 4.6,
  spinDecel: 13,
  /** Small velocity-proportional drag on top of the table friction. */
  linearDamping: 0.22,
  angularDamping: 0.5,

  /** Launch speed at 100% power. */
  maxSpeed: 11.5,
  /** Spin at 100% power, grabbed at the very tip, flicked perpendicular to the pen. */
  maxSpin: 15,

  restSpeed: 0.02,
  restSpin: 0.05,
  /** Safety cap on a single shot. */
  maxShotTime: 9,
} as const;

export const INPUT = {
  /** Pull-back distance (world units) that gives 100% power. */
  maxDrag: 2.1,
  /** Below this power a release is treated as a cancel. */
  minPower: 0.06,
  /** How far outside the pen (world units) a touch still grabs it. */
  grabSlop: 0.42,
  /** Grab point is clamped this far inside the pen ends. */
  grabInset: 0.06,
} as const;

/** How far the aim guide projects the shot. */
export const GUIDE = {
  short: 3.2,
  long: 40,
} as const;

export const TARGET_SCORES = [3, 5, 7, 10] as const;
export const DEFAULT_TARGET = 5;

/**
 * Power costs accuracy (like a golf drive). Below `startPower` shots are exactly as aimed,
 * so ordinary play is unchanged. Above it the launch direction wobbles by a random angle,
 * growing to `sigma` radians (1 standard deviation) at full power. This is what keeps a
 * dead-straight full-power "ace" possible but rare.
 */
export const ACCURACY = {
  startPower: 0.75,
  sigma: 0.32,
  /** The wobble is never worse than this many standard deviations. */
  maxDeviations: 1.8,
} as const;

/** How much the pens' starting angles vary around "lying across the desk" (radians). */
export const START = {
  angleJitter: 1.0,
} as const;
