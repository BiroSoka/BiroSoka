// Pretends to be Lagos Life (a fake `window.Vatar`) and checks the game's side of the integration.
//   npm run lagos -w client -- http://localhost:3001/
import puppeteer from 'puppeteer-core';
import { chromePath } from './env.mts';

const URL = process.argv[2] ?? 'http://localhost:3001/';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e: unknown) => errors.push((e as Error).message));
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.setRequestInterception(true);
page.on('request', (r) => (r.url().includes('lagoslife.app/sdk') ? r.respond({ status: 200, contentType: 'text/javascript', body: '' }) : r.continue()));
await page.evaluateOnNewDocument(`
  localStorage.setItem('biro-soka:prefs:v1', JSON.stringify({ sound: false, music: false, seenTutorial: true }));
  window.__pause = null; window.__scores = [];
  window.Vatar = {
    init: () => Promise.resolve({ player: { id: 'p_1', name: 'Tunde', avatar: '' }, session: 's', mode: 'test' }),
    onPause: (f) => { window.__pause = f; }, onResume: () => {},
    submitScore: (n) => { window.__scores.push(n); return Promise.resolve({}); },
    leaderboard: () => Promise.resolve({ top: [{ rank: 1, name: 'Ada', score: 9 }], me: { label: '#4' } }),
  };
`);
const click = async (text: string) => {
  const [h] = await page.$$(`xpath/.//button[contains(., "${text}")]`);
  if (!h) throw new Error(`no button "${text}"`);
  await h.click();
  await wait(500);
};
try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 150_000 });
  await wait(800);
  const text = await page.evaluate(() => document.body.innerText);
  check('uses the Lagos Life name', /Tunde/.test(text) || (await page.evaluate(() => localStorage.getItem('biro-soka:prefs:v1')))!.includes('Tunde'));
  check('shows the Leaderboard button', /Leaderboard/.test(text));
  await click('Leaderboard');
  const board = await page.evaluate(() => document.body.innerText);
  check('the board lists players and "you"', /Ada/.test(board) && /#4/.test(board));
  check('no script errors', errors.length === 0, errors.slice(0, 2).join(' || '));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nLAGOS LIFE CHECK PASSED');
process.exit(failures ? 1 : 0);
