import { json, requireSession } from '../server/auth.js';
import { getAnalysis, listHistory } from '../server/db.js';

// GET ?id=<analysis id>  one shared analysis: open to anyone with the link (read-only)
// GET                    the list of saved analyses: guild members only
export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    const denied = await requireSession(req);
    if (denied) return denied;
  }
  try {
    if (id) {
      const result = await getAnalysis(id);
      return result ? json(result) : json({ error: 'Not found' }, 404);
    }
    return json(await listHistory());
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
