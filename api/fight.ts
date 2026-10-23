// POST { host, code, fightId }          -> everyone's fight-wide numbers (first step of an analysis)
// POST { host, code, fight, breakdown }  -> the whole-raid breakdown of a fight (no player chosen)
// POST { host, code, overall }           -> the whole night: every boss, everyone's numbers, what went well
// Both share one function to stay within the free Vercel plan's function limit.
// When Warcraft Logs is down, raids saved on the Past raids page answer from the saved copy.
import { json, requireSession } from '../server/auth.js';
import { fightBreakdown } from '../server/breakdown.js';
import { overallRaid } from '../server/overall.js';
import { fightRows } from '../server/pipeline.js';
import { liveOrSaved } from '../server/saved.js';
import type { FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fightId?: number; fight?: FightRef; breakdown?: boolean; overall?: boolean };
    if (b.overall) {
      if (!b.host || !b.code) return json({ error: 'Missing report.' }, 400);
      return json(await overallRaid(b.host, b.code));
    }
    if (b.breakdown) {
      if (!b.host || !b.code || !b.fight) return json({ error: 'Missing report or fight.' }, 400);
      const { host, code, fight } = b;
      return json(await liveOrSaved(code, 'breakdown', fight.id, 0, () => fightBreakdown(host, code, fight)));
    }
    if (!b.host || !b.code || !b.fightId) return json({ error: 'Missing report or fight.' }, 400);
    const { host, code } = b;
    const fightId = Number(b.fightId);
    return json(await liveOrSaved(code, 'rows', fightId, 0, () => fightRows(host, code, fightId)));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
