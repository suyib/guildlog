// Turns raw Warcraft Logs data into the personal dashboard shown when nothing is compared.
import type { Dashboard, GearItem, Survival } from './types.js';
import { getDashboardRaw } from './wcl.js';

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

function gearFrom(raw: any[]): GearItem[] {
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

function statsFrom(raw: Record<string, any> | null | undefined): Dashboard['stats'] {
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
 * DPS over the fight, built from the player's own damage events: damage is added up per second,
 * then averaged over a 5-second window (like Warcraft Logs' graph). Pet damage isn't in these
 * events, so the line is scaled so its average matches the player's real DPS.
 */
export function dpsSeriesFrom(events: { timestamp: number; amount: number }[], start: number, fightSeconds: number, dps: number): Dashboard['dpsSeries'] {
  const secs = Math.max(1, Math.ceil(fightSeconds));
  if (events.length < 3 || secs < 3) return [];
  const perSecond = new Array<number>(secs).fill(0);
  for (const e of events) {
    const i = Math.floor((e.timestamp - start) / 1000);
    if (i >= 0 && i < secs) perSecond[i] += e.amount;
  }
  const half = 2;
  const smooth = perSecond.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(secs, i + half + 1);
    return perSecond.slice(a, b).reduce((t, v) => t + v, 0) / (b - a);
  });
  const mean = smooth.reduce((t, v) => t + v, 0) / secs;
  const scale = mean > 0 && dps > 0 ? dps / mean : 1;
  return smooth.map((v, i) => ({ t: i, dps: Math.round(v * scale) }));
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

export async function buildDashboard(host: string, code: string, fightId: number, sourceId: number, fightSeconds: number, dps: number, start: number, end: number): Promise<Dashboard> {
  const raw = await getDashboardRaw(host, code, fightId, sourceId, start, end);
  const summaryGear: any[] = raw.summary?.data?.gear ?? raw.summary?.gear ?? [];
  const combatGear: any[] = raw.combatant?.gear ?? [];
  // The summary table usually has item and enchant names; combatant info is the fallback.
  const byId = new Map(combatGear.filter((g) => g?.id).map((g) => [g.id, g]));
  const merged = (summaryGear.length ? summaryGear : combatGear).map((g) => ({ ...(byId.get(g?.id) ?? {}), ...g }));
  return {
    gear: gearFrom(merged),
    stats: statsFrom(raw.combatant?.stats ?? raw.summary?.data?.stats),
    dpsSeries: dpsSeriesFrom(raw.damageEvents, start, fightSeconds, dps),
    survival: survivalFrom(raw.taken, sourceId, raw.tankIds, raw.raidIds),
  };
}
