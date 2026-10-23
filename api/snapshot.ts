// POST { host, code, fight, actor } -> one player's analysis data, from the stored fight.
import { json, requireSession } from '../server/auth.js';
import { getPack } from '../server/pack.js';
import { snapshotFromPack } from '../server/pipeline.js';
import type { ActorRef, FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fight?: FightRef; actor?: ActorRef };
    if (!b.host || !b.code || !b.fight || !b.actor) return json({ error: 'Missing report, fight or player.' }, 400);
    return json(snapshotFromPack(b.host, b.code, await getPack(b.host, b.code, b.fight, 'full'), b.actor));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
