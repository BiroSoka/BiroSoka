// End to end: beat a Career opponent and check daily goals, the streak, unlocks and the replay.
// Needs: Chrome, and `npm run dev` running (the dev build has a test hook that production builds do not).
//   npm run e2e:progress -w client
import puppeteer, { type Page } from 'puppeteer-core';
import { BASE_URL, chromePath, outDir } from './env.mts';
import { INPUT, dateKey, getBoss, goalsForDay, planAiShot, type MatchState } from '@biro/shared';

const OUT = outDir();
const URL = BASE_URL;
const W = 390, H = 844;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const until = async <T,>(fn: () => Promise<T | null | false | undefined>, ms = 15000, step = 100): Promise<T | null> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await wait(step);
  }
  return null;
};

const yesterday = dateKey(new Date(Date.now() - 86_400_000));
const today = dateKey();
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e: unknown) => errors.push((e as Error).message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// A player who played yesterday and has a 2-day streak, and who has already seen the how-to-flick tip.
await page.evaluateOnNewDocument((yday: string) => {
  if (localStorage.getItem('biro-soka:prefs:v1')) return;
  localStorage.setItem(
    'biro-soka:prefs:v1',
    JSON.stringify({ name: 'Tess', seenTutorial: true, sound: false, music: false, daily: { date: '', goals: [], streak: 2, bestStreak: 2, lastPlayed: yday }, stats: { bestStreak: 2 } }),
  );
}, yesterday);

const click = async (text: string) => {
  const [h] = await page.$$(`xpath/.//button[contains(., "${text}")]`);
  if (!h) throw new Error(`no button "${text}"`);
  await h.click();
  await wait(350);
};
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('biro-soka:prefs:v1') ?? '{}'));
const text = (sel: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);

// ===================== home: streak + daily goals + career =====================
await page.goto(URL, { waitUntil: 'networkidle0' });
const card = await page.evaluate(() => ({
  streak: document.querySelector('.daily-card .streak')?.textContent ?? '',
  goals: [...document.querySelectorAll('.daily-card li .goal-text')].map((e) => e.textContent?.replace(/^[^\w]+/, '').trim()),
  pill: document.querySelector('.career-pill')?.textContent ?? '',
}));
const expectedGoals = goalsForDay(today);
check('the home screen shows the 2-day streak from yesterday', /2-day streak/.test(card.streak), card.streak);
check("it shows today's three goals (the same ones every device gets today)", card.goals.length === 3 && expectedGoals.every((g, i) => card.goals[i] === g.text), card.goals.join(' | '));
check('the Career button shows 0/6', card.pill.trim() === '0/6', card.pill);
await page.screenshot({ path: OUT + '/e2e-home.png' });

await click('Career');
const ladder = await page.evaluate(() => [...document.querySelectorAll('.boss-card')].map((c) => ({ cls: c.className, name: c.querySelector('strong')?.textContent?.replace(/\s+/g, ' ').trim() })));
check('the ladder has six opponents: first open, the rest locked', ladder.length === 6 && ladder[0].cls.includes('current') && ladder.slice(1).every((b) => b.cls.includes('locked')), ladder.map((b) => b.cls.replace('boss-card ', '')).join(','));
await page.screenshot({ path: OUT + '/e2e-career.png' });

// ===================== play and beat the first opponent =====================
await click('Challenge');
await until(async () => (await page.$('.toss')) !== null, 8000);
await until(async () => !(await page.$('.toss')), 9000);
const introToast = await until(async () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null), 4000);
check('the opponent introduces themselves', !!introToast && /New Kid/.test(introToast) && /first biro/.test(introToast), introToast ?? '');
const hudNames = await page.evaluate(() => [...document.querySelectorAll('.player-card .pc-name')].map((n) => n.textContent));
check('the HUD shows the Career opponent by name', hudNames.includes('New Kid'), hudNames.join(' / '));

const ctrlState = () =>
  page.evaluate(() => {
    const c = (window as unknown as { __biro?: { ctrl: { state: { phase: string; replayable: boolean; replaying: boolean; match: unknown } } } }).__biro?.ctrl;
    if (!c) return null;
    const s = c.state;
    return { phase: s.phase, replayable: s.replayable, replaying: s.replaying, match: JSON.parse(JSON.stringify(s.match)) as MatchState };
  });

