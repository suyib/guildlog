import { json, requireSession } from '../server/auth.js';
import { comparisonTargets } from '../server/pipeline.js';
import type { ActorRef, CompareChoice, FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fight?: FightRef; actor?: ActorRef; compare?: CompareChoice };
    if (!b.host || !b.code || !b.fight || !b.actor) return json({ error: 'Missing report, fight or player.' }, 400);
    return json(await comparisonTargets(b.host, b.code, b.fight, b.actor, b.compare ?? { kind: 'auto' }));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
