// Daily goals, streaks and the Career ladder: npx tsx scripts/progress-check.ts
import {
  BOSSES,
  DIFFICULTY,
  EMPTY_DAILY,
  GOAL_ROWS,
  SKINS,
  STREAK_REWARDS,
  applyDailyEvent,
  bossStates,
  currentStreak,
  dateKey,
  dayDiff,
  ensureToday,
  getBoss,
  goalsForDay,
  newMatch,
  nextBoss,
  planAiShot,
  type DailyState,
} from '../src';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

// ---- dates ------------------------------------------------------------------------------------------------
check('dateKey is the local date as YYYY-MM-DD', dateKey(new Date(2026, 0, 5, 23, 59)) === '2026-01-05' && dateKey(new Date(2026, 11, 31, 0, 0)) === '2026-12-31');
check('dayDiff counts whole days across month, year and leap-year edges',
  dayDiff('2026-02-28', '2026-03-01') === 1 && dayDiff('2027-12-31', '2028-01-01') === 1 && dayDiff('2028-02-28', '2028-03-01') === 2 && dayDiff('2026-05-10', '2026-05-10') === 0 && dayDiff('2026-05-10', '2026-05-08') === -2);

// ---- goals --------------------------------------------------------------------------------------------------
const g1 = goalsForDay('2026-10-04');
check('everyone gets the same three goals on the same day', JSON.stringify(g1) === JSON.stringify(goalsForDay('2026-10-04')) && g1.length === 3);
check('the three goals are always different kinds', new Set(g1.map((g) => g.kind)).size === 3);
const seen = new Set<string>();
for (let i = 0; i < 120; i++) goalsForDay(dateKey(new Date(2026, 0, 1 + i))).forEach((g) => seen.add(g.id));
const allIds = GOAL_ROWS.flat().map((g) => g.id);
check('over a few months every kind of goal comes up', allIds.every((id) => seen.has(id)), `${seen.size}/${allIds.length} seen`);
check('goals start at zero progress', g1.every((g) => g.progress === 0));

// ---- events and completion ----------------------------------------------------------------------------------------
const fixedGoals = (kinds: { id: string; kind: any; target: number; text: string }[]): DailyState => ({ ...EMPTY_DAILY, date: '2026-10-04', goals: kinds.map((k) => ({ ...k, progress: 0 })) });
let d = fixedGoals([
  { id: 'win-2', kind: 'wins', target: 2, text: 'Win 2 games' },
  { id: 'ko-3', kind: 'knockouts', target: 3, text: 'Knock off 3 pens' },
  { id: 'spin-1', kind: 'spin-knockouts', target: 1, text: 'spin' },
]);
let r = applyDailyEvent(d, { type: 'knockout', spin: false }, '2026-10-04');
check('a knock-off counts towards "knock off N pens" but not a spin goal', r.daily.goals[1].progress === 1 && r.daily.goals[2].progress === 0);
r = applyDailyEvent(r.daily, { type: 'knockout', spin: true, count: 2 }, '2026-10-04');
check('several pens at once and a spin knock-off both count', r.daily.goals[1].progress === 3 && r.daily.goals[2].progress === 1);
check('finishing goals is reported (once, with the goal)', r.completed.length === 2 && r.completed.some((g) => g.id === 'ko-3') && r.completed.some((g) => g.id === 'spin-1'));
r = applyDailyEvent(r.daily, { type: 'knockout', spin: true }, '2026-10-04');
check('progress is capped and a finished goal is not reported again', r.daily.goals[1].progress === 3 && r.completed.length === 0);
r = applyDailyEvent(r.daily, { type: 'game', won: false, ai: true }, '2026-10-04');
check('losing a game does not count as a win', r.daily.goals[0].progress === 0);
r = applyDailyEvent(r.daily, { type: 'game', won: true, ai: false }, '2026-10-04');
r = applyDailyEvent(r.daily, { type: 'game', won: true, ai: true }, '2026-10-04');
check('two wins complete "Win 2 games"', r.daily.goals[0].progress === 2 && r.completed.length === 1 && r.completed[0].id === 'win-2');

const aiOnly = applyDailyEvent(fixedGoals([{ id: 'ai-win-1', kind: 'ai-wins', target: 1, text: 'Beat the Computer' }, { id: 'play-3', kind: 'games', target: 3, text: 'Play 3' }, { id: 'x', kind: 'wins', target: 9, text: 'x' }]), { type: 'game', won: true, ai: false }, '2026-10-04');
check('beating a person does not count as "Beat the Computer", but does count as a game played', aiOnly.daily.goals[0].progress === 0 && aiOnly.daily.goals[1].progress === 1);

