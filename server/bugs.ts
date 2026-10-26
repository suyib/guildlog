// Bug reports: sent with the Report a bug button in Discord, kept here and handled on the Admin page.
import { dbEnabled, rest } from './db.js';
import { level, type Rank } from './ranks.js';
import type { AdminEdit, BugReport } from './types.js';

const q = encodeURIComponent;

interface BugRow {
  id: string;
  created_at: string;
  discord_id: string | null;
  username: string | null;
  place: string | null;
  raid_host: string | null;
  raid_code: string | null;
  what: string;
  doing: string | null;
  status: 'open' | 'resolved';
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

const toReport = (r: BugRow): BugReport => ({
  id: r.id,
  at: r.created_at,
  discordId: r.discord_id,
  username: r.username,
  place: r.place,
  raid: r.raid_code && r.raid_host ? { host: r.raid_host, code: r.raid_code } : null,
  what: r.what,
  doing: r.doing,
  status: r.status,
  note: r.note,
  resolvedBy: r.resolved_by,
  resolvedAt: r.resolved_at,
});

export async function saveBug(b: { discordId: string; username: string; place: string; raid: { host: string; code: string } | null; what: string; doing: string | null }): Promise<void> {
  if (!dbEnabled()) throw new Error('the database isn’t set up');
  await rest('bug_reports', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      discord_id: b.discordId, username: b.username, place: b.place,
      raid_host: b.raid?.host ?? null, raid_code: b.raid?.code ?? null,
      what: b.what.slice(0, 1000), doing: b.doing?.slice(0, 500) || null,
    }),
  });
}

/** The latest reports, open ones first. */
export async function listBugs(): Promise<BugReport[]> {
  if (!dbEnabled()) return [];
  const rows: BugRow[] = (await rest('bug_reports?order=status.asc,created_at.desc&limit=200').catch(() => [])) ?? [];
  return rows.map(toReport);
}

export async function getBug(id: string): Promise<BugReport | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row: BugRow | undefined = (await rest(`bug_reports?id=eq.${q(id)}`))?.[0];
  return row ? toReport(row) : null;
}

export async function updateBug(id: string, fields: { status?: 'open' | 'resolved'; note?: string | null; by?: string }) {
  const patch: Record<string, unknown> = {};
  if (fields.note !== undefined) patch.note = fields.note?.trim().slice(0, 500) || null;
  if (fields.status) {
    patch.status = fields.status;
    patch.resolved_by = fields.status === 'resolved' ? fields.by ?? null : null;
    patch.resolved_at = fields.status === 'resolved' ? new Date().toISOString() : null;
  }
  await rest(`bug_reports?id=eq.${q(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
}

export async function deleteBug(id: string) {
  await rest(`bug_reports?id=eq.${q(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/**
 * A change to a bug report from the Admin page (officers and above; deleting: guild masters and
 * admins). Marking it fixed can tell the reporter by DM, with the note. Returns a line for the activity log.
 */
export async function applyBugEdit(edit: Extract<AdminEdit, { action: 'bug' | 'bugDelete' }>, actor: { id: string | null; name: string; rank: Rank }): Promise<string> {
  const bug = await getBug(edit.id);
  if (!bug) throw new Error('That bug report doesn\u2019t exist any more.');
  const about = `the bug report from ${bug.username ?? 'someone'} (\u201c${bug.what.slice(0, 60)}${bug.what.length > 60 ? '\u2026' : ''}\u201d)`;
  if (edit.action === 'bugDelete') {
    if (level(actor.rank) < level('guild_master')) throw new Error('Only guild masters and admins can delete bug reports.');
    await deleteBug(edit.id);
    return `deleted ${about}`;
  }
  await updateBug(edit.id, { status: edit.status, note: edit.note, by: actor.name });
  let told = '';
  if (edit.status === 'resolved' && edit.tell && bug.discordId) {
    const { sendDm } = await import('./discord/api.js');
    const note = (edit.note ?? bug.note)?.trim();
    const ok = await sendDm(bug.discordId, {
      content: `Thanks for reporting a bug in Guild Logs. It\u2019s been looked at and marked as fixed.\n> ${bug.what.slice(0, 300).replace(/\n/g, '\n> ')}${note ? `\n\n${note}` : ''}`,
      allowed_mentions: { parse: [] },
    }).catch(() => false);
    told = ok ? ' and told them by DM' : ' (their DMs are closed, so they weren\u2019t told)';
  }
  if (edit.status === 'resolved') return `marked ${about} as fixed${told}`;
  if (edit.status === 'open') return `reopened ${about}`;
  return `updated the note on ${about}`;
}
