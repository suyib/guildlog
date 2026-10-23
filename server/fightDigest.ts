// A compact summary of everyone's numbers in one boss fight, worked out from the stored fight
// (no Warcraft Logs requests). It's what the Discord bot, the raid cards, Whole night, Home and
// profiles read, so the site and Discord always tell the same story.
import { possibleUses } from './analysis.js';
import { IGNORE_FOR_GAPS, cooldownFor } from './cooldowns.js';
import { gearFrom, statsFrom, survivalFrom } from './dashboard.js';
import type { FightPack } from './pack.js';
import { detailRows, num, rankingRows } from './tables.js';
import { deathRecaps, dotsFor, manaFor, mitigationFor, potionsFor, raidDebuffs } from './insights.js';
import type { DeathRecap, DotUptime, GearItem, ManaInfo, Mitigation, PotionUse, RaidDebuff } from './types.js';

export interface PlayerDigest {
  id: number;
  name: string;
  server: string | null;
  className: string;
  specName: string;
  role: 'tank' | 'healer' | 'dps';
  total: number;
  dps: number;
  parse: number | null;
  itemLevel: number | null;
  activePct: number | null;
  abilities: { name: string; total: number }[];
  casts: { name: string; count: number }[];
  cooldowns: { name: string; uses: number; possible: number }[];
  deaths: DeathRecap[];
  taken: number;
  avoidable: number;
  avoidableTop: { name: string; total: number }[];
  gear?: GearItem[];
  stats?: { name: string; value: string }[];
  /** Healing for the fight, for anyone who healed. */
  healing?: {
    total: number;
    hps: number;
    overhealPct: number | null;
    /** Healing parse, for healers. */
    parse: number | null;
    activePct: number | null;
    abilities: { name: string; total: number; overhealPct: number | null }[];
  };
  /** From v0.25.0, once the fight has been read in full. */
  potions?: PotionUse;
  dots?: DotUptime[];
  mana?: Omit<ManaInfo, 'series'>;
  mitigation?: Mitigation;
}

/** Bump when what's in a digest changes; stored digests are then worked out again from the stored fight. */
export const DIGEST_VERSION = 7; // 7: potions, DoTs, mana, mitigation, death recaps, boss debuffs; 6: from stored fights; 5: healing; 4: pet damage as "<pet> (pet)"; 3: roles

export interface FightDigest {
  v?: number;
  id: number;
  name: string;
  encounterID: number;
  kill: boolean;
  startTime: number;
  endTime: number;
  seconds: number;
  players: PlayerDigest[];
  /** Debuffs the raid kept on the boss (once read in full). */
  debuffs?: RaidDebuff[];
}

/** A healer on this fight: healing well above their damage. Their DM pages are about healing. */
export const healsMost = (p: PlayerDigest) => !!p.healing && p.healing.total > 2 * p.total;

/** Last resort when Warcraft Logs doesn't say: guess the role from the spec name. GAME CONTENT */
function roleFromSpec(spec: string | undefined): PlayerDigest['role'] {
  const s = (spec ?? '').toLowerCase();
  if (/protection|guardian|blood|brewmaster/.test(s)) return 'tank';
  if (/holy|restoration|discipline|mistweaver/.test(s)) return 'healer';
  return 'dps';
}

/**
 * A player's damage by ability from the fight-wide table. Their pets come as separate totals; they're
 * listed as "<pet name> (pet)" so pet damage isn't mistaken for the player's own (skipped when the
 * pet's damage is already counted in the abilities, so nothing is counted twice).
 */
function withPets(e: any): { name: string; total: number }[] {
  const own = ((e.abilities ?? []) as any[]).filter((a) => a?.name && num(a.total) > 0).map((a) => ({ name: String(a.name), total: num(a.total) }));
  const pets = ((e.pets ?? []) as any[]).filter((p) => p?.name && num(p.total) > 0).map((p) => ({ name: `${p.name} (pet)`, total: num(p.total) }));
  const ownSum = own.reduce((t, a) => t + a.total, 0);
  const petSum = pets.reduce((t, a) => t + a.total, 0);
  return pets.length && ownSum + petSum <= num(e.total) * 1.02 ? [...own, ...pets] : own;
}

