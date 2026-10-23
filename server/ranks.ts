// Ranks, highest first: Admin (site admins, SITE_ADMIN_IDS), Guild master, Officer, Raider.
//   Admin         set only by SITE_ADMIN_IDS in Vercel; can edit everyone.
//   Guild master  the Discord server owner, unless someone above sets another rank.
//   Officer       Administrator / Manage Server / the officer role on Discord, or set on the Admin page.
//   Raider        everyone else.
// A rank set on the Admin page wins over what Discord says. Each rank can edit people below it and
// give them any rank below its own (admins can edit everyone, other admins included, except their rank).
import { dbEnabled, rest } from './db.js';

export const RANKS = ['raider', 'officer', 'guild_master', 'admin'] as const;
export type Rank = (typeof RANKS)[number];
export const RANK_LABEL: Record<Rank, string> = { admin: 'Admin', guild_master: 'Guild master', officer: 'Officer', raider: 'Raider' };
export const level = (r: Rank) => RANKS.indexOf(r);

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
