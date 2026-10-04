// Smoke test: does the app actually START in a real browser? A build can pass type checks and unit tests and still
// show a blank page (for example after a bad dependency upgrade), so this loads it and looks.
//   npm run smoke -w client -- http://localhost:3001/
// Needs Chrome. Exits with a non-zero status if anything is wrong, so CI can fail the build.
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
page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && errors.push(m.text()));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => localStorage.setItem('biro-soka:prefs:v1', JSON.stringify({ sound: false, music: false, seenTutorial: true })));

const click = async (text: string) => {
  const [h] = await page.$$(`xpath/.//button[contains(., "${text}")]`);
  if (!h) throw new Error(`no button "${text}"`);
  await h.click();
  await wait(500);
};

try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 150_000 });
  await wait(800);
  const home = await page.evaluate(() => ({ card: !!document.querySelector('.paper-inner'), text: document.body.innerText }));
  check('the home screen renders (not a blank page)', home.card && /Biro/.test(home.text) && /Play vs Computer/.test(home.text), home.text.slice(0, 40).split('\n').join(' | '));
  check('it starts without any script errors', errors.length === 0, errors.slice(0, 2).join(' || '));

  await click('Career');
  check('the Career screen opens and lists the opponents', (await page.$$('.boss-card')).length === 6);
  await page.click('.back-btn');
  await wait(400);

  await click('Play vs Computer');
  await click('Start game');
  const table = await page.waitForSelector('canvas.table-canvas', { timeout: 8000 }).catch(() => null);
  await wait(1500);
  check('a game starts and the table is drawn', !!table && (await page.$('.toss')) !== null);
  check('it still has no script errors after starting a game', errors.length === 0, errors.slice(0, 2).join(' || '));
} catch (e) {
  check('the app could be loaded and used', false, (e as Error).message);
}

await browser.close();
console.log(failures === 0 ? '\nSMOKE TEST PASSED' : `\nSMOKE TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
