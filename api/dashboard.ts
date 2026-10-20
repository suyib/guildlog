import { json, requireSession } from '../server/auth.js';
import { buildDashboard } from '../server/dashboard.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fightId?: number; sourceId?: number; fightSeconds?: number; dps?: number; startTime?: number; endTime?: number };
    if (!b.host || !b.code || !b.fightId || !b.sourceId) return json({ error: 'Missing report, fight or player.' }, 400);
    return json(await buildDashboard(b.host, b.code, Number(b.fightId), Number(b.sourceId), Number(b.fightSeconds) || 0, Number(b.dps) || 0, Number(b.startTime) || 0, Number(b.endTime) || 0));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
