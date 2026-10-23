// POST { host, code, fightId }          -> everyone's fight-wide numbers (first step of an analysis).
//                                          The whole fight is read and stored here, once.
// POST { host, code, fight, breakdown }  -> the whole-raid breakdown of a fight (no player chosen)
// POST { host, code, overall }           -> the whole night: every boss, everyone's numbers, what went well
// All share one function to stay within the free Vercel plan's function limit. Fights already
// stored answer without asking Warcraft Logs.
import { json, requireSession } from '../server/auth.js';
import { breakdownFromPack } from '../server/breakdown.js';
import { overallRaid } from '../server/overall.js';
import { getMeta, getPack } from '../server/pack.js';
import { rowsFromPack } from '../server/pipeline.js';
import type { FightRef } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fightId?: number; fight?: FightRef; breakdown?: boolean; overall?: boolean };
    if (!b.host || !b.code) return json({ error: 'Missing report.' }, 400);
    const { host, code } = b;
    if (b.overall) return json(await overallRaid(host, code));
    if (b.breakdown) {
      if (!b.fight) return json({ error: 'Missing fight.' }, 400);
      return json(breakdownFromPack(host, await getPack(host, code, b.fight, 'full')));
    }
    if (!b.fightId) return json({ error: 'Missing fight.' }, 400);
    // The page already knows the fight; older pages only send its number
    const f = b.fight?.id === Number(b.fightId) ? b.fight : (await getMeta(host, code)).meta.fights.find((x) => x.id === Number(b.fightId));
    if (!f) return json({ error: 'That fight isn’t in this report.' }, 400);
    const ref: FightRef = { id: f.id, encounterID: f.encounterID, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: !!f.kill };
    return json(rowsFromPack(await getPack(host, code, ref, 'full')));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
