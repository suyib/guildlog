// Who has signed in to the site, for the Admin page: one row per Discord account (first and last
// sign-in, which server, officer or not) and a log of every sign-in attempt.
import { dbEnabled, rest } from './db.js';
import type { AdminOverview, AdminSignIn, AdminUser } from './types.js';

export type SiteUser = AdminUser;
export type SignIn = AdminSignIn;

/** How long the sign-in log is kept. */
export const SIGNIN_LOG_DAYS = 90;

const q = encodeURIComponent;

/** Note a sign-in attempt, and keep the person's row up to date when it worked. Never stops a sign-in. */
export async function recordSignIn(e: Omit<SignIn, 'id' | 'at'> & { name?: string | null; avatar?: string | null; officer?: boolean }): Promise<void> {
  if (!dbEnabled()) return;
  const now = new Date().toISOString();
  try {
    await rest('site_signins', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ at: now, kind: e.kind, result: e.result, discord_id: e.discord_id, username: e.username, guild_id: e.guild_id, guild_name: e.guild_name, detail: e.detail }),
    });
    if (e.result !== 'ok' || !e.discord_id) return;
    const existing: SiteUser | undefined = (await rest(`site_users?discord_id=eq.${q(e.discord_id)}&select=sign_ins,first_seen`))?.[0];
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
        first_seen: existing?.first_seen ?? now,
        last_seen: now,
        sign_ins: (existing?.sign_ins ?? 0) + 1,
      }),
    });
  } catch (err) {
    console.error('couldn’t record sign-in', err);
  }
}

/** Everything the Admin page shows: people, recent sign-ins, and when each person first used the bot. */
export async function adminOverview(): Promise<AdminOverview> {
  const since = new Date(Date.now() - SIGNIN_LOG_DAYS * 86_400_000).toISOString();
  const [users, signIns, claims] = await Promise.all([
    rest('site_users?order=last_seen.desc&limit=1000') as Promise<SiteUser[]>,
    rest(`site_signins?at=gte.${q(since)}&order=at.desc&limit=500`) as Promise<SignIn[]>,
    rest('bot_claims?select=discord_id,discord_name,character,realm,status,created_at&order=created_at.asc&limit=2000').catch(() => []) as Promise<
      { discord_id: string; discord_name: string; character: string; realm: string | null; status: string; created_at: string }[]
    >,
  ]);
  // Claimed characters and first bot use, by Discord account (including people who only use the bot)
  const bot = new Map<string, { name: string; firstClaim: string; characters: { name: string; realm: string | null; status: string }[] }>();
  for (const c of claims ?? []) {
    const x = bot.get(c.discord_id) ?? { name: c.discord_name, firstClaim: c.created_at, characters: [] };
    x.characters.push({ name: c.character, realm: c.realm, status: c.status });
    bot.set(c.discord_id, x);
  }
  return { users: users ?? [], signIns: signIns ?? [], bot: Object.fromEntries(bot), signInLogDays: SIGNIN_LOG_DAYS };
}

/** Drop sign-in log entries past the keep window (run by the hourly part of the 5-minute job). */
export async function pruneSignIns() {
  if (!dbEnabled() || new Date().getUTCMinutes() >= 5) return;
  const before = new Date(Date.now() - SIGNIN_LOG_DAYS * 86_400_000).toISOString();
  await rest(`site_signins?at=lt.${q(before)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