// ---- streaks ----------------------------------------------------------------------------------------------------------
let s: DailyState = EMPTY_DAILY;
const play = (day: string, won = true) => {
  const res = applyDailyEvent(s, { type: 'game', won, ai: true }, day);
  s = res.daily;
  return res;
};
let res = play('2026-10-01');
check('the first finished game starts a streak at 1', s.streak === 1 && res.streakChanged && s.bestStreak === 1);
res = play('2026-10-01');
check('more games the same day do not add to the streak', s.streak === 1 && !res.streakChanged);
res = play('2026-10-02', false);
check('playing the next day (even a loss) extends it', s.streak === 2 && res.streakChanged);
res = applyDailyEvent(s, { type: 'knockout', spin: false }, '2026-10-03');
check('knock-offs alone do not count as playing a day', res.daily.streak === 2 && !res.streakChanged && res.daily.lastPlayed === '2026-10-02');
check('the streak shown stays alive until the day after you last played', currentStreak(s, '2026-10-03') === 2 && currentStreak(s, '2026-10-04') === 0);
res = play('2026-10-04');
check('missing a day starts again at 1 but remembers the best', s.streak === 1 && s.bestStreak === 2);
for (const day of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']) play(day);
check('seven days in a row', s.streak === 7 && s.bestStreak === 7);
const back = applyDailyEvent(s, { type: 'game', won: true, ai: true }, '2026-10-01');
check('a clock set back does not break or inflate the streak', back.daily.streak === 7 && !back.streakChanged);
check('a new day brings new goals but keeps the streak', ensureToday(s, '2026-10-11').goals.every((g) => g.progress === 0) && ensureToday(s, '2026-10-11').streak === 7);
check('streak rewards point at real pens', STREAK_REWARDS.every((r) => SKINS.some((k) => k.id === r.skin && k.unlock.type === 'streak' && (k.unlock as any).days === r.days)));

// ---- career ladder ----------------------------------------------------------------------------------------------------------
const ids = BOSSES.map((b) => b.id);
check('six opponents with unique ids', BOSSES.length === 6 && new Set(ids).size === 6);
check('each opponent\'s pen and prize exist, and the prize unlocks by beating them',
  BOSSES.every((b) => SKINS.some((k) => k.id === b.skin) && SKINS.some((k) => k.id === b.reward && k.unlock.type === 'career' && (k.unlock as any).boss === b.id)));
check('only the last opponent counts as "Hard"', BOSSES.filter((b) => b.level === 'hard').length === 1 && BOSSES[BOSSES.length - 1].level === 'hard');
check('the ladder gets longer matches as it goes up', BOSSES.every((b, i) => i === 0 || b.target >= BOSSES[i - 1].target));
check('getBoss finds opponents and ignores unknown ids', getBoss('big-hitter')?.name === 'Big Hitter' && getBoss('nobody') === undefined);
check('with nothing beaten, only the first is open', nextBoss([])?.id === 'new-kid' && bossStates([]).map((b) => b.state).join() === 'current,locked,locked,locked,locked,locked');
check('beating them in order opens the next', nextBoss(['new-kid', 'class-rep'])?.id === 'spin-doctor' && bossStates(['new-kid']).map((b) => b.state).slice(0, 3).join() === 'cleared,current,locked');
check('a cleared ladder has no next opponent', nextBoss(ids) === null);
check('opponents cannot be skipped even if a later one is somehow recorded', nextBoss(['spin-doctor'])?.id === 'new-kid');

// ---- the AI quirks really change how they play ---------------------------------------------------------------------------------
const picks = (id: string, n = 40) => {
  const boss = getBoss(id)!;
  const out: { power: number; gx: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = newMatch(5, 100 + i, 1);
    out.push(planAiShot(m, 1, 'medium', 900 + i, boss.profile));
  }
  return out;
};
const cautious = picks('class-rep');
check('Class Rep never flicks harder than 62%', cautious.every((f) => f.power <= 0.62 + 1e-9), `max ${Math.max(...cautious.map((f) => f.power)).toFixed(2)}`);
const big = picks('big-hitter');
check('Big Hitter never flicks softer than 88%', big.every((f) => f.power >= 0.88 - 1e-9), `min ${Math.min(...big.map((f) => f.power)).toFixed(2)}`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spin = picks('spin-doctor');
const plain: { gx: number }[] = [];
for (let i = 0; i < 40; i++) plain.push(planAiShot(newMatch(5, 100 + i, 1), 1, 'medium', 900 + i, DIFFICULTY.medium));
check('Spin Doctor grips nearer the ends of the pen than a normal player', mean(spin.map((f) => Math.abs(f.gx))) > mean(plain.map((f) => Math.abs(f.gx))) + 0.05, `${mean(spin.map((f) => Math.abs(f.gx))).toFixed(2)} vs ${mean(plain.map((f) => Math.abs(f.gx))).toFixed(2)}`);
let slowest = 0;
for (const b of BOSSES) {
  const t0 = performance.now();
  planAiShot(newMatch(5, 7, 1), 1, b.level, 5, b.profile);
  slowest = Math.max(slowest, performance.now() - t0);
}
check('every opponent plans a shot quickly (under 4s, even on a slow machine)', slowest < 4000, `slowest ${slowest.toFixed(0)}ms`);

console.log(failures === 0 ? '\nALL PROGRESS CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
