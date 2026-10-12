import type { Express } from 'express';
import express from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Lagos Life purchases. The game never gives anything because its own code said "paid": the client sends the Lagos Life
 * session token and the purchase id, and THIS server checks both with Lagos Life, gives the item once, then marks the
 * purchase delivered. The secret key lives only in the VATAR_SECRET environment variable.
 *
 * Products are cosmetic pens only (nothing that changes how a game plays).
 */
const API = process.env.VATAR_API ?? 'https://lagoslife.app/api/games/v1';
const SECRET = process.env.VATAR_SECRET ?? '';

/** Lagos Life product id to what it unlocks. Add the product in the dashboard with the same id. */
export const PRODUCTS: Record<string, string> = { ankara_pen: 'ankara' };

const FILE = resolve(process.env.DATA_DIR ?? 'data', 'owned.json');
const owned = new Map<string, Set<string>>(); // player id to product ids
const given = new Set<string>(); // purchase ids already given (give once per purchase)

try {
  if (existsSync(FILE)) {
    const saved = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string[]>;
    for (const [id, list] of Object.entries(saved)) owned.set(id, new Set(list));
  }
} catch {
  /* start empty */
}

function save() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(Object.fromEntries([...owned].map(([id, set]) => [id, [...set]]))));
  } catch {
    /* a read-only disk only means ownership is remembered until the next restart */
  }
}

async function api(path: string, body?: unknown): Promise<{ http: number; [k: string]: unknown }> {
  const res = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { http: res.status, ...json };
}

async function who(session: unknown): Promise<string | null> {
  if (typeof session !== 'string' || session.length > 2000) return null;
  const me = await api('/session/verify', { session });
  return me.http === 200 && typeof me.playerId === 'string' ? me.playerId : null;
}

export function mountVatar(app: Express) {
  const json = express.json({ limit: '4kb' });

  app.post('/api/vatar/claim', json, async (req, res) => {
    if (!SECRET) return void res.status(503).json({ error: 'not_configured' });
    try {
      const playerId = await who(req.body?.session);
      const purchaseId = req.body?.purchaseId;
      if (!playerId || typeof purchaseId !== 'string' || purchaseId.length > 100) return void res.status(403).json({ error: 'bad_session' });

      const p = await api(`/purchases/${encodeURIComponent(purchaseId)}`);
      if (p.http !== 200 || p.playerId !== playerId) return void res.status(403).json({ error: 'not_yours' });
      if (p.status === 'refunded') return void res.status(409).json({ error: 'refunded' });
      const productId = String(p.productId);
      if (!(productId in PRODUCTS)) return void res.status(400).json({ error: 'unknown_product' });

      if (!given.has(purchaseId)) {
        given.add(purchaseId);
        const set = owned.get(playerId) ?? new Set<string>();
        set.add(productId);
        owned.set(playerId, set);
        save();
      }
      await api(`/purchases/${encodeURIComponent(purchaseId)}/deliver`, {}); // safe to repeat
      res.json({ ok: true, productId });
    } catch {
      res.status(502).json({ error: 'lagos_life_unreachable' });
    }
  });

  /** What this player already owns, so a cleared browser does not lose a purchase. */
  app.post('/api/vatar/owned', json, async (req, res) => {
    if (!SECRET) return void res.json({ products: [] });
    try {
      const playerId = await who(req.body?.session);
      res.json({ products: playerId ? [...(owned.get(playerId) ?? [])] : [] });
    } catch {
      res.json({ products: [] });
    }
  });
}
