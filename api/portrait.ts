import { json, requireSession } from '../server/auth.js';
import { characterPortrait, portraitsEnabled } from '../server/blizzard.js';
import { reportRegion } from '../server/pack.js';

const regionCache = new Map<string, string | null>();

export async function GET(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const host = q.get('host') ?? '';
  const code = q.get('code') ?? '';
  const name = q.get('name') ?? '';
  const server = q.get('server') ?? '';
  if (!portraitsEnabled() || !host || !code || !name || !server) return json({ url: null });
  try {
    if (!regionCache.has(code)) regionCache.set(code, await reportRegion(host, code));
    const region = regionCache.get(code);
    const url = region ? await characterPortrait(region, server, name) : null;
    // Portraits rarely change; let the browser keep the answer for a day.
    return json({ url }, 200, { 'Cache-Control': 'private, max-age=86400' });
  } catch {
    return json({ url: null });
  }
}
