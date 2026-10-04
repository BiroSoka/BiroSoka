// Starts a real server on a spare port (with short turn clocks) and runs every *.test.mts against it.
//   npm test -w server
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const serverDir = fileURLToPath(new URL('..', import.meta.url));
const testsDir = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.TEST_PORT ?? 4999);
const URL_ = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), TURN_SECONDS: '3', TURN_HOLD_SECONDS: '20', TEST_URL: URL_ };

const server = spawn(process.execPath, [tsx, 'src/index.ts'], { cwd: serverDir, env, stdio: ['ignore', 'inherit', 'inherit'] });
server.on('error', (e) => {
  console.error('Could not start the server:', e.message);
  process.exit(1);
});

async function waitForServer() {
  const end = Date.now() + 40_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${URL_}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('The server did not start in time');
}

let failed = 0;
try {
  await waitForServer();
  const files = readdirSync(testsDir).filter((f) => f.endsWith('.test.mts')).sort();
  for (const file of files) {
    console.log(`\n=== ${file} ===`);
    const r = spawnSync(process.execPath, [tsx, testsDir + file], { cwd: serverDir, env, stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
} finally {
  server.kill();
}
console.log(failed === 0 ? '\nAll server test files passed.' : `\n${failed} server test file(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
