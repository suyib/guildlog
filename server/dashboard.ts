// Turns raw Warcraft Logs data into the personal dashboard shown when nothing is compared.
import type { FightPack } from './pack.js';
import { detailRoles, num as num0, rankingRows } from './tables.js';
import type { Dashboard, GearItem, Healing, HealingAbility, SeriesPoint, Survival } from './types.js';
import type { AmountEvent } from './wcl.js';

const SLOT_NAMES = [
  'Head', 'Neck', 'Shoulder', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrist', 'Hands',
  'Ring', 'Ring', 'Trinket', 'Trinket', 'Back', 'Main hand', 'Off hand', 'Ranged', 'Tabard',
];
const COSMETIC = new Set([3, 18]); // shirt, tabard
/** Slots that can normally take a permanent enchant. */
const ENCHANTABLE = new Set([0, 2, 4, 6, 7, 8, 9, 14, 15, 17]);

const STAT_ORDER = [
  'Strength', 'Agility', 'Stamina', 'Intellect', 'Spirit',
  'Attack Power', 'Ranged Attack Power', 'Spell Power', 'Healing',
  'Crit', 'Spell Crit', 'Hit', 'Spell Hit', 'Haste', 'Spell Haste', 'Expertise', 'Armor Penetration',
  'Mp5', 'Armor', 'Defense', 'Dodge', 'Parry', 'Block', 'Resilience',
];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function gearFrom(raw: any[]): GearItem[] {
  return raw
    .map((g: any, i: number): GearItem | null => {
      const slot = typeof g?.slot === 'number' ? g.slot : i;
      if (!g || !g.id || COSMETIC.has(slot)) return null;
      const enchantId = num(g.permanentEnchant);
      return {
        slot,
        slotName: SLOT_NAMES[slot] ?? `Slot ${slot}`,
        id: g.id,
        name: typeof g.name === 'string' && g.name ? g.name : null,
        icon: typeof g.icon === 'string' ? g.icon : null,
        itemLevel: num(g.itemLevel),
        quality: num(g.quality),
        enchant: typeof g.permanentEnchantName === 'string' && g.permanentEnchantName ? g.permanentEnchantName : null,
        enchantId: enchantId && enchantId > 0 ? enchantId : null,
        enchantable: ENCHANTABLE.has(slot),
        gems: (Array.isArray(g.gems) ? g.gems : [])
          .filter((x: any) => x?.id)
          .map((x: any) => ({ id: x.id, icon: typeof x.icon === 'string' ? x.icon : null, itemLevel: num(x.itemLevel) })),
      };
    })
    .filter((g): g is GearItem => g !== null)
    .sort((a, b) => a.slot - b.slot);
}

