import { json, requireSession } from '../server/auth.js';
import { snapshotOne } from '../server/pipeline.js';
import { liveOrSaved } from '../server/saved.js';
import type { ActorRef, FightPlayerRow, FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fight?: FightRef; actor?: ActorRef; row?: FightPlayerRow };
    if (!b.host || !b.code || !b.fight || !b.actor) return json({ error: 'Missing report, fight or player.' }, 400);
    const { host, code, fight, actor, row } = b;
    return json(await liveOrSaved(code, 'snapshot', fight.id, actor.id, () => snapshotOne(host, code, fight, actor, row)));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
