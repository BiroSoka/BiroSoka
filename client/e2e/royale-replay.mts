// End to end: two players in a Battle Royale, and the replay of the last shot.
// Needs: Chrome, and `npm run dev` running (client and server).
//   npm run e2e:royale -w client
import puppeteer, { type Page } from 'puppeteer-core';
import { BASE_URL, chromePath, outDir } from './env.mts';

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

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [];
async function player(label: string): Promise<Page> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e: unknown) => errors.push(`${label}: ${(e as Error).message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => localStorage.setItem('biro-soka:prefs:v1', JSON.stringify({ sound: false, music: false, seenRoyale: true })));
  return page;
}
const click = async (page: Page, text: string) => {
  const [h] = await page.$$(`xpath/.//button[contains(., "${text}")]`);
  if (!h) throw new Error(`no button "${text}"`);
  await h.click();
  await wait(350);
};
const hud = (p: Page) =>
  p.evaluate(() => {
    const c = (window as unknown as { __biro?: { ctrl: { hud: { phase: string; replayable: boolean; replaying: boolean; state: { turn: number; shotNo: number; pens: unknown; scores: number[]; alive: boolean[] } } } } }).__biro?.ctrl;
    if (!c) return null;
    const h = c.hud;
    return { phase: h.phase, replayable: h.replayable, replaying: h.replaying, state: JSON.parse(JSON.stringify(h.state)) };
  });

function screenOf(x: number, y: number) {
  const m = 0.42, worldW = 5.2 + 2 * m, worldH = 8.4 + 2 * m + 0.2;
  const availW = W - 12, availH = H - 86 - 58;
  const scale = Math.min(availW / worldW, availH / worldH);
  return { sx: 6 + availW / 2 + scale * (x - 2.6), sy: 86 + availH / 2 - 0.1 * scale + scale * (y - 4.2), scale };
}

const host = await player('host');
await host.goto(URL, { waitUntil: 'networkidle0' });
await click(host, 'Play a Friend Online');
await host.waitForSelector('#name');
await host.type('#name', 'Hoss');
await click(host, 'Battle Royale');
await click(host, 'Create room');
await until(async () => (await host.$('.roster')) !== null, 8000);
const code = await host.evaluate(() => [...document.querySelectorAll('.room-code span')].map((s) => s.textContent).join(''));
const guest = await player('guest');
await guest.goto(`${URL}?room=${code}`, { waitUntil: 'networkidle0' });
await guest.waitForSelector('#name');
await guest.type('#name', 'Gus');
await click(guest, 'Join');
await until(async () => (await guest.$('.roster')) !== null, 8000);
await wait(400);
await click(host, 'Start game');
await until(async () => (await hud(host)) !== null && (await hud(guest)) !== null, 10000);
await until(async () => (await hud(host))?.phase !== 'intro' && (await hud(guest))?.phase !== 'intro', 10000);
await wait(500);
const pages = [host, guest];

// the first player flicks gently
const first = (await hud(host))!;
const mover = first.state.turn;
check('Replay is not offered before any shot has been played', (await hud(host))!.replayable === false && (await host.$('.replay-btn')) === null);
const pen = (first.state.pens as ({ x: number; y: number } | null)[])[mover]!;
const g = screenOf(pen.x, pen.y);
const dy = (pen.y > 4.2 ? 1 : -1) * 0.35 * 2.1 * g.scale;
await pages[mover].touchscreen.touchStart(g.sx, g.sy);
await wait(40);
await pages[mover].touchscreen.touchMove(g.sx, g.sy + dy / 2);
await pages[mover].touchscreen.touchMove(g.sx, g.sy + dy);
await wait(60);
await pages[mover].touchscreen.touchEnd();

const settled = await until(async () => {
  const a = await hud(host), b = await hud(guest);
  return a && b && a.state.shotNo >= 1 && b.state.shotNo >= 1 && ['ready', 'waiting'].includes(a.phase) && ['ready', 'waiting'].includes(b.phase) && a.replayable && b.replayable ? true : null;
}, 15000, 100);
check('after a shot both players can watch it again', !!settled);
check('both players see a Replay button', (await host.$('.replay-btn')) !== null && (await guest.$('.replay-btn')) !== null);

for (const [label, page] of [['the player whose turn it is', pages[1 - mover]], ['the player who is waiting', pages[mover]]] as const) {
  const before = JSON.stringify((await hud(page))!.state);
  await click(page, 'Replay');
  const started = await until(async () => (await hud(page))?.replaying === true, 2000, 40);
  check(`${label}: Replay starts, with the REPLAY banner`, !!started && (await page.$('.replay-tag')) !== null);
  if (label.includes('waiting')) await page.screenshot({ path: OUT + '/e2e-royale-replay.png' });
  const mid = (await hud(page))!;
  check(`${label}: the live game is untouched while it plays`, JSON.stringify(mid.state) === before);
  const finished = await until(async () => (await hud(page))?.replaying === false, 10000, 80);
  const after = (await hud(page))!;
  check(`${label}: it ends by itself with the game exactly as before`, !!finished && JSON.stringify(after.state) === before);
  await click(page, 'Replay');
  await until(async () => (await hud(page))?.replaying === true, 2000, 40);
  await page.touchscreen.tap(195, 330);
  const skipped = await until(async () => (await hud(page))?.replaying === false, 2000, 40);
  check(`${label}: tapping the table skips it`, !!skipped && JSON.stringify((await hud(page))!.state) === before);
}

// a real shot must cancel a replay: start one on the waiting player, then let the other player flick
const waiter = pages[mover];
const actor = pages[1 - mover];
const st = (await hud(actor))!;
if (st.phase === 'ready') {
  await click(waiter, 'Replay');
  await until(async () => (await hud(waiter))?.replaying === true, 2000, 40);
  const p2 = (st.state.pens as ({ x: number; y: number } | null)[])[st.state.turn]!;
  const g2 = screenOf(p2.x, p2.y);
  const d2 = (p2.y > 4.2 ? 1 : -1) * 0.35 * 2.1 * g2.scale;
  await actor.touchscreen.touchStart(g2.sx, g2.sy);
  await wait(40);
  await actor.touchscreen.touchMove(g2.sx, g2.sy + d2 / 2);
  await actor.touchscreen.touchMove(g2.sx, g2.sy + d2);
  await wait(60);
  await actor.touchscreen.touchEnd();
  const cancelled = await until(async () => (await hud(waiter))?.replaying === false && (await hud(waiter))!.state.shotNo >= 2, 6000, 60);
  check('a real shot cancels a replay and the live game carries on', !!cancelled);
}

console.log('errors:', errors.length ? errors : 'none');
console.log(failures === 0 ? '\nALL ROYALE REPLAY CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