export function statsFrom(raw: Record<string, any> | null | undefined): Dashboard['stats'] {
  if (!raw || typeof raw !== 'object') return [];
  const rows = Object.entries(raw)
    .map(([name, v]) => {
      const min = num(v?.min ?? v);
      const max = num(v?.max ?? v);
      if (min === null && max === null) return null;
      const lo = Math.round(min ?? max!);
      const hi = Math.round(max ?? min!);
      return { name, value: lo === hi ? lo.toLocaleString('en-US') : `${lo.toLocaleString('en-US')}–${hi.toLocaleString('en-US')}` };
    })
    .filter((r): r is { name: string; value: string } => r !== null && r.value !== '0');
  const rank = (n: string) => (STAT_ORDER.indexOf(n) === -1 ? 999 : STAT_ORDER.indexOf(n));
  return rows.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/**
 * Per-second values across the fight from individual events, smoothed over 5 seconds and scaled
 * so the line averages the real figure. With `notes`, each point names what contributed most
 * around then (used for "what hit you" on damage taken).
 */
export function seriesFrom(events: AmountEvent[], start: number, fightSeconds: number, average: number, notes = false): SeriesPoint[] {
  const secs = Math.max(1, Math.ceil(fightSeconds));
  if (events.length < 3 || secs < 3) return [];
  const perSecond = new Array<number>(secs).fill(0);
  const byAbility: Map<string, number>[] = notes ? Array.from({ length: secs }, () => new Map()) : [];
  for (const e of events) {
    const i = Math.floor((e.timestamp - start) / 1000);
    if (i < 0 || i >= secs) continue;
    perSecond[i] += e.amount;
    if (notes && e.ability) byAbility[i].set(e.ability, (byAbility[i].get(e.ability) ?? 0) + e.amount);
  }
  return seriesFromSeconds(perSecond, average, notes ? byAbility : undefined);
}

/** The same line from amounts already added up per second (as stored for each fight). */
export function seriesFromSeconds(perSecond: number[], average: number, byAbility?: Map<string, number>[]): SeriesPoint[] {
  const secs = perSecond.length;
  if (secs < 3 || !perSecond.some((v) => v > 0)) return [];
  const half = 2;
  const smooth = perSecond.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(secs, i + half + 1);
    return perSecond.slice(a, b).reduce((t, v) => t + v, 0) / (b - a);
  });
  const mean = smooth.reduce((t, v) => t + v, 0) / secs;
  const scale = mean > 0 && average > 0 ? average / mean : 1;
  return smooth.map((v, i) => {
    const point: SeriesPoint = { t: i, dps: Math.round(v * scale) };
    if (byAbility) {
      // The biggest hitter within the same 5-second window the line is smoothed over
      const window = new Map<string, number>();
      for (let j = Math.max(0, i - half); j < Math.min(secs, i + half + 1); j++) for (const [n, a] of byAbility[j] ?? []) window.set(n, (window.get(n) ?? 0) + a);
      const top = [...window].sort((x, y) => y[1] - x[1])[0];
      if (top) point.note = `Mostly ${top[0]}`;
    }
    return point;
  });
}

/** What healingFrom reads: the player's healing by spell, everyone's healing table, the healing rankings, and healing per second. */
export interface HealingRaw { mine: any; everyone: any; rankings: any; perSecond?: number[] }

