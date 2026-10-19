import { buildFindings, buildSnapshot } from './analysis.js';
import { previousKill, saveAnalysis } from './db.js';
import type { AnalysisResult, Comparison, PlayerSnapshot, ReportSummary } from './types.js';
import {
  type Actor,
  type Fight,
  type ReportMeta,
  getCastEvents,
  getFightData,
  getPlayerTables,
  getReportMeta,
  getTopRankings,
  parseReportUrl,
} from './wcl.js';

export async function reportSummary(url: string): Promise<ReportSummary> {
  const parsed = parseReportUrl(url);
  const meta = await getReportMeta(parsed.host, parsed.code);
  const encounters = meta.fights.filter((f) => f.encounterID > 0);
  const players = meta.masterData.actors.filter((a) => a.type === 'Player');

  let suggestedFight: number | undefined;
  if (parsed.fight === 'last') suggestedFight = encounters.at(-1)?.id;
  else if (parsed.fight && encounters.some((f) => f.id === Number(parsed.fight))) suggestedFight = Number(parsed.fight);

  return {
    host: parsed.host,
    code: meta.code,
    title: meta.title,
    fights: encounters.map((f) => ({ id: f.id, name: f.name, encounterId: f.encounterID, kill: !!f.kill, seconds: Math.round((f.endTime - f.startTime) / 1000) })),
    players: players.map((p) => ({ id: p.id, name: p.name, className: p.subType })).sort((a, b) => a.name.localeCompare(b.name)),
    suggestedFight,
    suggestedPlayer: players.some((p) => p.id === parsed.source) ? parsed.source : undefined,
  };
}

function rankingRows(rankings: any): any[] {
  const roles = rankings?.data?.[0]?.roles ?? {};
  return ['tanks', 'healers', 'dps'].flatMap((r) => roles[r]?.characters ?? []);
}

async function snapshotFor(host: string, code: string, meta: ReportMeta, fight: Fight, actor: Actor, fightData?: Awaited<ReturnType<typeof getFightData>>): Promise<PlayerSnapshot> {
  const fd = fightData ?? (await getFightData(host, code, fight.id));
  const [tables, casts] = await Promise.all([getPlayerTables(host, code, fight.id, actor.id), getCastEvents(host, code, fight, actor.id)]);
  const fightRow = (fd.damage?.data?.entries ?? []).find((e: any) => e.id === actor.id || e.name === actor.name);
  const rankingRow = rankingRows(fd.rankings).find((r) => r.name === actor.name);
  void meta;
  return buildSnapshot({ host, code, fight, actor, fightRow, rankingRow, tables, casts });
}

export async function analyze(params: { host: string; code: string; fightId: number; playerId: number }): Promise<AnalysisResult> {
  const { host, code, fightId, playerId } = params;
  const meta = await getReportMeta(host, code);
  const fight = meta.fights.find((f) => f.id === fightId);
  if (!fight || fight.encounterID <= 0) throw new Error('Pick a boss fight from this report.');
  const actor = meta.masterData.actors.find((a) => a.id === playerId && a.type === 'Player');
  if (!actor) throw new Error('That player isn’t in this report.');

  const fightData = await getFightData(host, code, fight.id);
  const player = await snapshotFor(host, code, meta, fight, actor, fightData);
  const notes: string[] = [];
  const comparisons: Comparison[] = [];

  // A) Best two players of the same class in this report
  const sameClass = (fightData.damage?.data?.entries ?? [])
    .filter((e: any) => e.type === actor.subType && e.name !== actor.name)
    .sort((a: any, b: any) => (b.total ?? 0) - (a.total ?? 0))
    .slice(0, 2);
  const sameTasks = sameClass.map(async (e: any) => {
    const other = meta.masterData.actors.find((a) => a.id === e.id || a.name === e.name);
    if (!other) return null;
    return { kind: 'same-report', label: `${other.name} (same raid)`, snapshot: await snapshotFor(host, code, meta, fight, other, fightData) } as Comparison;
  });

  // B) A top-ranked parse of the same spec on this boss
  const topTask = (async (): Promise<Comparison | null> => {
    if (!player.specName) return null;
    const ranks = await getTopRankings(host, fight.encounterID, player.className, player.specName);
    const pick = ranks.find((r) => r.name !== player.name);
    if (!pick) return null;
    const tMeta = await getReportMeta(host, pick.code);
    const tFight = tMeta.fights.find((f) => f.id === pick.fightID);
    const tActor = tMeta.masterData.actors.find((a) => a.name === pick.name && a.type === 'Player');
    if (!tFight || !tActor) return null;
    return { kind: 'top-parse', label: `${pick.name} (top ranked)`, snapshot: await snapshotFor(host, pick.code, tMeta, tFight, tActor) };
  })();

  // C) Your own previous kill of this boss (from saved analyses)
  const prevTask = (async (): Promise<Comparison | null> => {
    const prev = await previousKill(player.name, player.encounterId, code);
    return prev ? { kind: 'previous-kill', label: `Your kill on ${prev.createdAt.slice(0, 10)}`, snapshot: prev.snapshot } : null;
  })();

  const settled = await Promise.allSettled([...sameTasks, topTask, prevTask]);
  const labels = [...sameClass.map((e: any) => e.name), 'top-ranked parse', 'previous kill'];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) comparisons.push(s.value);
    else if (s.status === 'rejected') notes.push(`Couldn’t load ${labels[i]}: ${(s.reason as Error)?.message ?? s.reason}`);
  });

  const result: AnalysisResult = { player, comparisons, findings: buildFindings(player, comparisons), notes };
  try {
    const saved = await saveAnalysis(result);
    if (saved) {
      result.id = saved.id;
      result.createdAt = saved.created_at;
    }
  } catch (e) {
    notes.push(`Not saved: ${(e as Error).message}`);
  }
  return result;
}
