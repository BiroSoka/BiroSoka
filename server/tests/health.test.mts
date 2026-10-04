// The health page that uptime monitors (and Render) ask for.
import { URL, check, finish } from './helpers.mts';

const get = await fetch(`${URL}/api/health`);
const body = (await get.json()) as Record<string, unknown>;
check('GET /api/health answers 200 with ok: true', get.status === 200 && body.ok === true);
check('it reports rooms and uptime', typeof body.rooms === 'number' && typeof body.uptimeSeconds === 'number');
check('it is never cached (a monitor must reach the live server)', (get.headers.get('cache-control') ?? '').includes('no-store'));

const head = await fetch(`${URL}/api/health`, { method: 'HEAD' });
check('HEAD works too (some uptime monitors use it)', head.status === 200);

finish('HEALTH');
