// Potions, damage-over-time uptime, mana, tank mitigation, boss debuffs and death recaps, worked out
// from a stored fight (no Warcraft Logs requests). Shared by the site's analysis, the whole-raid
// breakdown and the Discord DMs, so they all say the same thing.
import { MAINTENANCE, NOT_A_DOT, isPotion } from './gameData.js';
import type { FightPack } from './pack.js';
import { num } from './tables.js';
import type { DeathRecap, DotUptime, ManaInfo, Mitigation, PotionUse, RaidDebuff } from './types.js';

const nameOf = (pack: FightPack, id: number) => pack.full?.names[id]?.[0] ?? `Spell ${id}`;
const seconds = (pack: FightPack) => (pack.fight.endTime - pack.fight.startTime) / 1000;

/** Potions used in the fight, and whether one was running at the pull. Undefined until the fight has been read in full. */
export function potionsFor(pack: FightPack, id: number): PotionUse | undefined {
  const p = pack.full?.players[id];
  if (!p) return undefined;
  const used = p.casts.filter(([, a]) => isPotion(a, nameOf(pack, a))).map(([t, a]) => ({ name: nameOf(pack, a), seconds: Math.round(t / 100) }));
  // A potion's buff already up in the first 1.5 seconds was drunk before the pull
  const prePot = p.buffs.auras.some(([a, , , bands]) => isPotion(a, nameOf(pack, a)) && (bands ?? []).some(([s]) => s <= 1_500) && !used.some((u) => u.seconds <= 2));
  return { used, prePot };
}

/** Damage-over-time spells that are at least 3% of the player's damage, with their uptime. */
export function dotsFor(pack: FightPack, id: number): DotUptime[] | undefined {
  const p = pack.full?.players[id];
  if (!p?.dots) return undefined;
  const total = p.dmg.reduce((t, r) => t + r[1], 0) || 1;
  return p.dots
    .map(([a, permille]) => ({ name: nameOf(pack, a), uptimePct: Math.round(permille / 10), sharePct: Math.round(((p.dmg.find((r) => r[0] === a)?.[1] ?? 0) / total) * 100) }))
    .filter((d) => !NOT_A_DOT.has(d.name) && d.sharePct >= 3)
    .sort((x, y) => y.sharePct - x.sharePct);
}

/** Mana across the fight (gaps filled from the last known value). */
export function manaFor(pack: FightPack, id: number): ManaInfo | undefined {
  const raw = pack.full?.players[id]?.mana;
  if (!raw || !raw.some((v) => v >= 0)) return undefined;
  const filled: number[] = [];
  let last = raw.find((v) => v >= 0)!;
  for (const v of raw) filled.push((last = v >= 0 ? v : last));
  const total = seconds(pack);
  const oomIndex = filled.findIndex((v, i) => v < 5 && (i + 1) * 5 < total * 0.9);
  return {
    series: filled.map((pct, i) => ({ t: i * 5, pct })),
    endPct: filled.at(-1) ?? null,
    lowSeconds: filled.filter((v) => v < 10).length * 5,
    oomAt: oomIndex >= 0 ? oomIndex * 5 : null,
  };
}

/** The boss's melee swings at this player (tanks): dodged, parried, missed, blocked and crits. */
export function mitigationFor(pack: FightPack, id: number): Mitigation | undefined {
  const m = pack.full?.players[id]?.mit;
  if (!m) return undefined;
  const [swings, dodged, parried, missed, blocked, crits] = m;
  return { swings, dodged, parried, missed, blocked, crits, avoidPct: swings ? Math.round(((dodged + parried + missed) / swings) * 1000) / 10 : 0 };
}

/** Each player's deaths with the 10 seconds before them. */
export function deathRecaps(pack: FightPack): Map<number, DeathRecap[]> {
  const out = new Map<number, DeathRecap[]>();
  const recaps = pack.full?.deaths ?? [];
  for (const d of (pack.t.deaths?.data?.entries ?? []) as any[]) {
    const at = num(d.deathTime ?? d.timestamp);
    const r = recaps.find((x) => x.id === d.id && Math.abs(x.at * 10 + pack.fight.startTime - at) < 50);
    const death: DeathRecap = {
      seconds: Math.round((at - pack.fight.startTime) / 1000),
      by: d.killingBlow?.name ?? d.ability?.name ?? 'Unknown',
      ...(r ? {
        hits: r.hits.map(([t, a, amount, from]) => ({ t: Math.round(Number(t) / 10) / 10, name: nameOf(pack, Number(a)), amount: Number(amount), from: String(from) })),
        healed: r.healed,
      } : {}),
    };
    out.set(d.id, [...(out.get(d.id) ?? []), death]);
  }
  return out;
}

/** Debuffs the raid kept on the boss, by effect: only those someone applied in this fight. */
export function raidDebuffs(pack: FightPack): RaidDebuff[] | undefined {
  if (!pack.t.debuffs) return undefined;
  const ms = pack.fight.endTime - pack.fight.startTime || 1;
  const out: RaidDebuff[] = [];
  for (const g of MAINTENANCE) {
    const up = pack.t.debuffs.filter((a: any) => g.names.includes(String(a.name))).map((a: any) => num(a.totalUptime));
    if (!up.length) continue;
    out.push({ label: g.label, uptimePct: Math.min(100, Math.round((Math.max(...up) / ms) * 100)) });
  }
  return out;
}

/** A short line for a death recap: "Cave In 8k, Melee 4k · healed 2k in the last 10s". */
export function recapLine(d: DeathRecap, compact: (v: number) => string): string {
  if (!d.hits?.length) return '';
  const byAbility = new Map<string, number>();
  for (const h of d.hits) byAbility.set(h.name, (byAbility.get(h.name) ?? 0) + h.amount);
  const top = [...byAbility].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${compact(v)}`);
  return `${top.join(', ')} · healed ${compact(d.healed ?? 0)} in the last 10s`;
}
