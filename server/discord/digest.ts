// A compact summary of everyone's numbers for each boss kill in a report. It's built once per
// fight (a handful of fight-wide queries, not one per player) and stored, so every "send me my
// summary" button press afterwards is instant.
import { possibleUses } from '../analysis.js';
import { COOLDOWNS, IGNORE_FOR_GAPS } from '../cooldowns.js';
import { gearFrom, statsFrom, survivalFrom } from '../dashboard.js';
import { detailRows, rankingRows } from '../pipeline.js';
import type { GearItem } from '../types.js';
import { type Fight, type ReportMeta, getReportMeta, gql } from '../wcl.js';
import { storeFight, storedFights } from './store.js';

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
  deaths: { seconds: number; by: string }[];
  taken: number;
  avoidable: number;
  avoidableTop: { name: string; total: number }[];
  gear?: GearItem[];
  stats?: { name: string; value: string }[];
}

export interface FightDigest {
  id: number;
  name: string;
  encounterID: number;
  kill: boolean;
  startTime: number;
  endTime: number;
  seconds: number;
  players: PlayerDigest[];
}

export interface RaidDigest {
  host: string;
  code: string;
  meta: ReportMeta;
  fights: FightDigest[];
  /** Boss kills not summarized yet (Warcraft Logs was slow); pressing the button again picks them up. */
  pending: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

async function fightTables(host: string, code: string, fightId: number, fields: string, timeoutMs: number): Promise<Record<string, any>> {
  const d = await gql<{ reportData: { report: Record<string, any> } }>(
    host,
    `query($code:String!,$fid:[Int]!){reportData{report(code:$code){ ${fields} }}}`,
    { code, fid: [fightId] },
    timeoutMs,
  );
  return d.reportData.report;
}

export async function buildFightDigest(host: string, code: string, fight: Fight): Promise<FightDigest> {
  const optional = (p: Promise<Record<string, any>>) => p.catch(() => ({}) as Record<string, any>);
  const [main, survival, ranks, details] = await Promise.all([
    fightTables(host, code, fight.id, 'damage: table(dataType:DamageDone, fightIDs:$fid) casts: table(dataType:Casts, fightIDs:$fid)', 25_000),
    optional(fightTables(host, code, fight.id, 'taken: table(dataType:DamageTaken, fightIDs:$fid) deaths: table(dataType:Deaths, fightIDs:$fid)', 25_000)),
    optional(fightTables(host, code, fight.id, 'rankings(fightIDs:$fid, playerMetric:dps)', 15_000)),
    optional(fightTables(host, code, fight.id, 'details: playerDetails(fightIDs:$fid, includeCombatantInfo:true)', 20_000)),
  ]);

  const seconds = (fight.endTime - fight.startTime) / 1000;
  const rankRows = rankingRows(ranks.rankings);
  const roleOf = new Map<number, PlayerDigest['role']>();
  const d = details.details?.data?.playerDetails ?? details.details?.playerDetails ?? {};
  for (const [key, role] of [['tanks', 'tank'], ['healers', 'healer'], ['dps', 'dps']] as const) for (const p of (d[key] ?? []) as any[]) roleOf.set(p.id, role);
  const detail = detailRows(details.details);
  const tankIds = [...roleOf].filter(([, r]) => r === 'tank').map(([id]) => id);
  const castsBy = new Map<number, any>((main.casts?.data?.entries ?? []).map((e: any) => [e.id, e]));
  const deathEntries: any[] = survival.deaths?.data?.entries ?? [];

  const entries: any[] = (main.damage?.data?.entries ?? []).filter((e: any) => e && e.type !== 'Pet' && e.type !== 'NPC');
  const raidIds = entries.map((e) => e.id);
  const players = entries.map((e): PlayerDigest => {
    const rank = rankRows.find((r) => r.name === e.name);
    const det = detail.find((x) => x.id === e.id || x.name === e.name);
    const [iconClass, iconSpec] = String(e.icon ?? '').split('-');
    const castEntry = castsBy.get(e.id);
    const castList: { name: string; count: number }[] = ((castEntry?.abilities ?? []) as any[])
      .filter((a) => a?.name && !IGNORE_FOR_GAPS.has(a.name))
      .map((a) => ({ name: String(a.name), count: num(a.total) }))
      .sort((a, b) => b.count - a.count);
    const sv = survivalFrom(survival.taken, e.id, tankIds, raidIds);
    const ilvl = Number(det?.maxItemLevel ?? det?.minItemLevel ?? 0);
    return {
      id: e.id,
      name: e.name,
      server: det?.server ?? rank?.server?.name ?? null,
      className: rank?.class ?? iconClass ?? e.type ?? '',
      specName: rank?.spec ?? det?.specs?.[0]?.spec ?? iconSpec ?? '',
      role: roleOf.get(e.id) ?? 'dps',
      total: num(e.total),
      dps: num(e.total) / (seconds || 1),
      parse: typeof rank?.rankPercent === 'number' ? rank.rankPercent : null,
      itemLevel: ilvl > 0 ? ilvl : null,
      activePct: typeof e.activeTime === 'number' && seconds > 0 ? Math.round((e.activeTime / (seconds * 1000)) * 1000) / 10 : null,
      abilities: ((e.abilities ?? []) as any[])
        .filter((a) => a?.name && num(a.total) > 0)
        .map((a) => ({ name: String(a.name), total: num(a.total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      casts: castList.slice(0, 12),
      cooldowns: castList
        .filter((c) => COOLDOWNS[c.name])
        .map((c) => ({ name: c.name, uses: c.count, possible: possibleUses(seconds, COOLDOWNS[c.name]) })),
      deaths: deathEntries
        .filter((x) => x.id === e.id || x.name === e.name)
        .map((x) => ({ seconds: Math.round((num(x.deathTime ?? x.timestamp) - fight.startTime) / 1000), by: x.killingBlow?.name ?? x.ability?.name ?? 'Unknown' })),
      taken: sv?.total ?? 0,
      avoidable: sv?.avoidableTotal ?? 0,
      avoidableTop: (sv?.abilities ?? []).filter((a) => a.avoidable).slice(0, 3).map((a) => ({ name: a.name, total: a.total })),
      gear: det?.combatantInfo?.gear ? gearFrom(det.combatantInfo.gear) : undefined,
      stats: det?.combatantInfo?.stats ? statsFrom(det.combatantInfo.stats) : undefined,
    };
  });

  return { id: fight.id, name: fight.name, encounterID: fight.encounterID, kill: !!fight.kill, startTime: fight.startTime, endTime: fight.endTime, seconds, players };
}

/**
 * The digest for a whole report: stored fights plus any boss kills not built yet, within a
 * time budget so it fits in one function call.
 */
export async function raidDigest(host: string, code: string, budgetMs = 40_000): Promise<RaidDigest> {
  const deadline = Date.now() + budgetMs;
  const [meta, stored] = await Promise.all([getReportMeta(host, code, 15_000), storedFights(code).catch(() => [])]);
  const kills = meta.fights.filter((f) => f.encounterID > 0 && f.kill);
  const have = new Map(stored.map((s) => [s.fight_id, s.data as FightDigest]));
  const missing = kills.filter((f) => !have.has(f.id));

  // Build missing fights three at a time until the budget runs out
  let next = 0;
  const worker = async () => {
    while (next < missing.length && Date.now() < deadline - 20_000) {
      const f = missing[next++];
      try {
        const digest = await buildFightDigest(host, code, f);
        have.set(f.id, digest);
        await storeFight(code, f.id, digest).catch(() => undefined);
      } catch {
        /* left pending; the next request tries again */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const fights = kills.map((f) => have.get(f.id)).filter((x): x is FightDigest => !!x);
  return { host, code, meta, fights, pending: kills.length - fights.length };
}

/** The player's rows across the raid, matched by name (and realm when both are known). */
export function playerFights(digest: RaidDigest, name: string, realm: string | null) {
  const key = name.trim().toLowerCase();
  return digest.fights
    .map((f) => ({ fight: f, p: f.players.find((p) => p.name.toLowerCase() === key && (!realm || !p.server || p.server.toLowerCase() === realm.toLowerCase())) }))
    .filter((x): x is { fight: FightDigest; p: PlayerDigest } => !!x.p);
}
