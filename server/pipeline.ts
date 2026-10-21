// The analysis runs as several short requests so no single one hits Vercel's time limit:
//   1. fight    -> the fight-wide table for everyone (damage, rankings, item levels), fetched ONCE
//   2. snapshot -> one player's own tables + casts (called for you and each comparison, in parallel)
//   3. finish   -> builds the findings and saves the result
import { buildFindings, buildSnapshot, buildStrengths } from './analysis.js';
import { getCachedSnapshot, putCachedSnapshot, saveAnalysis } from './db.js';
import type { ActorRef, AnalysisResult, Comparison, Dashboard, FightPlayerRow, FightRef, PlayerSnapshot, ReportSummary } from './types.js';
import { metaLiveOrSaved } from './saved.js';
import { type Actor, type Fight, getAutoAttackEvents, getCastEvents, getFightData, getPlayerTables, parseReportUrl } from './wcl.js';

export async function reportSummary(url: string): Promise<ReportSummary> {
  const parsed = parseReportUrl(url);
  // Our own saved raids still load when Warcraft Logs is down
  const { meta, offline } = await metaLiveOrSaved(parsed.host, parsed.code);
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
    ...(offline ? { offline } : {}),
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

/** Each class's auto attack (ability ID and name in the log). Casters' wand shots aren't shown. */
const AUTO_ATTACK: Record<string, { id: number; name: string } | null> = {
  Hunter: { id: 75, name: 'Auto Shot' },
  Mage: null, Priest: null, Warlock: null,
  default: { id: 1, name: 'Melee' },
};

const toFight = (f: FightRef): Fight => ({ ...f, size: null, difficulty: null });
const toActor = (a: ActorRef): Actor => ({ id: a.id, name: a.name, type: 'Player', subType: a.className, petOwner: null });

/**
 * Step 2: one player's snapshot. Pass the player's fight row from step 1 so the fight-wide
 * table isn't fetched again; without it only the damage table is fetched.
 */
export async function snapshotOne(host: string, code: string, fightRef: FightRef, actorRef: ActorRef, row?: FightPlayerRow): Promise<PlayerSnapshot> {
  // v5: auto attacks are also read from damage events when the cast events leave them out
  const cacheKey = `v6:${host}:${code}:${fightRef.id}:${fightRef.endTime}:${actorRef.id}`;
  const cached = await getCachedSnapshot(cacheKey);
  if (cached) return cached;
  const fresh = await buildFreshSnapshot(host, code, fightRef, actorRef, row);
  await putCachedSnapshot(cacheKey, fresh);
  return fresh;
}

async function buildFreshSnapshot(host: string, code: string, fightRef: FightRef, actorRef: ActorRef, row?: FightPlayerRow): Promise<PlayerSnapshot> {
  const fight = toFight(fightRef);
  const actor = toActor(actorRef);
  const auto = AUTO_ATTACK[actorRef.className] ?? AUTO_ATTACK.default;
  const [r, tables, casts, autos] = await Promise.all([
    row ? Promise.resolve(row) : fightRows(host, code, fight.id, false).then((rows) => rows.find((x) => x.id === actor.id || x.name === actor.name)),
    getPlayerTables(host, code, fight.id, actor.id),
    getCastEvents(host, code, fight, actor.id),
    auto ? getAutoAttackEvents(host, code, fight, actor.id, auto.id) : Promise.resolve([]),
  ]);
  // If the cast events left out auto attacks, add them from the damage events for the timeline
  if (auto && autos.length && !casts.events.some((e) => casts.abilities.get(e.abilityGameID) === auto.name)) {
    if (!casts.abilities.has(auto.id)) casts.abilities.set(auto.id, auto.name);
    casts.events = [...casts.events, ...autos.map((e) => ({ ...e, abilityGameID: auto.id }))].sort((a, b) => a.timestamp - b.timestamp);
  }
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

/** Step 3: build the findings and save. */
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
    .map((c) => ({ ...c, sameClass: sameSpec(c.snapshot) }));

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