/** One player's healing from the fight-wide healing table (undefined when they didn't heal). */
function healingOf(e: any, rows: Map<number, any>, ranks: any[], seconds: number): PlayerDigest['healing'] {
  const h = rows.get(e.id);
  const total = num(h?.total);
  if (!total) return undefined;
  const over = num(h.overheal);
  const rank = ranks.find((r) => r.name === e.name);
  return {
    total,
    hps: total / (seconds || 1),
    overhealPct: total + over ? Math.round((over / (total + over)) * 1000) / 10 : null,
    parse: typeof rank?.rankPercent === 'number' ? rank.rankPercent : null,
    activePct: typeof h.activeTime === 'number' && seconds > 0 ? Math.round(Math.min(100, (h.activeTime / (seconds * 1000)) * 100) * 10) / 10 : null,
    abilities: ((h.abilities ?? []) as any[])
      .filter((a) => a?.name && num(a.total) > 0)
      .map((a) => ({ name: String(a.name), total: num(a.total), overhealPct: num(a.total) + num(a.overheal) ? Math.round((num(a.overheal) / (num(a.total) + num(a.overheal))) * 1000) / 10 : null }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
  };
}

export function digestFromPack(host: string, pack: FightPack): FightDigest {
  const { fight, t } = pack;
  const seconds = (fight.endTime - fight.startTime) / 1000;
  const rankRows = rankingRows(t.rankings);
  const roleOf = new Map<number, PlayerDigest['role']>();
  const d = t.details?.data?.playerDetails ?? {};
  for (const [key, role] of [['tanks', 'tank'], ['healers', 'healer'], ['dps', 'dps']] as const) for (const p of (d[key] ?? []) as any[]) roleOf.set(p.id, role);
  // Backup for roles: the rankings group players the same way
  const rankRoles = new Map<string, PlayerDigest['role']>();
  const rr = t.rankings?.data?.[0]?.roles ?? {};
  for (const [key, role] of [['tanks', 'tank'], ['healers', 'healer'], ['dps', 'dps']] as const) for (const c of (rr[key]?.characters ?? []) as any[]) if (c?.name) rankRoles.set(c.name, role);
  const detail = detailRows(t.details);
  const tankIds = [...roleOf].filter(([, r]) => r === 'tank').map(([id]) => id);
  const castsBy = new Map<number, any>((t.casts?.data?.entries ?? []).map((e: any) => [e.id, e]));
  const deathEntries: any[] = t.deaths?.data?.entries ?? [];

  // Everyone in the fight: the damage table leaves out players who did no damage (often healers),
  // so add anyone listed in the player details or the casts table too.
  const entries: any[] = (t.damage?.data?.entries ?? []).filter((e: any) => e && e.type !== 'Pet' && e.type !== 'NPC');
  const seen = new Set(entries.map((e) => e.id));
  for (const det of detail) {
    if (!det?.id || seen.has(det.id)) continue;
    seen.add(det.id);
    entries.push({ id: det.id, name: det.name, type: det.type, icon: `${det.type}-${det.specs?.[0]?.spec ?? ''}`, total: 0 });
  }
  for (const c of castsBy.values()) {
    if (!c?.id || seen.has(c.id) || c.type === 'Pet' || c.type === 'NPC') continue;
    seen.add(c.id);
    entries.push({ id: c.id, name: c.name, type: c.type, icon: c.icon ?? c.type, total: 0 });
  }
  const raidIds = entries.map((e) => e.id);
  // Healing: everyone's from one fight-wide table, parses from the healing rankings
  const healRows = new Map<number, any>(((t.healing?.data?.entries ?? []) as any[]).filter((e) => e?.id && e.type !== 'Pet' && e.type !== 'NPC').map((e) => [e.id, e]));
  const hpsRanks = rankingRows(t.hps);
  const recaps = deathRecaps(pack);
  const players = entries.map((e): PlayerDigest => {
    const rank = rankRows.find((r) => r.name === e.name);
    const det = detail.find((x) => x.id === e.id || x.name === e.name);
    const [iconClass, iconSpec] = String(e.icon ?? '').split('-');
    const castEntry = castsBy.get(e.id);
    const castList: { name: string; count: number }[] = ((castEntry?.abilities ?? []) as any[])
      .filter((a) => a?.name && !IGNORE_FOR_GAPS.has(a.name))
      .map((a) => ({ name: String(a.name), count: num(a.total) }))
      .sort((a, b) => b.count - a.count);
    const sv = survivalFrom(t.taken, e.id, tankIds, raidIds);
    const ilvl = Number(det?.maxItemLevel ?? det?.minItemLevel ?? 0);
    // Gear with item names once the whole fight has been read; until then, what the pull recorded
    const gear = pack.full?.players[e.id]?.gear ?? (det?.combatantInfo?.gear ? gearFrom(det.combatantInfo.gear) : undefined);
    return {
      id: e.id,
      name: e.name,
      server: det?.server ?? rank?.server?.name ?? null,
      className: rank?.class ?? iconClass ?? e.type ?? '',
      specName: rank?.spec ?? det?.specs?.[0]?.spec ?? iconSpec ?? '',
      role: roleOf.get(e.id) ?? rankRoles.get(e.name) ?? roleFromSpec(rank?.spec ?? det?.specs?.[0]?.spec ?? iconSpec),
      total: num(e.total),
      dps: num(e.total) / (seconds || 1),
      parse: typeof rank?.rankPercent === 'number' ? rank.rankPercent : null,
      itemLevel: ilvl > 0 ? ilvl : null,
      activePct: typeof e.activeTime === 'number' && seconds > 0 ? Math.round((e.activeTime / (seconds * 1000)) * 1000) / 10 : null,
      abilities: withPets(e).sort((a, b) => b.total - a.total).slice(0, 10),
      casts: castList.slice(0, 12),
      cooldowns: castList
        .filter((c) => cooldownFor(c.name, host) !== undefined)
        .map((c) => ({ name: c.name, uses: c.count, possible: possibleUses(seconds, cooldownFor(c.name, host)!) })),
      deaths: recaps.get(e.id) ?? deathEntries
        .filter((x) => x.name === e.name)
        .map((x) => ({ seconds: Math.round((num(x.deathTime ?? x.timestamp) - fight.startTime) / 1000), by: x.killingBlow?.name ?? x.ability?.name ?? 'Unknown' })),
      taken: sv?.total ?? 0,
      avoidable: sv?.avoidableTotal ?? 0,
      avoidableTop: (sv?.abilities ?? []).filter((a) => a.avoidable).slice(0, 3).map((a) => ({ name: a.name, total: a.total })),
      gear: gear?.length ? gear : undefined,
      stats: det?.combatantInfo?.stats ? statsFrom(det.combatantInfo.stats) : undefined,
      healing: healingOf(e, healRows, hpsRanks, seconds),
      ...extras(pack, e.id),
    };
  });

  const debuffs = raidDebuffs(pack);
  return { v: DIGEST_VERSION, id: fight.id, name: fight.name, encounterID: fight.encounterID, kill: !!fight.kill, startTime: fight.startTime, endTime: fight.endTime, seconds, players, ...(debuffs ? { debuffs } : {}) };
}

/** Potions, DoTs, mana and mitigation, once the fight has been read in full. */
function extras(pack: FightPack, id: number): Partial<PlayerDigest> {
  if (!pack.full?.players[id]) return {};
  const mana = manaFor(pack, id);
  const out: Partial<PlayerDigest> = {};
  const potions = potionsFor(pack, id);
  if (potions) out.potions = potions;
  const dots = dotsFor(pack, id);
  if (dots?.length) out.dots = dots;
  if (mana) out.mana = { endPct: mana.endPct, lowSeconds: mana.lowSeconds, oomAt: mana.oomAt };
  const mitigation = mitigationFor(pack, id);
  if (mitigation) out.mitigation = mitigation;
  return out;
}