function screenOf(x: number, y: number) {
  const m = 0.42, worldW = 5.2 + 2 * m, worldH = 8.4 + 2 * m + 0.2;
  const availW = W - 12, availH = H - 86 - 58;
  const scale = Math.min(availW / worldW, availH / worldH);
  const cx = 6 + availW / 2, cy = 86 + availH / 2 - 0.1 * scale;
  return { sx: cx + scale * (x - 2.6), sy: cy + scale * (y - 4.2), scale };
}
async function botShot(match: MatchState, n: number) {
  const f = planAiShot(match, 0, 'hard', 777 + n);
  const pen = match.pens[0];
  const grab = screenOf(pen.x + Math.cos(pen.a) * f.gx, pen.y + Math.sin(pen.a) * f.gx);
  const len = f.power * INPUT.maxDrag * grab.scale;
  const ex = grab.sx - f.dx * len, ey = grab.sy - f.dy * len;
  await page.touchscreen.touchStart(grab.sx, grab.sy);
  await wait(40);
  await page.touchscreen.touchMove(grab.sx + (ex - grab.sx) / 2, grab.sy + (ey - grab.sy) / 2);
  await page.touchscreen.touchMove(ex, ey);
  await wait(60);
  await page.touchscreen.touchEnd();
}

let replayTested = false;
let shots = 0;
const deadline = Date.now() + 9 * 60_000;
while (Date.now() < deadline) {
  const st = await ctrlState();
  if (!st) {
    await wait(200);
    continue;
  }
  if (st.phase === 'over') break;
  if (st.phase === 'ready' && !st.replaying) {
    // ---- the replay must show the last shot without touching the live game ----
    if (!replayTested && st.replayable) {
      replayTested = true;
      const before = JSON.stringify(st.match);
      await click('Replay');
      const started = await until(async () => (await ctrlState())?.replaying === true, 2000, 40);
      check('tapping Replay starts a replay (with a REPLAY banner)', !!started && (await page.$('.replay-tag')) !== null);
      await page.screenshot({ path: OUT + '/e2e-replay.png' });
      const mid = await ctrlState();
      check('while it plays, the real game is untouched', mid?.phase === 'ready' && JSON.stringify(mid.match) === before);
      const finished = await until(async () => (await ctrlState())?.replaying === false, 10000, 80);
      const after = await ctrlState();
      check('the replay ends by itself and the live game is exactly as before', !!finished && after?.phase === 'ready' && JSON.stringify(after.match) === before);
      await click('Replay');
      await until(async () => (await ctrlState())?.replaying === true, 2000, 40);
      const t0 = Date.now();
      await page.touchscreen.tap(195, 330);
      const skipped = await until(async () => (await ctrlState())?.replaying === false, 2000, 40);
      check('tapping the table skips a replay', !!skipped && Date.now() - t0 < 1500);
      const afterSkip = await ctrlState();
      check('...and skipping does not start a flick or change the game', afterSkip?.phase === 'ready' && JSON.stringify(afterSkip.match) === before);
    }
    await botShot(st.match, shots++);
    await wait(400);
  } else {
    await wait(150);
  }
}
const over = await ctrlState();
check('the bot won the Career match', over?.phase === 'over' && over.match.winner === 0, `after ${shots} shots, score ${over?.match.scores.join('-')}`);
check('the replay was tested during the match', replayTested);