/** The player's healing: totals, overheal, parse, place among the raid's healers, and by spell. */
export function healingFrom(raw: HealingRaw | undefined, sourceId: number, fightSeconds: number): Healing | undefined {
  if (!raw) return undefined;
  const entries: any[] = raw.mine?.data?.entries ?? [];
  const total = entries.reduce((t, e) => t + num0(e?.total), 0);
  if (!total) return undefined;
  const overheal = entries.reduce((t, e) => t + num0(e?.overheal), 0);
  const abilities: HealingAbility[] = entries
    .filter((e) => num0(e?.total) > 0 || num0(e?.overheal) > 0)
    .map((e) => {
      const hits = num0(e.hitCount) + num0(e.tickCount);
      const crits = num0(e.critHitCount) + num0(e.critTickCount);
      const t = num0(e.total);
      const o = num0(e.overheal);
      return {
        name: String(e.name ?? 'Unknown'),
        id: num0(e.guid),
        total: t,
        share: t / total,
        overheal: o,
        overhealPct: t + o ? Math.round((o / (t + o)) * 1000) / 10 : null,
        casts: num0(e.uses),
        hits,
        critPct: hits ? Math.round((crits / hits) * 1000) / 10 : null,
        avgHeal: hits ? Math.round(t / hits) : null,
        isPet: e.type === 'Pet' || (e.petOwner ?? null) !== null,
        icon: typeof e.abilityIcon === 'string' ? e.abilityIcon : undefined,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Everyone's healing: my active time, and where I placed among the healers
  const everyone: any[] = (raw.everyone?.data?.entries ?? []).filter((e: any) => e && e.type !== 'Pet' && e.type !== 'NPC');
  const meRow = everyone.find((e) => e.id === sourceId);
  const ranks = rankingRows(raw.rankings);
  const myName = meRow?.name;
  const myRank = ranks.find((r) => r.name === myName);
  const healerNames = new Set(((raw.rankings?.data?.[0]?.roles?.healers?.characters ?? []) as any[]).map((c) => c?.name));
  const pool = everyone.filter((e) => (healerNames.size ? healerNames.has(e.name) || e.id === sourceId : num0(e.total) > 0));
  const sorted = [...pool].sort((a, b) => num0(b.total) - num0(a.total));
  const place = sorted.findIndex((e) => e.id === sourceId) + 1;
  const seconds = fightSeconds || 1;
  return {
    total,
    hps: total / seconds,
    overheal,
    overhealPct: total + overheal ? Math.round((overheal / (total + overheal)) * 1000) / 10 : null,
    parse: typeof myRank?.rankPercent === 'number' ? myRank.rankPercent : null,
    activePct: typeof meRow?.activeTime === 'number' ? Math.round(Math.min(100, (meRow.activeTime / (seconds * 1000)) * 100) * 10) / 10 : null,
    rank: place > 0 ? { place, of: sorted.length } : null,
    abilities,
    hpsSeries: raw.perSecond ? seriesFromSeconds(raw.perSecond, total / seconds) : [],
  };
}

const MELEE = /^(melee|auto attack|attack)$/i;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Damage taken by the player, set against the rest of the raid. An ability counts as
 * "likely avoidable" when it hit fewer than half of the non-tanks: raid-wide damage hits
 * everyone, while things you can step out of only hit the people who stood in them.
 */
export function survivalFrom(taken: any, sourceId: number, tankIds: number[], raidIds: number[]): Survival | undefined {
  const entries: any[] = (taken?.data?.entries ?? taken?.entries ?? []).filter((e: any) => e && e.type !== 'Pet' && e.type !== 'NPC');
  const me = entries.find((e) => e.id === sourceId);
  if (!entries.length || !me || !Array.isArray(me.abilities)) return undefined;

  const tanks = new Set(tankIds);
  const raid = new Set([...raidIds, ...entries.map((e) => e.id)]);
  const nonTanks = [...raid].filter((id) => !tanks.has(id));
  const byAbility = new Map<string, { icon?: string; hits: Map<number, number> }>();
  for (const e of entries) {
    for (const a of (e.abilities ?? []) as any[]) {
      if (!a?.name || !(Number(a.total) > 0)) continue;
      const row = byAbility.get(a.name) ?? { icon: a.abilityIcon ?? a.icon, hits: new Map<number, number>() };
      row.hits.set(e.id, (row.hits.get(e.id) ?? 0) + Number(a.total));
      byAbility.set(a.name, row);
    }
  }

  const abilities: Survival['abilities'] = ((me.abilities ?? []) as any[])
    .filter((a) => a?.name && Number(a.total) > 0)
    .map((a) => {
      const row = byAbility.get(a.name)!;
      const hitIds = [...row.hits.keys()];
      const nonTankHits = hitIds.filter((id) => !tanks.has(id)).length;
      const tankOnly = nonTankHits === 0;
      return {
        name: a.name,
        icon: typeof row.icon === 'string' ? row.icon : undefined,
        total: Number(a.total),
        playersHit: hitIds.length,
        raidSize: raid.size,
        raidMedian: Math.round(median([...row.hits.values()])),
        avoidable: !MELEE.test(a.name) && !tankOnly && nonTanks.length >= 3 && nonTankHits / nonTanks.length < 0.5,
      };
    })
    .sort((a, b) => b.total - a.total);

  const totals = entries.map((e) => Number(e.total) || 0);
  const nonTankTotals = entries.filter((e) => !tanks.has(e.id)).map((e) => Number(e.total) || 0);
  const myTotal = Number(me.total) || 0;
  return {
    total: myTotal,
    avoidableTotal: abilities.filter((a) => a.avoidable).reduce((t, a) => t + a.total, 0),
    raidMedianTotal: Math.round(median(tanks.has(sourceId) ? totals : nonTankTotals)),
    rank: 1 + (tanks.has(sourceId) ? totals : nonTankTotals).filter((t) => t < myTotal).length,
    compared: (tanks.has(sourceId) ? totals : nonTankTotals).length,
    isTank: tanks.has(sourceId),
    abilities,
  };
}

/** One player's healing by spell, in the shape of Warcraft Logs' healing table, from a stored fight. */
export function healingTableFromPack(pack: FightPack, sourceId: number) {
  const p = pack.full?.players[sourceId];
  const names = pack.full?.names ?? {};
  const uses = new Map<number, number>();
  for (const [, a] of p?.casts ?? []) uses.set(a, (uses.get(a) ?? 0) + 1);
  return {
    data: {
      entries: (p?.heal ?? []).map(([id, total, overheal, hits, crits]) => ({
        name: names[id]?.[0] ?? `Spell ${id}`, guid: id, total, overheal, hitCount: hits, critHitCount: crits, uses: uses.get(id) ?? 0, abilityIcon: names[id]?.[1],
      })),
    },
  };
}

/** The player's healing for a stored fight, or undefined if they didn't heal. */
export function healingFromPack(pack: FightPack, sourceId: number, withLine: boolean): Healing | undefined {
  const seconds = (pack.fight.endTime - pack.fight.startTime) / 1000;
  const p = pack.full?.players[sourceId];
  // Before the whole fight has been read, the fight-wide table gives the totals by spell
  const mine = p ? healingTableFromPack(pack, sourceId) : { data: { entries: ((pack.t.healing?.data?.entries ?? []) as any[]).find((e) => e.id === sourceId)?.abilities ?? [] } };
  return healingFrom({ mine, everyone: pack.t.healing, rankings: pack.t.hps, perSecond: withLine ? p?.hb : undefined }, sourceId, seconds);
}

/** The personal dashboard (gear, stats, lines over time, survival, healing) from a stored fight. */
export function dashboardFromPack(pack: FightPack, sourceId: number): Dashboard {
  const seconds = (pack.fight.endTime - pack.fight.startTime) / 1000 || 1;
  const roles = detailRoles(pack.t.details);
  const everyone = [...roles.tanks, ...roles.healers, ...roles.dps];
  const det = everyone.find((x) => x.id === sourceId);
  const p = pack.full?.players[sourceId];
  const names = pack.full?.names ?? {};
  const survival = survivalFrom(pack.t.taken, sourceId, roles.tanks.map((x) => x.id), everyone.map((x) => x.id));
  const row = ((pack.t.damage?.data?.entries ?? []) as any[]).find((e) => e.id === sourceId);
  // Damage taken per second, with what hit hardest each second
  const secs = Math.max(1, Math.ceil(seconds));
  const taken = new Array<number>(secs).fill(0);
  const byAbility: Map<string, number>[] = Array.from({ length: secs }, () => new Map());
  for (const [s, id, amount] of p?.tb ?? []) {
    if (s < 0 || s >= secs) continue;
    taken[s] += amount;
    const n = names[id]?.[0] ?? 'Unknown';
    byAbility[s].set(n, (byAbility[s].get(n) ?? 0) + amount);
  }
  return {
    gear: p?.gear?.length ? p.gear : gearFrom(det?.combatantInfo?.gear ?? []),
    stats: statsFrom(det?.combatantInfo?.stats),
    dpsSeries: p ? seriesFromSeconds(p.db, num0(row?.total) / seconds) : [],
    survival,
    healing: healingFromPack(pack, sourceId, true),
    // Scaled to the damage taken the table reports, so the line matches the Survival numbers
    takenSeries: p ? seriesFromSeconds(taken, survival ? survival.total / seconds : 0, byAbility) : [],
  };
}
