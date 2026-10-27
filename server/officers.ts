// Who's in the guild's Discord server and who's an officer, asked live through the bot.
// Officer: the server owner, anyone with Administrator or Manage Server, or the officer role
// (DISCORD_ADMIN_ROLE_ID) — the same rule the bot's officer-only commands use.
import { type Session, forThisGuild, json, readSession } from './auth.js';
import { discord, env } from './discord/api.js';
import { RANK_LABEL, type Rank, can, discordRank, effectiveRank, isBlocked, level, siteAdminIds, storedPerson } from './ranks.js';

const ADMINISTRATOR = 8n;
const MANAGE_GUILD = 32n;

export interface Membership {
  member: boolean;
  officer: boolean;
  /** The server owner: Guild master unless an admin sets otherwise. */
  owner: boolean;
  nick: string | null;
  guildName: string | null;
}

export async function membership(userId: string, guildId = env.guildId()): Promise<Membership> {
  if (!guildId) return { member: false, officer: false, owner: false, nick: null, guildName: null };
  const m = await discord<{ roles: string[]; nick?: string | null }>(`/guilds/${guildId}/members/${userId}`).catch(() => null);
  const guild = await discord<{ name: string; owner_id: string; roles: { id: string; permissions: string }[] }>(`/guilds/${guildId}`).catch(() => null);
  if (!m) return { member: false, officer: false, owner: false, nick: null, guildName: guild?.name ?? null };
  const officerRole = env.adminRole();
  const mine = new Set([...m.roles, guildId]); // everyone has the @everyone role, whose ID is the server's
  const perms = (guild?.roles ?? []).filter((r) => mine.has(r.id)).reduce((p, r) => p | BigInt(r.permissions || '0'), 0n);
  const officer = guild?.owner_id === userId || (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD || (!!officerRole && m.roles.includes(officerRole));
  return { member: true, officer, owner: guild?.owner_id === userId, nick: m.nick ?? null, guildName: guild?.name ?? null };
}

/** Discord sign-in is set up (otherwise the guild password is the only way in). */
export const discordLoginEnabled = () => !!(process.env.DISCORD_CLIENT_SECRET?.trim() && process.env.DISCORD_APP_ID?.trim() && env.guildId());

/** Someone's rank right now: SITE_ADMIN_IDS, then a rank set on the Admin page, then Discord (asked live). */
export async function liveRank(session: Session): Promise<{ rank: Rank; member: boolean }> {
  if (session.kind !== 'discord' || !session.uid) return { rank: discordLoginEnabled() ? 'raider' : 'officer', member: true };
  const [m, stored] = await Promise.all([membership(session.uid, session.gid), storedPerson(session.uid)]);
  return { rank: effectiveRank(session.uid, stored?.rank, discordRank(m)), member: m.member };
}

/**
 * For API routes that need a rank (officer-only actions, the Admin page): the session and rank
 * when the person has at least `min` right now, else the error response to send. Until Discord
 * sign-in is set up, everyone with the guild password counts as an officer.
 */
export async function requireRank(req: Request, min: Rank = 'officer'): Promise<{ session: Session; rank: Rank } | { denied: Response }> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { denied: json({ error: 'Server is missing SESSION_SECRET' }, 500) };
  const session = await readSession(req.headers.get('cookie'), secret);
  if (!session || !forThisGuild(session)) return { denied: json({ error: 'Not signed in' }, 401) };
  if (session.kind === 'discord' && session.uid && (await isBlocked(session.uid))) return { denied: json({ error: 'Your access to Guild Logs has been turned off by an officer.' }, 403) };
  // Officer tools: officers and raid leaders (and above); higher ranks by order
  const who = min === 'officer' ? 'officers and raid leaders' : `${RANK_LABEL[min].toLowerCase()}s and above`;
  if (session.kind === 'password' && discordLoginEnabled()) {
    return { denied: json({ error: `Only ${who} can do this. Sign in with Discord to continue.` }, 403) };
  }
  const { rank } = await liveRank(session);
  if (min === 'officer' ? !can(rank, 'officer') : level(rank) < level(min)) return { denied: json({ error: `Only ${who} can do this.` }, 403) };
  return { session, rank };
}

/** Officer-only actions (kept for existing callers). */
export async function requireOfficer(req: Request): Promise<{ session: Session } | { denied: Response }> {
  return requireRank(req, 'officer');
}

/** Site admins (SITE_ADMIN_IDS). */
export const isSiteAdmin = (s: Session | null) => !!s && s.kind === 'discord' && !!s.uid && siteAdminIds().includes(s.uid);
