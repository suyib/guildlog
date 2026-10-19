import { json, requireSession } from '../server/auth';
import { analyze } from '../server/pipeline';

export const config = { maxDuration: 60 };

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { host?: string; code?: string; fightId?: number; playerId?: number };
    if (!body.host || !body.code || !body.fightId || !body.playerId) return json({ error: 'Missing report, fight or player.' }, 400);
    return json(await analyze({ host: body.host, code: body.code, fightId: Number(body.fightId), playerId: Number(body.playerId) }));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
