// The Admin page (officers and above).
//   GET          everyone who has signed in or used the bot, their rank and characters, and the sign-in log
//   POST {edit}  change someone below you: rank, display name, officer note, access, characters
import { json } from '../server/auth.js';
import { auditTask } from '../server/discord/audit.js';
import { requireRank } from '../server/officers.js';
import { RANK_LABEL } from '../server/ranks.js';
import type { AdminEdit } from '../server/types.js';
import { adminOverview, applyEdit } from '../server/users.js';

export async function GET(req: Request): Promise<Response> {
  const check = await requireRank(req, 'officer');
  if ('denied' in check) return check.denied;
  try {
    return json(await adminOverview(check.session.uid ?? null, check.rank), 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  const check = await requireRank(req, 'officer');
  if ('denied' in check) return check.denied;
  const { session, rank } = check;
  try {
    const edit = (await req.json()) as AdminEdit;
    if (!edit?.action || !edit.id) return json({ error: 'Nothing to change.' }, 400);
    const done = await applyEdit(edit, { id: session.uid ?? null, name: session.name ?? 'Someone', rank });
    await auditTask(`${session.uid ? `<@${session.uid}>` : 'Someone'} (${RANK_LABEL[rank]}) ${done} on the Admin page`);
    return json({ ok: true, done });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
