// Lagos Life purchases: the server must check every purchase with Lagos Life before giving anything.
// A tiny fake Lagos Life API stands in for the real one.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL as MAIN, check, finish, wait } from './helpers.mts';

const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const serverDir = fileURLToPath(new URL('..', import.meta.url));

// The page may be framed by Lagos Life, and by nobody else.
const csp = (await fetch(`${MAIN}/api/health`)).headers.get('content-security-policy') ?? '';
check('the page may be framed by Lagos Life', csp.includes('frame-ancestors') && csp.includes('https://lagoslife.app'));
check('and no site can frame it by default', !csp.includes('*'));

const delivered: string[] = [];
const purchases: Record<string, { productId: string; playerId: string; status: string }> = {
  good: { productId: 'ankara_pen', playerId: 'p_ada', status: 'paid' },
  theirs: { productId: 'ankara_pen', playerId: 'p_other', status: 'paid' },
  refunded: { productId: 'ankara_pen', playerId: 'p_ada', status: 'refunded' },
  weird: { productId: 'mystery', playerId: 'p_ada', status: 'paid' },
};
const fake = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const reply = (code: number, body: unknown) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== 'Bearer vtr_test_secret') return reply(401, {});
    const url = req.url ?? '';
    if (url === '/session/verify') {
      const { session } = JSON.parse(Buffer.concat(chunks).toString());
      return session === 'sess-ada' ? reply(200, { playerId: 'p_ada', name: 'Ada' }) : reply(401, { error: 'bad_session' });
    }
    const m = url.match(/^\/purchases\/([^/]+)(\/deliver)?$/);
    const p = m && purchases[m[1]];
    if (!m || !p) return reply(404, { error: 'not_found' });
    if (m[2]) {
      delivered.push(m[1]);
      return reply(200, { id: m[1], status: 'delivered' });
    }
    return reply(200, { id: m[1], ...p });
  });
});
await new Promise<void>((r) => fake.listen(4998, r));

const BASE = 'http://localhost:4997';
const server = spawn(process.execPath, [tsx, 'src/index.ts'], {
  cwd: serverDir,
  env: { ...process.env, PORT: '4997', VATAR_API: 'http://localhost:4998', VATAR_SECRET: 'vtr_test_secret', DATA_DIR: mkdtempSync(join(tmpdir(), 'biro-')) },
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not yet */
    }
    await wait(300);
  }
  const claim = (session: string, purchaseId: string) =>
    fetch(`${BASE}/api/vatar/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, purchaseId }) });

  const ok = await claim('sess-ada', 'good');
  check('a real purchase by the right player is accepted', ok.status === 200 && ((await ok.json()) as any).productId === 'ankara_pen');
  check('and is marked delivered', delivered.includes('good'));
  check('a forged session is refused', (await claim('nope', 'good')).status === 403);
  check("someone else's purchase is refused", (await claim('sess-ada', 'theirs')).status === 403 && !delivered.includes('theirs'));
  check('a refunded purchase is refused', (await claim('sess-ada', 'refunded')).status === 409 && !delivered.includes('refunded'));
  check('an unknown product is refused', (await claim('sess-ada', 'weird')).status === 400 && !delivered.includes('weird'));
  check('an unknown purchase id is refused', (await claim('sess-ada', 'ghost')).status === 403);
  const again = await claim('sess-ada', 'good');
  check('claiming twice is harmless', again.status === 200);

  const owned = await fetch(`${BASE}/api/vatar/owned`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: 'sess-ada' }) });
  check('the server remembers what a player owns', ((await owned.json()) as any).products?.includes('ankara_pen'));
} finally {
  server.kill();
  fake.close();
}
finish('VATAR');
