import { buildFindings, buildSnapshot } from './analysis.js';
import { previousKill, saveAnalysis } from './db.js';
import type { AnalysisResult, CompareChoice, Comparison, PlayerSnapshot, ReportSummary } from './types.js';
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

const COMPARISON_BUDGET_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} took too long, skipped`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function analyze(params: { host: string; code: string; fightId: number; playerId: number; compare?: CompareChoice }): Promise<AnalysisResult> {
  const { host, code, fightId, playerId } = params;
  const compare: CompareChoice = params.compare ?? { kind: 'auto' };
  // Report metadata and fight-wide tables don't depend on each other, so fetch them together.
  const [meta, fightData] = await Promise.all([getReportMeta(host, code), getFightData(host, code, fightId)]);
  const fight = meta.fights.find((f) => f.id === fightId);
  if (!fight || fight.encounterID <= 0) throw new Error('Pick a boss fight from this report.');
  const actor = meta.masterData.actors.find((a) => a.id === playerId && a.type === 'Player');
  if (!actor) throw new Error('That player isn\u2019t in this report.');

  const notes: string[] = [];
  const comparisons: Comparison[] = [];
  const myRank = rankingRows(fightData.rankings).find((r) => r.name === actor.name);
  const myIcon: string = (fightData.damage?.data?.entries ?? []).find((e: any) => e.id === actor.id || e.name === actor.name)?.icon ?? '';
  const className: string = myRank?.class ?? myIcon.split('-')[0] ?? actor.subType;
  const specName: string = myRank?.spec ?? myIcon.split('-')[1] ?? '';

  // Everything below runs in parallel: you, two raid-mates, a top parse, your previous kill.
  const meTask = snapshotFor(host, code, meta, fight, actor, fightData);

  const tasks: Promise<Comparison | null>[] = [];
  const labels: string[] = [];

  const raidMate = (other: Actor, kind: 'same-report' | 'chosen-player') => async (): Promise<Comparison> => ({
    kind,
    label: `${other.name} (${other.subType}, same raid)`,
    snapshot: await snapshotFor(host, code, meta, fight, other, fightData),
    sameClass: other.subType === actor.subType,
  });

  const topParse = async (): Promise<Comparison | null> => {
    if (!specName) return null;
    const ranks = await getTopRankings(host, fight.encounterID, className, specName);
    const pick = ranks.find((r) => r.name !== actor.name);
    if (!pick) return null;
    const tMeta = await getReportMeta(host, pick.code);
    const tFight = tMeta.fights.find((f) => f.id === pick.fightID);
    const tActor = tMeta.masterData.actors.find((a) => a.name === pick.name && a.type === 'Player');
    if (!tFight || !tActor) return null;
    return { kind: 'top-parse', label: `${pick.name} (top ranked)`, snapshot: await snapshotFor(host, pick.code, tMeta, tFight, tActor), sameClass: true };
  };

  const previous = async (): Promise<Comparison | null> => {
    const prev = await previousKill(actor.name, fight.encounterID, code);
    return prev ? { kind: 'previous-kill', label: `Your kill on ${prev.createdAt.slice(0, 10)}`, snapshot: prev.snapshot, sameClass: true } : null;
  };

  if (compare.kind === 'player') {
    const other = meta.masterData.actors.find((a) => a.id === compare.playerId && a.type === 'Player');
    if (!other) throw new Error('The player you picked to compare with isn\u2019t in this report.');
    if (other.id === actor.id) throw new Error('Pick someone other than yourself to compare with.');
    tasks.push(raidMate(other, 'chosen-player')());
    labels.push(other.name);
  } else if (compare.kind === 'top') {
    tasks.push(topParse());
    labels.push('top-ranked parse');
  } else if (compare.kind === 'previous') {
    tasks.push(previous());
    labels.push('previous kill');
  } else {
    // Auto: best two of your class in this raid, a top parse, and your last kill of this boss.
    const sameClass = (fightData.damage?.data?.entries ?? [])
      .filter((e: any) => e.type === actor.subType && e.name !== actor.name)
      .sort((a: any, b: any) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, 2);
    for (const e of sameClass) {
      const other = meta.masterData.actors.find((a) => a.id === e.id || a.name === e.name);
      if (!other) continue;
      tasks.push(raidMate(other, 'same-report')());
      labels.push(other.name);
    }
    tasks.push(topParse(), previous());
    labels.push('top-ranked parse', 'previous kill');
  }

  const [player, settled] = await Promise.all([
    meTask,
    Promise.allSettled(tasks.map((t, i) => withTimeout<Comparison | null>(t, COMPARISON_BUDGET_MS, labels[i]))),
  ]);
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) comparisons.push(s.value);
    else if (s.status === 'rejected') notes.push(`Couldn\u2019t load ${labels[i]}: ${(s.reason as Error)?.message ?? s.reason}`);
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
