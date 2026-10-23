// Whole-raid breakdown of one fight: everyone's damage and healing, deaths, damage taken by ability,
// Bloodlust timing, interrupts and dispels. Worked out from the stored fight (see pack.ts), the
// same one the Discord bot reads, so the site and Discord always agree.
import { seriesFromSeconds } from './dashboard.js';
import { digestFromPack } from './fightDigest.js';
import type { FightPack } from './pack.js';
import { raidFeedback } from './raidFeedback.js';
import { num, rankingRows } from './tables.js';
import type { FightBreakdown } from './types.js';

const MELEE = /^(melee|auto attack|attack)$/i;

export function breakdownFromPack(host: string, pack: FightPack): FightBreakdown {
  const ref = pack.fight;
  const digest = digestFromPack(host, pack);
  const heal = { healing: pack.t.healing, taken: pack.t.taken };
  const seconds = (ref.endTime - ref.startTime) / 1000 || 1;
  // Healing per player. Pets and totems are added to their owner when Warcraft Logs lists them separately.
  const healBy = new Map<number, { total: number; overheal: number; name: string; type: string }>();
  for (const e of (heal.healing?.data?.entries ?? []) as any[]) {
    if (!e?.id || e.type === 'NPC') continue;
    const owner = e.type === 'Pet' ? num(e.petOwner) || null : e.id;
    if (!owner) continue;
    const row = healBy.get(owner) ?? { total: 0, overheal: 0, name: e.type === 'Pet' ? '' : e.name, type: e.type === 'Pet' ? '' : e.type };
    row.total += num(e.total);
    row.overheal += num(e.overheal);
    if (e.type !== 'Pet') { row.name = e.name; row.type = e.type; }
    healBy.set(owner, row);
  }
  // Anyone who only healed and is missing from the summary (rare) still gets a row
  for (const [id, h] of healBy) {
    if (!h.name || digest.players.some((p) => p.id === id)) continue;
    digest.players.push({
      id, name: h.name, server: null, className: h.type, specName: '', role: 'healer', total: 0, dps: 0, parse: null, itemLevel: null, activePct: null,
      abilities: [], casts: [], cooldowns: [], deaths: [], taken: 0, avoidable: 0, avoidableTop: [],
    });
  }
  const hpsParse = new Map(rankingRows(pack.t.hps).map((r: any) => [r.name, r.rankPercent]));
  const interrupts = new Map(Object.entries(pack.t.interrupts ?? {}));
  const dispels = new Map(Object.entries(pack.t.dispels ?? {}));

  const players = digest.players.map((p) => {
    const h = healBy.get(p.id);
    const healing = h?.total ?? 0;
    const overheal = h?.overheal ?? 0;
    const healerParse = p.role === 'healer' && typeof hpsParse.get(p.name) === 'number' ? (hpsParse.get(p.name) as number) : null;
    return {
      id: p.id,
      name: p.name,
      className: p.className,
      specName: p.specName,
      role: p.role,
      total: p.total,
      dps: p.dps,
      // Healers are ranked on healing, everyone else on damage
      parse: p.role === 'healer' ? healerParse ?? p.parse : p.parse,
      itemLevel: p.itemLevel,
      activePct: p.activePct,
      healing,
      hps: healing / seconds,
      overhealPct: healing + overheal > 0 ? Math.round((overheal / (healing + overheal)) * 1000) / 10 : null,
      taken: p.taken,
      avoidable: p.avoidable,
      deaths: p.deaths.length,
      interrupts: interrupts.get(p.name) ?? 0,
      dispels: dispels.get(p.name) ?? 0,
    };
  });

  // Damage taken by ability across the raid, with "likely avoidable" worked out the same way as for one player
  const tankIds = new Set(digest.players.filter((p) => p.role === 'tank').map((p) => p.id));
  const nonTanks = digest.players.filter((p) => !tankIds.has(p.id)).length;
  const byAbility = new Map<string, { total: number; icon?: string; hit: Set<number>; nonTankHit: Set<number> }>();
  for (const e of (heal.taken?.data?.entries ?? []) as any[]) {
    if (!e || e.type === 'Pet' || e.type === 'NPC') continue;
    for (const a of (e.abilities ?? []) as any[]) {
      if (!a?.name || !(num(a.total) > 0)) continue;
      const row = byAbility.get(a.name) ?? { total: 0, icon: a.abilityIcon ?? a.icon, hit: new Set<number>(), nonTankHit: new Set<number>() };
      row.total += num(a.total);
      row.hit.add(e.id);
      if (!tankIds.has(e.id)) row.nonTankHit.add(e.id);
      byAbility.set(a.name, row);
    }
  }
  const takenByAbility = [...byAbility]
    .map(([name, r]) => ({
      name,
      icon: typeof r.icon === 'string' ? r.icon : undefined,
      total: r.total,
      playersHit: r.hit.size,
      avoidable: !MELEE.test(name) && r.nonTankHit.size > 0 && nonTanks >= 3 && r.nonTankHit.size / nonTanks < 0.5,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const deaths = digest.players
    .flatMap((p) => p.deaths.map((d) => ({ ...d, name: p.name, className: p.className })))
    .sort((a, b) => a.seconds - b.seconds);

  const nameOf = new Map(digest.players.map((p) => [p.id, p.name]));
  const bloodlust = (pack.full?.lust ?? []).map(([cs, by, a]) => ({ seconds: Math.round(cs / 10) / 10, by: nameOf.get(by) ?? 'Unknown', name: pack.full?.names[a]?.[0] ?? 'Bloodlust' }));

  const totalDamage = players.reduce((t, p) => t + p.total, 0);
  // The raid's damage per second, once the whole fight has been read
  const dpsSeries = pack.full ? seriesFromSeconds(pack.full.raid, totalDamage / seconds) : [];
  const totalHealing = players.reduce((t, p) => t + p.healing, 0);
  const ilvls = players.map((p) => p.itemLevel).filter((v): v is number => !!v);

  return {
    fight: { id: ref.id, name: ref.name, kill: ref.kill, seconds, encounterID: ref.encounterID },
    totals: {
      damage: totalDamage,
      dps: totalDamage / seconds,
      healing: totalHealing,
      hps: totalHealing / seconds,
      taken: players.reduce((t, p) => t + p.taken, 0),
      deaths: deaths.length,
      raidSize: players.length,
      avgItemLevel: ilvls.length ? Math.round((ilvls.reduce((t, v) => t + v, 0) / ilvls.length) * 10) / 10 : null,
    },
    players: players.sort((a, b) => b.dps - a.dps),
    deaths,
    takenByAbility,
    bloodlust,
    ...(digest.debuffs ? { debuffs: digest.debuffs } : {}),
    dpsSeries,
    feedback: raidFeedback([digest], { bloodlust: bloodlust.map((b) => b.seconds) }),
  };
}

