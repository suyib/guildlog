import { json, requireSession } from '../server/auth.js';
import { topParseTarget } from '../server/pipeline.js';
import type { FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; fight?: FightRef; me?: { name: string; className: string; specName: string } };
    if (!b.host || !b.fight || !b.me) return json({ error: 'Missing fight or player.' }, 400);
    return json({ target: await topParseTarget(b.host, b.fight, b.me) });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
