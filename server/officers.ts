// Who's in the guild's Discord server and who's an officer, asked live through the bot.
// Officer: the server owner, anyone with Administrator or Manage Server, or the officer role
// (DISCORD_ADMIN_ROLE_ID) — the same rule the bot's officer-only commands use.
import { type Session, forThisGuild, json, readSession } from './auth.js';
import { discord, env } from './discord/api.js';

const ADMINISTRATOR = 8n;
const MANAGE_GUILD = 32n;

export interface Membership { member: boolean; officer: boolean; nick: string | null; guildName: string | null }

export async function membership(userId: string, guildId = env.guildId()): Promise<Membership> {
  if (!guildId) return { member: false, officer: false, nick: null, guildName: null };
  const m = await discord<{ roles: string[]; nick?: string | null }>(`/guilds/${guildId}/members/${userId}`).catch(() => null);
  const guild = await discord<{ name: string; owner_id: string; roles: { id: string; permissions: string }[] }>(`/guilds/${guildId}`).catch(() => null);
  if (!m) return { member: false, officer: false, nick: null, guildName: guild?.name ?? null };
  const officerRole = env.adminRole();
  const mine = new Set([...m.roles, guildId]); // everyone has the @everyone role, whose ID is the server's
  const perms = (guild?.roles ?? []).filter((r) => mine.has(r.id)).reduce((p, r) => p | BigInt(r.permissions || '0'), 0n);
  const officer = guild?.owner_id === userId || (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD || (!!officerRole && m.roles.includes(officerRole));
  return { member: true, officer, nick: m.nick ?? null, guildName: guild?.name ?? null };
}

/** Discord sign-in is set up (otherwise the guild password is the only way in). */
export const discordLoginEnabled = () => !!(process.env.DISCORD_CLIENT_SECRET?.trim() && process.env.DISCORD_APP_ID?.trim() && env.guildId());

/**
 * For officer-only API routes: the session if the person is an officer right now (checked with
 * Discord, so someone who lost the role can't keep using it), else the error response to send.
 * Until Discord sign-in is set up, everyone with the guild password counts as an officer.
 */
export async function requireOfficer(req: Request): Promise<{ session: Session } | { denied: Response }> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { denied: json({ error: 'Server is missing SESSION_SECRET' }, 500) };
  const session = await readSession(req.headers.get('cookie'), secret);
  if (!session || !forThisGuild(session)) return { denied: json({ error: 'Not signed in' }, 401) };
  if (session.kind === 'password') {
    return discordLoginEnabled() ? { denied: json({ error: 'Only officers can do this. Sign in with Discord to continue.' }, 403) } : { session };
  }
  const now = await membership(session.uid!, session.gid);
  if (!now.officer) return { denied: json({ error: 'Only officers can do this.' }, 403) };
  return { session };
}

/** Site admins (you): the Discord user IDs in SITE_ADMIN_IDS. They see the Admin page. */
export const isSiteAdmin = (s: Session | null) =>
  !!s && s.kind === 'discord' && !!s.uid && (process.env.SITE_ADMIN_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean).includes(s.uid);

/** For admin-only API routes: the session if a site admin is signed in, else the error response. */
export async function requireAdmin(req: Request): Promise<{ session: Session } | { denied: Response }> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { denied: json({ error: 'Server is missing SESSION_SECRET' }, 500) };
  const session = await readSession(req.headers.get('cookie'), secret);
  if (!session) return { denied: json({ error: 'Not signed in' }, 401) };
  if (!isSiteAdmin(session)) return { denied: json({ error: 'Only site admins can see this.' }, 403) };
  return { session };
}
