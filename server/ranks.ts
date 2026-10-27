// Ranks, highest first:
//   Admin         set only by SITE_ADMIN_IDS in Vercel; can edit everyone.
//   Guild master  the Discord server owner, unless someone above sets another rank.
//   Officer       Administrator / Manage Server / the officer role on Discord, or set on the Admin page.
//   Raid leader   set on the Admin page; can do everything officers can.
//   Raid assist   set on the Admin page; runs the raid (/raidstart, /raidend, /remind).
//   Loot council  set on the Admin page; looks people up (/check anyone, /performance).
//   Raider        everyone else.
// A rank set on the Admin page wins over what Discord says. Each rank can edit people below it and
// give them any rank below its own (admins can edit everyone, other admins included, except their rank).
// What each rank may do is in ABILITIES, not the order (so a raid leader counts as an officer).
import { dbEnabled, rest } from './db.js';

export const RANKS = ['raider', 'loot_council', 'raid_assist', 'raid_leader', 'officer', 'guild_master', 'admin'] as const;
export type Rank = (typeof RANKS)[number];
export const RANK_LABEL: Record<Rank, string> = {
  admin: 'Admin', guild_master: 'Guild master', officer: 'Officer', raid_leader: 'Raid leader', raid_assist: 'Raid assist', loot_council: 'Loot council', raider: 'Raider',
};
export const level = (r: Rank) => RANKS.indexOf(r);

/**
 * officer: the site's officer tools (Admin page, adding and reading raids, approving claims).
 * raid: running a raid in Discord (/raidstart, /raidend, /remind).
 * lookup: /check on anyone and /performance.
 */
export type Ability = 'officer' | 'raid' | 'lookup';
const ALL: Ability[] = ['officer', 'raid', 'lookup'];
const ABILITIES: Record<Rank, Ability[]> = {
  admin: ALL, guild_master: ALL, officer: ALL, raid_leader: ALL, raid_assist: ['raid'], loot_council: ['lookup'], raider: [],
};
export const can = (r: Rank | null | undefined, a: Ability) => !!r && (ABILITIES[r] ?? []).includes(a);

export const siteAdminIds = () => (process.env.SITE_ADMIN_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** What Discord alone says: owner = Guild master, officer permissions or role = Officer. */
export const discordRank = (m: { owner: boolean; officer: boolean }): Rank => (m.owner ? 'guild_master' : m.officer ? 'officer' : 'raider');

/** The rank that counts: SITE_ADMIN_IDS, then a rank set on the Admin page, then Discord. */
export function effectiveRank(uid: string | null | undefined, stored: Rank | null | undefined, fromDiscord: Rank): Rank {
  if (uid && siteAdminIds().includes(uid)) return 'admin';
  if (stored && stored !== 'admin' && RANKS.includes(stored)) return stored;
  return fromDiscord;
}

/** Whether someone of rank `actor` may edit someone of rank `target`. */
export const canEdit = (actor: Rank, target: Rank) => actor === 'admin' || level(actor) > level(target);

/** Ranks `actor` may hand out: anything below their own (Admin is only set in Vercel). */
export const assignable = (actor: Rank): Rank[] => RANKS.filter((r) => r !== 'admin' && (actor === 'admin' || level(r) < level(actor)));

export interface StoredPerson { discord_id: string; rank: Rank | null; discord_rank: Rank | null; display_name: string | null; blocked: boolean }

/** The stored part of someone's rank and profile (null when they have no row yet). */
export async function storedPerson(uid: string): Promise<StoredPerson | null> {
  if (!dbEnabled()) return null;
  const rows = await rest(`site_users?discord_id=eq.${encodeURIComponent(uid)}&select=discord_id,rank,discord_rank,display_name,blocked`).catch(() => null);
  return rows?.[0] ?? null;
}

// Blocked people, cached for a minute per server instance so every request can check cheaply
let blockedCache: { at: number; ids: Set<string> } | null = null;
export async function isBlocked(uid: string): Promise<boolean> {
  if (!dbEnabled()) return false;
  if (!blockedCache || Date.now() - blockedCache.at > 60_000) {
    const rows: { discord_id: string }[] = (await rest('site_users?blocked=eq.true&select=discord_id').catch(() => null)) ?? [];
    blockedCache = { at: Date.now(), ids: new Set(rows.map((r) => r.discord_id)) };
  }
  return blockedCache.ids.has(uid);
}
export const forgetBlockedCache = () => {
  blockedCache = null;
};
