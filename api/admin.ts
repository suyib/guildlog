// Admin page data (site admins only, listed in SITE_ADMIN_IDS): who has signed in, from which
// Discord server, when they first and last signed in, their claimed characters, and the sign-in log.
import { json } from '../server/auth.js';
import { requireAdmin } from '../server/officers.js';
import { adminOverview } from '../server/users.js';

export async function GET(req: Request): Promise<Response> {
  const check = await requireAdmin(req);
  if ('denied' in check) return check.denied;
  try {
    return json(await adminOverview(), 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
