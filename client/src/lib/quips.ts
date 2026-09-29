/**
 * Short trash-talk / commentary shown after each knock-off, own goal or double drop.
 * Pools depend on what happened and on who it happened to, and a few are reserved for
 * special shots (aces, meaning a knockout with the opening flick of a round, and spin knockouts).
 */
export type QuipKind = 'ko-win' | 'ko-lose' | 'own-me' | 'own-them' | 'both';

export interface QuipContext {
  /** A knockout with the opening flick of a round. */
  ace?: boolean;
  /** A knockout that used plenty of spin. */
  spin?: boolean;
}

const GENERAL: Record<QuipKind, string[]> = {
  'ko-win': [
    'Nib of steel!',
    'Desk Sensei',
    'Clean sweep!',
    'Ink-redible!',
    'Class dismissed!',
    'Flick Norris strikes again',
    'Ballpoint of no return',
    'That pen has left the building',
    'Sharpest move today',
    'Refill not included',
    'Absolutely pen-tastic',
    'Detention for that pen',
    'Off the desk, off you go!',
  ],
  'ko-lose': [
    'Your pen has left the chat',
    'Rest in pens',
    'Ouch, that pen had refills left',
    'Pen-ic at the desk!',
    'Flicked into next week',
    'You just got inked',
    'Better luck next term',
    'Caught slipping',
    'Revenge is best served flicked',
    'This is going in the group chat',
    'Ejected!',
  ],
  'own-me': [
    'Whoops, wrong desk',
    'Gravity 1, you 0',
    'Pen-ultimate mistake',
    'Too much flick, not enough think',
    'Your pen wanted freedom',
    'Slippery nib',
    'Bold strategy. It did not work.',
    'Tip: try less power',
    'That was a self-own',
    'Pen overboard!',
    'Oops, you flicked it again',
  ],
  'own-them': [
    'They flicked themselves!',
    'Self-inflicted ink stain',
    'Oh no, anyway',
    'Free point, courtesy of gravity',
    'That pen chose violence, on itself',
    'Pen down! Literally',
    'Thanks for the gift!',
    'Did they mean to do that?',
    'Gravity says thanks',
    'Sabotage by own hand',
  ],
  both: [
    'Double drop! Pens everywhere',
    'Mutual destruction',
    'Nobody wins, everyone drops',
    'Pen pile-up on the floor',
    'Two pens, zero survivors',
    'Everybody down!',
    'Chaos on the desk!',
    "It's raining pens",
  ],
};

const ACE_WIN = ['ACE! Absolute unit', 'Full power, full swagger', 'One flick to rule them all', 'Serve and... gone', 'Ace of the desk', 'That is what full power looks like'];
const ACE_LOSE = ['Aced! That one hurt', 'Ambushed by an ace', 'Full-power betrayal', 'Did you see that coming?', 'Bullet pen', 'That was personal'];
const SPIN_WIN = ['Master of Spinjutsu', 'Spin doctor in the house', 'Whirlwind flick!', 'Twist and shout... goodbye', 'Spin to win'];
const SPIN_LOSE = ['Outspun!', 'Twisted into oblivion', 'Spinjutsu victim', 'Dizzy... and gone'];

let last = '';

function choose(pool: string[]): string {
  const options = pool.length > 1 ? pool.filter((q) => q !== last) : pool;
  const pick = options[Math.floor(Math.random() * options.length)];
  last = pick;
  return pick;
}

export function pickQuip(kind: QuipKind, ctx: QuipContext = {}): string {
  if (kind === 'ko-win') {
    if (ctx.ace) return choose(ACE_WIN);
    if (ctx.spin && Math.random() < 0.7) return choose(SPIN_WIN);
  }
  if (kind === 'ko-lose') {
    if (ctx.ace) return choose(ACE_LOSE);
    if (ctx.spin && Math.random() < 0.7) return choose(SPIN_LOSE);
  }
  return choose(GENERAL[kind]);
}
