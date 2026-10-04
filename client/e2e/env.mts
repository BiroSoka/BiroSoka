import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the app is served. `npm run dev` serves it on port 5173. */
export const BASE_URL = process.env.BIRO_URL ?? 'http://localhost:5173/';

/** Find Chrome (or set CHROME_PATH). Puppeteer here only drives a browser you already have. */
export function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found. Install it or set CHROME_PATH to its executable.');
  return found;
}

/** Folder for screenshots: the first command-line argument, or a temp folder. */
export function outDir(): string {
  const dir = process.argv[2] ?? join(tmpdir(), 'biro-e2e');
  mkdirSync(dir, { recursive: true });
  return dir.replace(/\\/g, '/');
}
