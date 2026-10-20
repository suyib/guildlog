// The analysis runs as several short requests so no single one hits Vercel's time limit:
//   1. fight    -> the fight-wide table for everyone (damage, rankings, item levels), fetched ONCE
//   2. snapshot -> one player's own tables + casts (called for you and each comparison, in parallel)
//   3. top      -> finds a top-ranked parse of your spec on this boss (optional)
//   4. finish   -> adds your previous kill, builds the findings and saves the result
import { buildFindings, buildSnapshot, buildStrengths } from './analysis.js';
import { getCachedSnapshot, getCachedTop, previousKill, putCachedSnapshot, putCachedTop, saveAnalysis } from './db.js';
import type { ActorRef, AnalysisResult, Comparison, Dashboard, FightPlayerRow, FightRef, PlayerSnapshot, ReportSummary, SnapshotTarget } from './types.js';
import { type Actor, type Fight, getCastEvents, getFightData, getPlayerTables, getReportMeta, getTopRankings, parseReportUrl } from './wcl.js';

export async function reportSummary(url: string): Promise<ReportSummary> {
  const parsed = parseReportUrl(url);
  const meta = await getReportMeta(parsed.host, parsed.code);
  const encounters = meta.fights.filter((f) => f.encounterID > 0);
  // Only people who were in at least one boss fight. A report's actor list also holds everyone the
  // logger saw (other raids, people in town), which is where "Unknown" class entries come from.
  const inFights = new Set(encounters.flatMap((f) => f.friendlyPlayers ?? []));
  const players = meta.masterData.actors.filter((a) => a.type === 'Player' && (inFights.size === 0 || inFights.has(a.id)));

  let suggestedFight: number | undefined;
  if (parsed.fight === 'last') suggestedFight = encounters.at(-1)?.id;
  else if (parsed.fight && encounters.some((f) => f.id === Number(parsed.fight))) suggestedFight = Number(parsed.fight);

  return {
    host: parsed.host,
    code: meta.code,
    title: meta.title,
    startTime: meta.startTime,
    fights: encounters.map((f) => ({
      id: f.id,
      name: f.name,
      encounterId: f.encounterID,
      kill: !!f.kill,
      seconds: Math.round((f.endTime - f.startTime) / 1000),
      startTime: f.startTime,
      endTime: f.endTime,
      playerIds: f.friendlyPlayers ?? [],
    })),
    players: players
      .map((p) => ({ id: p.id, name: p.name, className: p.subType, server: p.server ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    suggestedFight,
    suggestedPlayer: players.some((p) => p.id === parsed.source) ? parsed.source : undefined,
  };
}

export function rankingRows(rankings: any): any[] {
  const roles = rankings?.data?.[0]?.roles ?? {};
  return ['tanks', 'healers', 'dps'].flatMap((r) => roles[r]?.characters ?? []);
}

export function detailRows(details: any): any[] {
  const d = details?.data?.playerDetails ?? details?.playerDetails ?? {};
  return ['tanks', 'healers', 'dps'].flatMap((r) => d[r] ?? []);
}

/** Step 1: everyone's fight-wide numbers in one query. */
export async function fightRows(host: string, code: string, fightId: number, withRankings = true): Promise<FightPlayerRow[]> {
  const fd = await getFightData(host, code, fightId, { rankings: withRankings });
  const ranks = rankingRows(fd.rankings);
  const details = detailRows(fd.details);
  return (fd.damage?.data?.entries ?? [])
    .filter((e: any) => e.type !== 'Pet' && e.type !== 'NPC')
    .map((e: any): FightPlayerRow => {
      const rank = ranks.find((r) => r.name === e.name);
      const det = details.find((x) => x.id === e.id || x.name === e.name);
      const [iconClass, iconSpec] = String(e.icon ?? '').split('-');
      const ilvl = Number(det?.maxItemLevel ?? det?.minItemLevel ?? 0);
      return {
        id: e.id,
        name: e.name,
        className: rank?.class ?? iconClass ?? e.type,
        specName: rank?.spec ?? det?.specs?.[0]?.spec ?? iconSpec ?? '',
        icon: e.icon ?? '',
        total: Number(e.total ?? 0),
        activeTime: typeof e.activeTime === 'number' ? e.activeTime : null,
        rankPercent: typeof rank?.rankPercent === 'number' ? rank.rankPercent : null,
        itemLevel: ilvl > 0 ? ilvl : null,
        server: det?.server ?? rank?.server?.name ?? null,
      };
    });
}

const toFight = (f: FightRef): Fight => ({ ...f, size: null, difficulty: null });
const toActor = (a: ActorRef): Actor => ({ id: a.id, name: a.name, type: 'Player', subType: a.className, petOwner: null });

/**
 * Step 2: one player's snapshot. Pass the player's fight row from step 1 so the fight-wide
 * table isn't fetched again; without it (a top parse from another report) only the damage table is fetched.
 */
export async function snapshotOne(host: string, code: string, fightRef: FightRef, actorRef: ActorRef, row?: FightPlayerRow): Promise<PlayerSnapshot> {
  const cacheKey = `v1:${host}:${code}:${fightRef.id}:${fightRef.endTime}:${actorRef.id}`;
  const cached = await getCachedSnapshot(cacheKey);
  if (cached) return cached;
  const fresh = await buildFreshSnapshot(host, code, fightRef, actorRef, row);
  await putCachedSnapshot(cacheKey, fresh);
  return fresh;
}

async function buildFreshSnapshot(host: string, code: string, fightRef: FightRef, actorRef: ActorRef, row?: FightPlayerRow): Promise<PlayerSnapshot> {
  const fight = toFight(fightRef);
  const actor = toActor(actorRef);
  const [r, tables, casts] = await Promise.all([
    row ? Promise.resolve(row) : fightRows(host, code, fight.id, false).then((rows) => rows.find((x) => x.id === actor.id || x.name === actor.name)),
    getPlayerTables(host, code, fight.id, actor.id),
    getCastEvents(host, code, fight, actor.id),
  ]);
  const snapshot = buildSnapshot({
    host,
    code,
    fight,
    actor,
    fightRow: r ? { icon: r.icon, activeTime: r.activeTime } : undefined,
    rankingRow: r ? { rankPercent: r.rankPercent, class: r.className, spec: r.specName } : undefined,
    itemLevel: r?.itemLevel ?? null,
    tables,
    casts,
  });
  snapshot.server = r?.server ?? null;
  return snapshot;
}

/** Step 3: a top-ranked parse of the same spec on this boss. */
export async function topParseTarget(host: string, fight: FightRef, me: { name: string; className: string; specName: string }): Promise<SnapshotTarget | null> {
  if (!me.specName) throw new Error('your spec is unknown for this fight');
  const cacheKey = `v1:${host}:${fight.encounterID}:${me.className}:${me.specName}:${me.name}`;
  const cached = await getCachedTop(cacheKey);
  if (cached !== undefined) return cached as SnapshotTarget | null;
  const target = await findTopParse(host, fight, me);
  await putCachedTop(cacheKey, target);
  return target;
}

async function findTopParse(host: string, fight: FightRef, me: { name: string; className: string; specName: string }): Promise<SnapshotTarget | null> {
  const ranks = await getTopRankings(host, fight.encounterID, me.className, me.specName);
  const pick = ranks.find((r) => r.name !== me.name);
  if (!pick) return null;
  const tMeta = await getReportMeta(host, pick.code, 20_000);
  const tFight = tMeta.fights.find((f) => f.id === pick.fightID);
  const tActor = tMeta.masterData.actors.find((a) => a.name === pick.name && a.type === 'Player');
  if (!tFight || !tActor) return null;
  return {
    kind: 'top-parse',
    label: `${pick.name} (top ranked)`,
    host,
    code: pick.code,
    fight: { id: tFight.id, encounterID: tFight.encounterID, name: tFight.name, startTime: tFight.startTime, endTime: tFight.endTime, kill: !!tFight.kill },
    actor: { id: tActor.id, name: tActor.name, className: tActor.subType },
    sameClass: tActor.subType === me.className,
  };
}

/** Step 4: add your previous kill (if wanted), build findings and save. */
export async function finish(input: { player: PlayerSnapshot; comparisons: Comparison[]; compareKey: string; notes: string[]; dashboard?: Dashboard }): Promise<AnalysisResult> {
  const { player, compareKey } = input;
  const notes = [...input.notes];
  // Rotation and cooldown comparisons only make sense within the same spec (Balance vs Feral share a
  // class but not a rotation). Players who did no damage in the fight are left out.
  const sameSpec = (s: PlayerSnapshot) =>
    s.className === player.className && (!s.specName || !player.specName || s.specName === player.specName);
  const comparisons = input.comparisons
    .filter((c) => {
      if (c.snapshot.total > 0) return true;
      notes.push(`${c.snapshot.name} did no damage in this fight, so they were left out.`);
      return false;
    })
    .map((c) => (c.kind === 'previous-kill' ? c : { ...c, sameClass: sameSpec(c.snapshot) }));

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
  const order = { 'same-report': 0, 'chosen-player': 0, 'other-log': 0, 'top-parse': 1, 'previous-kill': 2 } as const;
  comparisons.sort((a, b) => order[a.kind] - order[b.kind]);

  const result: AnalysisResult = { player, comparisons, findings: buildFindings(player, comparisons), strengths: buildStrengths(player, comparisons, input.dashboard?.gear), notes, compareKey, ...(input.dashboard ? { dashboard: input.dashboard } : {}) };
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
