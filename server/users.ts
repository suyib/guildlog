// People on the site, for the Admin page: one row per Discord account (sign-ins, server, rank,
// display name, officer note, access) and a log of every sign-in attempt. Edits follow the ranks:
// each rank can change people below it (admins can change everyone, other admins included).
import { applyBugEdit, listBugs } from './bugs.js';
import { applyGuildEdit, discordGuild, guildSettings } from './guildSettings.js';
import { dbEnabled, rest } from './db.js';
import { RANK_LABEL, type Rank, assignable, canEdit, effectiveRank, forgetBlockedCache, siteAdminIds } from './ranks.js';
import type { AdminEdit, AdminOverview, AdminPerson, AdminSignIn, AdminUser } from './types.js';

export type SiteUser = AdminUser;
export type SignIn = AdminSignIn;

/** How long the sign-in log is kept. */
export const SIGNIN_LOG_DAYS = 90;

const q = encodeURIComponent;

/** Note a sign-in attempt, and keep the person's row up to date when it worked. Never stops a sign-in. */
export async function recordSignIn(e: Omit<SignIn, 'id' | 'at'> & { name?: string | null; avatar?: string | null; officer?: boolean; discordRank?: Rank }): Promise<void> {
  if (!dbEnabled()) return;
  const now = new Date().toISOString();
  try {
    await rest('site_signins', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ at: now, kind: e.kind, result: e.result, discord_id: e.discord_id, username: e.username, guild_id: e.guild_id, guild_name: e.guild_name, detail: e.detail }),
    });
    if (e.result !== 'ok' || !e.discord_id) return;
    const existing: Pick<SiteUser, 'sign_ins' | 'first_seen'> | undefined = (await rest(`site_users?discord_id=eq.${q(e.discord_id)}&select=sign_ins,first_seen`))?.[0];
    // Only the sign-in fields: a rank, name, note or block set on the Admin page is kept
    await rest('site_users?on_conflict=discord_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        discord_id: e.discord_id,
        username: e.username ?? '',
        name: e.name ?? e.username ?? '',
        avatar: e.avatar ?? null,
        guild_id: e.guild_id,
        guild_name: e.guild_name,
        officer: !!e.officer,
        discord_rank: e.discordRank ?? (e.officer ? 'officer' : 'raider'),
        first_seen: existing?.sign_ins ? existing.first_seen : now,
        last_seen: now,
        sign_ins: (existing?.sign_ins ?? 0) + 1,
      }),
    });
  } catch (err) {
    console.error('couldn’t record sign-in', err);
  }
}

interface ClaimRow { id: string; discord_id: string; discord_name: string; character: string; realm: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: string }

