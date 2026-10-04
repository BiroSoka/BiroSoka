// Re-takes the screenshots used in the README (docs/screenshots). Run it whenever the look of the game changes.
// Needs: Chrome, and `npm run dev` running.
//   npm run screenshots -w client
import puppeteer, { type Page } from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dateKey, goalsForDay } from '@biro/shared';
import { BASE_URL, chromePath } from './env.mts';

const OUT = process.argv[2] ?? fileURLToPath(new URL('../../docs/screenshots', import.meta.url));
mkdirSync(OUT, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A friendly looking save: a few wins, a streak, and two Career opponents beaten.
const today = dateKey();
const goals = goalsForDay(today).map((g, i) => ({ ...g, progress: i === 0 ? Math.min(g.target, 1) : i === 1 ? Math.min(g.target, 2) : 0 }));
const save = {
  name: 'Tess',
  skin: 'blue',
  sound: false,
  music: false,
  seenRoyale: true,
  seenTutorial: true,
  daily: { date: today, goals, streak: 4, bestStreak: 4, lastPlayed: today },
  stats: { aiWins: 7, aiLosses: 3, onlineWins: 2, onlineLosses: 1, beatHard: false, careerCleared: ['new-kid', 'class-rep'], bestStreak: 4 },
};

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
async function player(name?: string): Promise<Page> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((s: string) => localStorage.setItem('biro-soka:prefs:v1', s), JSON.stringify(name ? { ...save, name } : save));
  return page;
}
const click = async (page: Page, text: string) => {
  const [h] = await page.$$(`xpath/.//button[contains(., "${text}")]`);
  if (!h) throw new Error(`no button "${text}"`);
  await h.click();
  await wait(500);
};
const shot = (page: Page, file: string) => page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 82 });

const home = await player();
await home.goto(BASE_URL, { waitUntil: 'networkidle0' });
await wait(800);
await shot(home, 'home');
await click(home, 'Career');
await wait(600);
await shot(home, 'career');

// Battle Royale with three players
const host = await player('Tess');
await host.goto(BASE_URL, { waitUntil: 'networkidle0' });
await click(host, 'Play a Friend Online');
await host.waitForSelector('#name');
await click(host, 'Battle Royale');
await click(host, 'Create room');
await host.waitForSelector('.room-code');
const code = await host.evaluate(() => [...document.querySelectorAll('.room-code span')].map((s) => s.textContent).join(''));
const guests: Page[] = [];
for (const [name, skin] of [['Bo', 'red'], ['Cy', 'green']] as const) {
  const g = await player(name);
  await g.evaluateOnNewDocument((s: string) => localStorage.setItem('biro-soka:prefs:v1', s), JSON.stringify({ ...save, name, skin }));
  await g.goto(`${BASE_URL}?room=${code}`, { waitUntil: 'networkidle0' });
  await g.waitForSelector('#name');
  await click(g, 'Join');
  await g.waitForSelector('.roster');
  guests.push(g);
}
await wait(500);
await click(host, 'Start game');
await host.waitForFunction(() => document.querySelector('.intro') !== null, { timeout: 10000 });
await host.waitForFunction(() => document.querySelector('.intro') === null, { timeout: 12000 });
await wait(900);
await shot(host, 'royale');

console.log(`Screenshots saved to ${OUT}`);
await browser.close();
