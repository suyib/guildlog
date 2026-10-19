import { json, requireSession } from '../server/auth.js';
import { finish } from '../server/pipeline.js';
import type { Comparison, Dashboard, PlayerSnapshot } from '../server/types.js';

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as { player?: PlayerSnapshot; comparisons?: Comparison[]; compareKey?: string; notes?: string[]; dashboard?: Dashboard };
    if (!b.player) return json({ error: 'Missing player data.' }, 400);
    return json(await finish({ player: b.player, comparisons: b.comparisons ?? [], compareKey: b.compareKey ?? 'auto', notes: b.notes ?? [], dashboard: b.dashboard }));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