/** Everyone, with their rank and whether `viewer` (of rank `viewerRank`) may edit them. */
async function people(viewerId: string | null, viewerRank: Rank): Promise<AdminPerson[]> {
  const [users, claims] = await Promise.all([
    rest('site_users?order=last_seen.desc&limit=2000') as Promise<SiteUser[]>,
    rest('bot_claims?select=id,discord_id,discord_name,character,realm,status,created_at&order=created_at.asc&limit=4000').catch(() => []) as Promise<ClaimRow[]>,
  ]);
  const out = new Map<string, AdminPerson>();
  const person = (id: string, name: string): AdminPerson => ({
    id, name, discordName: name, username: null, avatar: null, guild: null, rank: 'raider', rankFrom: 'discord', rankSet: null, displayName: null,
    note: null, blocked: false, firstSignIn: null, lastSignIn: null, signIns: 0, firstClaim: null, characters: [], editable: false,
  });
  for (const u of users ?? []) {
    const p = person(u.discord_id, u.name || u.username);
    p.username = u.username || null;
    p.avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=64` : null;
    p.guild = u.guild_name ?? u.guild_id;
    p.rankSet = u.rank;
    p.displayName = u.display_name;
    p.name = u.display_name || p.discordName;
    p.note = u.note;
    p.blocked = !!u.blocked;
    if (u.sign_ins > 0) {
      p.firstSignIn = u.first_seen;
      p.lastSignIn = u.last_seen;
      p.signIns = u.sign_ins;
    }
    p.rank = effectiveRank(u.discord_id, u.rank, u.discord_rank ?? (u.officer ? 'officer' : 'raider'));
    out.set(u.discord_id, p);
  }
  for (const c of claims ?? []) {
    const p = out.get(c.discord_id) ?? person(c.discord_id, c.discord_name);
    if (!out.has(c.discord_id)) p.rank = effectiveRank(c.discord_id, null, 'raider');
    p.firstClaim ??= c.created_at;
    p.characters.push({ id: c.id, name: c.character, realm: c.realm, status: c.status });
    out.set(c.discord_id, p);
  }
  for (const p of out.values()) {
    p.rankFrom = siteAdminIds().includes(p.id) ? 'site admin' : p.rankSet ? 'set here' : 'discord';
    p.editable = canEdit(viewerRank, p.rank) || p.id === viewerId && viewerRank === 'admin';
  }
  return [...out.values()].sort((a, b) => (b.lastSignIn ?? b.firstClaim ?? '').localeCompare(a.lastSignIn ?? a.firstClaim ?? ''));
}

/** Everything the Admin page shows, for someone of rank `rank`. */
export async function adminOverview(viewerId: string | null, rank: Rank): Promise<AdminOverview> {
  const since = new Date(Date.now() - SIGNIN_LOG_DAYS * 86_400_000).toISOString();
  const [list, signIns, bugs, settings, discord] = await Promise.all([
    people(viewerId, rank),
    rest(`site_signins?at=gte.${q(since)}&order=at.desc&limit=500`) as Promise<SignIn[]>,
    listBugs(),
    guildSettings(),
    discordGuild(),
  ]);
  return {
    me: { id: viewerId, rank, assignable: assignable(rank) },
    people: list,
    signIns: signIns ?? [],
    signInLogDays: SIGNIN_LOG_DAYS,
    bugs,
    guild: { settings, discord: discord ? { name: discord.name, icon: discord.icon } : null },
  };
}

/**
 * Apply one change from the Admin page. Checked here, not only on the page: you can only change
 * people below your rank (admins: everyone), and only give ranks below your own. Returns a line
 * for the activity log.
 */
export async function applyEdit(edit: AdminEdit, actor: { id: string | null; name: string; rank: Rank }): Promise<string> {
  if (edit.action === 'bug' || edit.action === 'bugDelete') return applyBugEdit(edit, actor);
  if (edit.action === 'guild') return applyGuildEdit(edit, actor);
  const list = await people(actor.id, actor.rank);
  const target = list.find((p) => p.id === edit.id);
  if (!target) throw new Error('That person isn’t on the list.');
  if (!target.editable) throw new Error(`${RANK_LABEL[actor.rank]}s can only change people below them.`);
  const who = `${target.name} (<@${target.id}>)`;

  // Make sure there's a row to change, for people who've only used the bot
  const ensureRow = () => rest('site_users?on_conflict=discord_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ discord_id: target.id, username: target.username ?? '', name: target.discordName, sign_ins: 0 }),
  });
  const patch = async (fields: Record<string, unknown>) => {
    await ensureRow();
    await rest(`site_users?discord_id=eq.${q(target.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields) });
  };

  switch (edit.action) {
    case 'rank': {
      if (target.rankFrom === 'site admin') throw new Error('Admins are set with SITE_ADMIN_IDS in Vercel.');
      if (edit.rank !== null && !assignable(actor.rank).includes(edit.rank)) throw new Error(`You can’t give the ${RANK_LABEL[edit.rank]} rank.`);
      await patch({ rank: edit.rank });
      return edit.rank ? `set ${who}’s rank to ${RANK_LABEL[edit.rank]}` : `set ${who}’s rank back to what Discord says`;
    }
    case 'name': {
      const name = edit.displayName?.trim().slice(0, 40) || null;
      await patch({ display_name: name });
      return name ? `renamed ${target.discordName} to ${name}` : `cleared ${target.discordName}’s display name`;
    }
    case 'note': {
      await patch({ note: edit.note?.trim().slice(0, 500) || null });
      return `updated the officer note on ${who}`;
    }
    case 'blocked': {
      if (target.id === actor.id) throw new Error('You can’t turn off your own access.');
      await patch({ blocked: edit.blocked });
      forgetBlockedCache();
      return edit.blocked ? `turned off ${who}’s access to the site` : `turned ${who}’s access back on`;
    }
    case 'addCharacter': {
      const character = edit.character.trim();
      if (!/^[\p{L}]{2,24}$/u.test(character)) throw new Error('That doesn’t look like a character name.');
      try {
        await rest('bot_claims', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ discord_id: target.id, discord_name: target.discordName, character, character_key: character.toLowerCase(), realm: edit.realm?.trim() || null, status: 'approved', decided_by: actor.id, decided_at: new Date().toISOString() }),
        });
      } catch (e) {
        if (/409|duplicate|unique/i.test((e as Error).message)) throw new Error(`${character} is already claimed by someone.`);
        throw e;
      }
      return `added ${character} to ${who}`;
    }
    case 'claim': {
      const c = target.characters.find((x) => x.id === edit.claimId);
      if (!c) throw new Error('That character isn’t theirs.');
      if (edit.status === 'removed') {
        await rest(`bot_claims?id=eq.${q(c.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return `removed ${c.name} from ${who}`;
      }
      await rest(`bot_claims?id=eq.${q(c.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: edit.status, decided_by: actor.id, decided_at: new Date().toISOString() }) });
      return `${edit.status === 'approved' ? 'approved' : 'rejected'} ${who}’s claim on ${c.name}`;
    }
  }
}

/** Drop sign-in log entries past the keep window (run by the hourly part of the 5-minute job). */
export async function pruneSignIns() {
  if (!dbEnabled() || new Date().getUTCMinutes() >= 5) return;
  const before = new Date(Date.now() - SIGNIN_LOG_DAYS * 86_400_000).toISOString();
  await rest(`site_signins?at=lt.${q(before)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
