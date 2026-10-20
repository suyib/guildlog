// Whole-raid breakdown of one fight: everyone's damage and healing, deaths, damage taken by ability,
// Bloodlust timing, interrupts and dispels. Built from fight-wide Warcraft Logs tables (a handful of
// queries, not one per player). Everyone's per-player numbers come from the same summary the Discord
// bot uses, so a fight read here is instant for the bot afterwards, and the other way round.
import { type FightDigest, DIGEST_VERSION, buildFightDigest } from './discord/digest.js';
import { storeFight, storedFights } from './discord/store.js';
import { dbEnabled } from './db.js';
import { rankingRows } from './pipeline.js';
import { raidFeedback } from './raidFeedback.js';
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

  const [digest, heal, utility, lust, graph, perSecond] = await Promise.all([
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
    optional(report(host, code, ref.id, 'graph: graph(dataType:DamageDone, fightIDs:$fid)', 20_000)),
    raidDamagePerSecond(host, code, ref).catch(() => null),
  ]);

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
  const hpsParse = new Map(rankingRows(utility.hpsRanks).map((r: any) => [r.name, r.rankPercent]));
  const interrupts = countsFrom(utility.interrupts);
  const dispels = countsFrom(utility.dispels);

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
    .flatMap((p) => p.deaths.map((d) => ({ seconds: d.seconds, name: p.name, className: p.className, by: d.by })))
    .sort((a, b) => a.seconds - b.seconds);

  const actorName = new Map<number, string>(((lust.masterData?.actors ?? []) as any[]).map((a) => [a.id, a.name]));
  const bloodlust = ((lust.events?.data ?? []) as any[])
    .filter((e) => e?.type === 'cast')
    .map((e) => ({ seconds: Math.round((num(e.timestamp) - ref.startTime) / 100) / 10, by: actorName.get(e.sourceID) ?? 'Unknown', name: e.abilityGameID === 32182 ? 'Heroism' : 'Bloodlust' }));

  const totalDamage = players.reduce((t, p) => t + p.total, 0);
  // Prefer the raid's own damage events; fall back to Warcraft Logs' graph if they couldn't all be read in time
  const dpsSeries = perSecond ? smoothed(perSecond, totalDamage / seconds) : seriesOverTime(graph.graph, ref.startTime, seconds, totalDamage / seconds);
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
    dpsSeries,
    feedback: raidFeedback([digest], { bloodlust: bloodlust.map((b) => b.seconds) }),
  };
}

/**
 * Raid DPS across the fight from Warcraft Logs' damage graph, totalled per second, smoothed over
 * 5 seconds and scaled so its average is the raid's real DPS. Each series' own start time and step
 * are used, so the line lines up with the fight even when the graph covers a wider stretch of the log.
 */
export function seriesOverTime(graph: any, fightStart: number, seconds: number, avgDps: number): { t: number; dps: number }[] {
  const series: any[] = graph?.data?.series ?? graph?.series ?? [];
  if (!series.length || seconds < 3) return [];
  const total = series.find((x) => /^total$/i.test(String(x?.name)));
  const used = total ? [total] : series;
  const secs = Math.ceil(seconds);

  const bucket = (base: number) => {
    const b = new Array<number>(secs).fill(0);
    let inside = 0;
    let all = 0;
    for (const s of used) {
      const start = num(s?.pointStart);
      const step = num(s?.pointInterval) || 1000;
      (s?.data ?? []).forEach((p: any, i: number) => {
        let t: number, v: number;
        if (Array.isArray(p)) [t, v] = [num(p[0]), num(p[1])];
        else if (p && typeof p === 'object') [t, v] = [num(p.x), num(p.y)];
        else [t, v] = [start + i * step, num(p)];
        all++;
        const sec = Math.floor((t - base) / 1000);
        if (sec >= 0 && sec < secs) { b[sec] += v; inside++; }
      });
    }
    return { b, share: all ? inside / all : 0 };
  };
  // Times are usually from the start of the log; if most points don't land in the fight, they're from the pull
  let { b, share } = bucket(fightStart);
  if (share < 0.5) {
    const alt = bucket(0);
    if (alt.share > share) b = alt.b;
  }
  const smooth = b.map((_, i) => {
    const a = Math.max(0, i - 2);
    const z = Math.min(secs, i + 3);
    return b.slice(a, z).reduce((t, v) => t + v, 0) / (z - a);
  });
  const mean = smooth.reduce((t, v) => t + v, 0) / secs;
  if (!(mean > 0)) return [];
  const scale = avgDps > 0 ? avgDps / mean : 1;
  return smooth.map((v, i) => ({ t: i, dps: Math.round(v * scale) }));
}

/**
 * The raid's damage per second, from every damage event in the fight (players and pets).
 * Returns null if the events can't all be read in time, since a partial line would be misleading.
 */
async function raidDamagePerSecond(host: string, code: string, ref: FightRef): Promise<number[] | null> {
  const q = `query($code:String!,$fid:[Int]!,$st:Float,$et:Float){reportData{report(code:$code){
    events(dataType:DamageDone, fightIDs:$fid, startTime:$st, endTime:$et, limit:10000){data nextPageTimestamp}
  }}}`;
  const secs = Math.max(1, Math.ceil((ref.endTime - ref.startTime) / 1000));
  const b = new Array<number>(secs).fill(0);
  let st: number | null = ref.startTime;
  const deadline = Date.now() + 40_000;
  for (let page = 0; st !== null; page++) {
    const left = deadline - Date.now();
    if (left < 3_000 || page >= 20) return null;
    const d: any = await gql(host, q, { code, fid: [ref.id], st, et: ref.endTime }, Math.min(20_000, left));
    for (const e of d.reportData.report.events?.data ?? []) {
      if (e?.type !== 'damage') continue;
      const i = Math.floor((num(e.timestamp) - ref.startTime) / 1000);
      if (i >= 0 && i < secs) b[i] += num(e.amount) + num(e.absorbed);
    }
    st = d.reportData.report.events?.nextPageTimestamp ?? null;
  }
  return b.some((v) => v > 0) ? b : null;
}

/** 5-second smoothing, scaled so the average matches the raid's real DPS. */
function smoothed(perSecond: number[], avgDps: number): { t: number; dps: number }[] {
  const n = perSecond.length;
  const sm = perSecond.map((_, i) => {
    const a = Math.max(0, i - 2);
    const z = Math.min(n, i + 3);
    return perSecond.slice(a, z).reduce((t, v) => t + v, 0) / (z - a);
  });
  const mean = sm.reduce((t, v) => t + v, 0) / n;
  const scale = mean > 0 && avgDps > 0 ? avgDps / mean : 1;
  return sm.map((v, i) => ({ t: i, dps: Math.round(v * scale) }));
}
