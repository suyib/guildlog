import { json, requireSession } from '../server/auth.js';
import { fightRows } from '../server/pipeline.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fightId?: number };
    if (!b.host || !b.code || !b.fightId) return json({ error: 'Missing report or fight.' }, 400);
    return json(await fightRows(b.host, b.code, Number(b.fightId)));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
