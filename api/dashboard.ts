// POST { host, code, fight, sourceId } -> one player's gear, stats, lines over time, survival and healing, from the stored fight.
import { json, requireSession } from '../server/auth.js';
import { dashboardFromPack } from '../server/dashboard.js';
import { getPack } from '../server/pack.js';
import type { FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fight?: FightRef; sourceId?: number };
    if (!b.host || !b.code || !b.fight || !b.sourceId) return json({ error: 'Missing report, fight or player.' }, 400);
    return json(dashboardFromPack(await getPack(b.host, b.code, b.fight, 'full'), Number(b.sourceId)));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
