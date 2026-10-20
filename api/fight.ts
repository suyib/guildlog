// POST { host, code, fightId }          -> everyone's fight-wide numbers (first step of an analysis)
// POST { host, code, fight, breakdown }  -> the whole-raid breakdown of a fight (no player chosen)
// Both share one function to stay within the free Vercel plan's function limit.
import { json, requireSession } from '../server/auth.js';
import { fightBreakdown } from '../server/breakdown.js';
import { fightRows } from '../server/pipeline.js';
import type { FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fightId?: number; fight?: FightRef; breakdown?: boolean };
    if (b.breakdown) {
      if (!b.host || !b.code || !b.fight) return json({ error: 'Missing report or fight.' }, 400);
      return json(await fightBreakdown(b.host, b.code, b.fight));
    }
    if (!b.host || !b.code || !b.fightId) return json({ error: 'Missing report or fight.' }, 400);
    return json(await fightRows(b.host, b.code, Number(b.fightId)));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
