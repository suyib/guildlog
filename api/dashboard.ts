import { json, requireSession } from '../server/auth.js';
import { buildDashboard } from '../server/dashboard.js';
import { liveOrSaved } from '../server/saved.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { host?: string; code?: string; fightId?: number; sourceId?: number; fightSeconds?: number; dps?: number; startTime?: number; endTime?: number };
    if (!b.host || !b.code || !b.fightId || !b.sourceId) return json({ error: 'Missing report, fight or player.' }, 400);
    const { host, code } = b;
    const fightId = Number(b.fightId);
    const sourceId = Number(b.sourceId);
    return json(await liveOrSaved(code, 'dashboard', fightId, sourceId, () =>
      buildDashboard(host, code, fightId, sourceId, Number(b.fightSeconds) || 0, Number(b.dps) || 0, Number(b.startTime) || 0, Number(b.endTime) || 0)));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