// ===================== the win screen =====================
await wait(500);
const win = await page.evaluate(() => ({
  title: document.querySelector('.result')?.textContent ?? '',
  boss: document.querySelector('.boss-beaten')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  unlock: document.querySelector('.unlock-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  streak: document.querySelector('.streak-line')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  buttons: [...document.querySelectorAll('.modal-actions button')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim()),
}));
check('the win screen says "You win!" and that the opponent is beaten, with who is next', /You win/.test(win.title) && /New Kid beaten/.test(win.boss) && /Next up: Class Rep/.test(win.boss), win.boss);
check('the Mint pen (prize) AND the Lime Streak pen (3-day streak) were unlocked', /Mint/.test(win.unlock) && /Lime Streak/.test(win.unlock), win.unlock);
check('the streak went from 2 to 3 days', /3-day streak/.test(win.streak) && /\+1 today/.test(win.streak), win.streak);
check('it offers Share, Next opponent, Rematch, Watch last shot and Career ladder', ['Share my win', 'Next: 😎 Class Rep', 'Rematch', 'Watch the last shot', 'Career ladder'].every((b) => win.buttons.some((x) => x?.includes(b))), win.buttons.join(' | '));
await page.screenshot({ path: OUT + '/e2e-win.png' });

// replay from the win screen
await click('Watch the last shot');
const hidden = await until(async () => (await page.$('.modal')) === null && (await page.$('.replay-tag')) !== null, 2000, 40);
check('"Watch the last shot" hides the win screen while the replay plays', !!hidden);
await page.screenshot({ path: OUT + '/e2e-replay-over.png' });
const back = await until(async () => (await page.$('.modal')) !== null, 10000, 100);
check('...and the win screen comes back afterwards', !!back);

// ===================== what was saved =====================
const saved = await prefs();
check('the career progress was saved', Array.isArray(saved.stats.careerCleared) && saved.stats.careerCleared.join() === 'new-kid');
check('the streak was saved (best 3, played today)', saved.daily.streak === 3 && saved.daily.bestStreak === 3 && saved.stats.bestStreak === 3 && saved.daily.lastPlayed === today, JSON.stringify({ s: saved.daily.streak, b: saved.stats.bestStreak, l: saved.daily.lastPlayed }));
const goalCheck = (saved.daily.goals as { id: string; kind: string; target: number; progress: number }[]).map((g) => {
  if (g.kind === 'wins') return g.progress === 1;
  if (g.kind === 'ai-wins') return g.progress === 1;
  if (g.kind === 'games') return g.progress === 1;
  return g.progress >= 0 && g.progress <= g.target;
});
check("today's goals counted the win, the game and the knock-offs correctly", goalCheck.length === 3 && goalCheck.every(Boolean), (saved.daily.goals as { id: string; progress: number; target: number }[]).map((g) => `${g.id} ${g.progress}/${g.target}`).join(', '));

await click('Career ladder');
const ladder2 = await page.evaluate(() => [...document.querySelectorAll('.boss-card')].map((c) => c.className.replace('boss-card ', '')));
check('back on the ladder: first beaten, second now open', ladder2[0] === 'cleared' && ladder2[1] === 'current' && ladder2.slice(2).every((c) => c === 'locked'), ladder2.join(','));
await page.screenshot({ path: OUT + '/e2e-career-after.png' });
await page.click('.back-btn');
await wait(400);
const home = await page.evaluate(() => ({
  pill: document.querySelector('.career-pill')?.textContent?.trim() ?? '',
  streak: document.querySelector('.daily-card .streak')?.textContent ?? '',
  progress: [...document.querySelectorAll('.daily-card li small')].map((s) => s.textContent),
}));
check('home now shows 1/6, the 3-day streak and the goal progress', home.pill === '1/6' && /3-day streak/.test(home.streak), `${home.pill} | ${home.streak} | ${home.progress.join(' ')}`);
await page.screenshot({ path: OUT + '/e2e-home-after.png' });

await click('Pens');
const pens = await page.evaluate(() => [...document.querySelectorAll('.skin-card')].map((c) => ({ name: c.querySelector('strong')?.textContent ?? '', locked: c.classList.contains('locked'), note: c.querySelector('small')?.textContent ?? '' })));
const by = (n: string) => pens.find((p) => p.name === n);
check('the Pens screen shows Mint and Lime Streak unlocked', by('Mint')?.locked === false && by('Lime Streak')?.locked === false, `Mint:${by('Mint')?.note} / Lime:${by('Lime Streak')?.note}`);
check('...and the others locked, saying how to get them', by('Tangerine')?.locked === true && /Beat Class Rep/.test(by('Tangerine')?.note ?? '') && by('Galaxy')?.locked === true && /7 days in a row/.test(by('Galaxy')?.note ?? ''), `Tangerine:${by('Tangerine')?.note} / Galaxy:${by('Galaxy')?.note}`);
await page.screenshot({ path: OUT + '/e2e-pens.png' });

await page.reload({ waitUntil: 'networkidle0' });
const reloaded = await page.evaluate(() => document.querySelector('.career-pill')?.textContent?.trim() ?? '');
check('everything survives a reload', reloaded === '1/6');

const boss = getBoss('new-kid')!;
console.log(`(opponent: ${boss.name}, target ${boss.target})`);
console.log('errors:', errors.length ? errors : 'none');
console.log(failures === 0 ? '\nALL PROGRESS E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
