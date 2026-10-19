import { json, requireSession } from '../server/auth.js';
import { reportSummary } from '../server/pipeline.js';

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url) return json({ error: 'Paste a Warcraft Logs link.' }, 400);
    return json(await reportSummary(url));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
