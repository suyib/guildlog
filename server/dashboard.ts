// Turns raw Warcraft Logs data into the personal dashboard shown when nothing is compared.
import type { Dashboard, GearItem } from './types.js';
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
 * DPS over the fight. Warcraft Logs returns damage in evenly spaced buckets; the series is
 * smoothed over a few buckets and scaled so its average equals the player's real DPS,
 * which keeps the units right whichever way Warcraft Logs reports the buckets.
 */
function dpsSeriesFrom(graph: any, fightSeconds: number, dps: number): Dashboard['dpsSeries'] {
  const series: any[] = graph?.data?.series ?? graph?.series ?? [];
  if (!series.length) return [];
  const total = series.find((s) => /^total$/i.test(String(s.name)));
  const used = total ? [total] : series.filter((s) => Array.isArray(s.data));
  const len = Math.max(...used.map((s) => s.data?.length ?? 0));
  if (len < 2) return [];
  const raw = Array.from({ length: len }, (_, i) =>
    used.reduce((t, s) => {
      const p = s.data?.[i];
      return t + (Array.isArray(p) ? Number(p[1]) || 0 : Number(p) || 0);
    }, 0),
  );
  const w = Math.max(1, Math.round(len / 40)); // ~40 smoothing windows across the fight
  const smooth = raw.map((_, i) => {
    const a = Math.max(0, i - w);
    const b = Math.min(len, i + w + 1);
    return raw.slice(a, b).reduce((t, v) => t + v, 0) / (b - a);
  });
  const mean = smooth.reduce((t, v) => t + v, 0) / len;
  const scale = mean > 0 && dps > 0 ? dps / mean : 1;
  return smooth.map((v, i) => ({ t: Math.round((i / (len - 1)) * fightSeconds), dps: Math.round(v * scale) }));
}

export async function buildDashboard(host: string, code: string, fightId: number, sourceId: number, fightSeconds: number, dps: number): Promise<Dashboard> {
  const raw = await getDashboardRaw(host, code, fightId, sourceId);
  const summaryGear: any[] = raw.summary?.data?.gear ?? raw.summary?.gear ?? [];
  const combatGear: any[] = raw.combatant?.gear ?? [];
  // The summary table usually has item and enchant names; combatant info is the fallback.
  const byId = new Map(combatGear.filter((g) => g?.id).map((g) => [g.id, g]));
  const merged = (summaryGear.length ? summaryGear : combatGear).map((g) => ({ ...(byId.get(g?.id) ?? {}), ...g }));
  return {
    gear: gearFrom(merged),
    stats: statsFrom(raw.combatant?.stats ?? raw.summary?.data?.stats),
    dpsSeries: dpsSeriesFrom(raw.graph, fightSeconds, dps),
  };
}
