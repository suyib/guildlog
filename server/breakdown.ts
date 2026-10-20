// Whole-raid breakdown of one fight: everyone's damage and healing, deaths, damage taken by ability,
// Bloodlust timing, interrupts and dispels. Built from fight-wide Warcraft Logs tables (a handful of
// queries, not one per player). Everyone's per-player numbers come from the same summary the Discord
// bot uses, so a fight read here is instant for the bot afterwards, and the other way round.
import { type FightDigest, DIGEST_VERSION, buildFightDigest } from './discord/digest.js';
import { storeFight, storedFights } from './discord/store.js';
import { dbEnabled } from './db.js';
import { rankingRows } from './pipeline.js';
import type { FightBreakdown, FightRef } from './types.js';
import { type Fight, gql } from './wcl.js';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const MELEE = /^(melee|auto attack|attack)$/i;

async function report(host: string, code: string, fightId: number, fields: string, timeoutMs: number, extra: Record<string, unknown> = {}, extraDecl = '') {
  const d = await gql<{ reportData: { report: Record<string, any> } }>(
    host,
    `query($code:String!,$fid:[Int]!${extraDecl}){reportData{report(code:$code){ ${fields} }}}`,
    { code, fid: [fightId], ...extra },
    timeoutMs,
  );
  return d.reportData.report;
}
const optional = (p: Promise<Record<string, any>>) => p.catch(() => ({}) as Record<string, any>);

/** Who did something to which ability, from a nested Interrupts or Dispels table: name -> count. */
function countsFrom(table: any): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (entries: any[]) => {
    for (const e of entries ?? []) {
      for (const d of (e?.details ?? []) as any[]) if (d?.name) out.set(d.name, (out.get(d.name) ?? 0) + num(d.total));
      if (Array.isArray(e?.entries)) walk(e.entries);
    }
  };
  walk(table?.data?.entries ?? []);
  return out;
}

export async function fightBreakdown(host: string, code: string, ref: FightRef): Promise<FightBreakdown> {
  const fight: Fight = { ...ref, size: null, difficulty: null };

  // Everyone's numbers: reuse the stored summary if this fight has been read before
  const digestPromise = (async (): Promise<FightDigest> => {
    if (dbEnabled()) {
      const stored = (await storedFights(code).catch(() => [])).find((s) => s.fight_id === ref.id && (s.data as FightDigest).v === DIGEST_VERSION);
      if (stored) return stored.data as FightDigest;
    }
    const built = await buildFightDigest(host, code, fight);
    if (dbEnabled()) await storeFight(code, ref.id, built).catch(() => undefined);
    return built;
  })();

  const [digest, heal, utility, lust] = await Promise.all([
    digestPromise,
    optional(report(host, code, ref.id, 'healing: table(dataType:Healing, fightIDs:$fid) taken: table(dataType:DamageTaken, fightIDs:$fid)', 25_000)),
    optional(report(host, code, ref.id, 'interrupts: table(dataType:Interrupts, fightIDs:$fid) dispels: table(dataType:Dispels, fightIDs:$fid) hpsRanks: rankings(fightIDs:$fid, playerMetric:hps)', 20_000)),
    optional(report(
      host, code, ref.id,
      'events(dataType:Casts, fightIDs:$fid, filterExpression:$filter, limit:50){data} masterData{actors(type:"Player"){id name}}',
      15_000,
      { filter: 'ability.id in (2825, 32182)' },
      ',$filter:String',
    )),
  ]);

  const seconds = (ref.endTime - ref.startTime) / 1000 || 1;
  const healBy = new Map<number, any>(((heal.healing?.data?.entries ?? []) as any[]).map((e) => [e.id, e]));
  const hpsParse = new Map(rankingRows(utility.hpsRanks).map((r: any) => [r.name, r.rankPercent]));
  const interrupts = countsFrom(utility.interrupts);
  const dispels = countsFrom(utility.dispels);

  const players = digest.players.map((p) => {
    const h = healBy.get(p.id);
    const healing = num(h?.total);
    const overheal = num(h?.overheal);
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
    .flatMap((p) => p.deaths.map((d) => ({ seconds: d.seconds, name: p.name, className: p.className, by: d.by })))
    .sort((a, b) => a.seconds - b.seconds);

  const actorName = new Map<number, string>(((lust.masterData?.actors ?? []) as any[]).map((a) => [a.id, a.name]));
  const bloodlust = ((lust.events?.data ?? []) as any[])
    .filter((e) => e?.type === 'cast')
    .map((e) => ({ seconds: Math.round((num(e.timestamp) - ref.startTime) / 100) / 10, by: actorName.get(e.sourceID) ?? 'Unknown', name: e.abilityGameID === 32182 ? 'Heroism' : 'Bloodlust' }));

  const totalDamage = players.reduce((t, p) => t + p.total, 0);
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
  };
}
