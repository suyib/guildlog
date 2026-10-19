import { json, requireSession } from '../server/auth';
import { getAnalysis, listHistory } from '../server/db';

export async function GET(req: Request): Promise<Response> {
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (id) {
      const result = await getAnalysis(id);
      return result ? json(result) : json({ error: 'Not found' }, 404);
    }
    return json(await listHistory());
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
