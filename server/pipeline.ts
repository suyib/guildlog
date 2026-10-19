// The analysis runs in three short steps so no single request hits Vercel's time limit:
//   1. targets  -> who to compare with (needs the fight table and, for a top parse, the rankings)
//   2. snapshot -> one player's numbers for one fight (called once for you and once per comparison)
//   3. finish   -> adds your previous kill, builds the findings and saves the result
import { buildFindings, buildSnapshot } from './analysis.js';
import { previousKill, saveAnalysis } from './db.js';
import type { ActorRef, AnalysisResult, CompareChoice, Comparison, FightRef, PlayerSnapshot, ReportSummary, SnapshotTarget } from './types.js';
import { type Actor, type Fight, getCastEvents, getFightData, getPlayerTables, getReportMeta, getTopRankings, parseReportUrl } from './wcl.js';

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
    fights: encounters.map((f) => ({
      id: f.id,
      name: f.name,
      encounterId: f.encounterID,
      kill: !!f.kill,
      seconds: Math.round((f.endTime - f.startTime) / 1000),
      startTime: f.startTime,
      endTime: f.endTime,
    })),
    players: players.map((p) => ({ id: p.id, name: p.name, className: p.subType })).sort((a, b) => a.name.localeCompare(b.name)),
    suggestedFight,
    suggestedPlayer: players.some((p) => p.id === parsed.source) ? parsed.source : undefined,
  };
}

function rankingRows(rankings: any): any[] {
  const roles = rankings?.data?.[0]?.roles ?? {};
  return ['tanks', 'healers', 'dps'].flatMap((r) => roles[r]?.characters ?? []);
}

const toFight = (f: FightRef): Fight => ({ ...f, size: null, difficulty: null });
const toActor = (a: ActorRef): Actor => ({ id: a.id, name: a.name, type: 'Player', subType: a.className, petOwner: null });

/** Step 2: one player's snapshot. All three Warcraft Logs queries run at the same time. */
export async function snapshotOne(host: string, code: string, fightRef: FightRef, actorRef: ActorRef): Promise<PlayerSnapshot> {
  const fight = toFight(fightRef);
  const actor = toActor(actorRef);
  const [fd, tables, casts] = await Promise.all([
    getFightData(host, code, fight.id),
    getPlayerTables(host, code, fight.id, actor.id),
    getCastEvents(host, code, fight, actor.id),
  ]);
  const fightRow = (fd.damage?.data?.entries ?? []).find((e: any) => e.id === actor.id || e.name === actor.name);
  const rankingRow = rankingRows(fd.rankings).find((r) => r.name === actor.name);
  return buildSnapshot({ host, code, fight, actor, fightRow, rankingRow, tables, casts });
}

/** Step 1: work out who to compare with. Player choices are resolved in the browser, so this handles auto and top. */
export async function comparisonTargets(host: string, code: string, fight: FightRef, me: ActorRef, compare: CompareChoice): Promise<{ targets: SnapshotTarget[]; notes: string[] }> {
  const notes: string[] = [];
  const targets: SnapshotTarget[] = [];
  if (compare.kind === 'previous' || compare.kind === 'player') return { targets, notes };

  const fd = await getFightData(host, code, fight.id);
  const entries: any[] = fd.damage?.data?.entries ?? [];
  const myRank = rankingRows(fd.rankings).find((r) => r.name === me.name);
  const myIcon: string = entries.find((e) => e.id === me.id || e.name === me.name)?.icon ?? '';
  const className: string = myRank?.class ?? myIcon.split('-')[0] ?? me.className;
  const specName: string = myRank?.spec ?? myIcon.split('-')[1] ?? '';

  if (compare.kind === 'auto') {
    entries
      .filter((e) => e.type === me.className && e.name !== me.name)
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, 2)
      .forEach((e) => targets.push({
        kind: 'same-report',
        label: `${e.name} (${me.className}, same raid)`,
        host,
        code,
        fight,
        actor: { id: e.id, name: e.name, className: e.type },
        sameClass: true,
      }));
  }

  // Top-ranked parse of the same spec on this boss
  try {
    if (!specName) throw new Error('spec unknown');
    const ranks = await getTopRankings(host, fight.encounterID, className, specName);
    const pick = ranks.find((r) => r.name !== me.name);
    if (pick) {
      const tMeta = await getReportMeta(host, pick.code);
      const tFight = tMeta.fights.find((f) => f.id === pick.fightID);
      const tActor = tMeta.masterData.actors.find((a) => a.name === pick.name && a.type === 'Player');
      if (tFight && tActor) {
        targets.push({
          kind: 'top-parse',
          label: `${pick.name} (top ranked)`,
          host,
          code: pick.code,
          fight: { id: tFight.id, encounterID: tFight.encounterID, name: tFight.name, startTime: tFight.startTime, endTime: tFight.endTime, kill: !!tFight.kill },
          actor: { id: tActor.id, name: tActor.name, className: tActor.subType },
          sameClass: tActor.subType === me.className,
        });
      }
    }
  } catch (e) {
    notes.push(`Couldn’t find a top-ranked parse: ${(e as Error).message}`);
  }
  return { targets, notes };
}

/** Step 3: add your previous kill (if wanted), build findings and save. */
export async function finish(input: {
  player: PlayerSnapshot;
  comparisons: Comparison[];
  compareKey: string;
  notes: string[];
}): Promise<AnalysisResult> {
  const { player, compareKey } = input;
  const comparisons = [...input.comparisons];
  const notes = [...input.notes];

  if (compareKey === 'auto' || compareKey === 'previous') {
    try {
      const prev = await previousKill(player.name, player.encounterId, player.reportCode);
      if (prev) comparisons.push({ kind: 'previous-kill', label: `Your kill on ${prev.createdAt.slice(0, 10)}`, snapshot: prev.snapshot, sameClass: true });
      else if (compareKey === 'previous') notes.push('No earlier saved kill of this boss to compare with yet.');
    } catch (e) {
      notes.push(`Couldn’t load previous kill: ${(e as Error).message}`);
    }
  }

  // Same-report players first, so they are the main comparison
  const order = { 'same-report': 0, 'chosen-player': 0, 'top-parse': 1, 'previous-kill': 2 } as const;
  comparisons.sort((a, b) => order[a.kind] - order[b.kind]);

  const result: AnalysisResult = { player, comparisons, findings: buildFindings(player, comparisons), notes, compareKey };
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
