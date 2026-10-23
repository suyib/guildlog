// An analysis reads the fight once ("Reading the fight" stores the whole fight, see pack.ts), then:
//   1. fight    -> everyone's fight-wide numbers (and the whole fight is read and stored)
//   2. snapshot -> one player's analysis data, from the stored fight
//   3. finish   -> builds the findings and saves the result
import { buildFindings, buildSnapshot, buildStrengths } from './analysis.js';
import { saveAnalysis } from './db.js';
import { healingFromPack } from './dashboard.js';
import { type FightPack, getMeta, storedStages } from './pack.js';
import { detailRows, num, rankingRows } from './tables.js';
import type { ActorRef, AnalysisResult, Comparison, Dashboard, FightPlayerRow, PlayerSnapshot, ReportSummary } from './types.js';
import { type CastEvent, type Fight, parseReportUrl } from './wcl.js';

export async function reportSummary(url: string): Promise<ReportSummary> {
  const parsed = parseReportUrl(url);
  // A finished log comes from the stored copy; a live one from Warcraft Logs (or the stored copy if it's down)
  const [{ meta, offline }, stages] = await Promise.all([getMeta(parsed.host, parsed.code), storedStages(parsed.code).catch(() => new Map<number, string>())]);
  // Fights already read in full open without asking Warcraft Logs, so the page can show them straight away
  const stored = new Set([...stages].filter(([, stage]) => stage === 'full').map(([id]) => id));
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
      ...(stored.has(f.id) ? { stored: true } : {}),
    })),
    players: players
      .map((p) => ({ id: p.id, name: p.name, className: p.subType, server: p.server ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    suggestedFight,
    suggestedPlayer: players.some((p) => p.id === parsed.source) ? parsed.source : undefined,
    ...(offline ? { offline } : {}),
  };
}

/** Step 1: everyone's fight-wide numbers, from the stored fight. */
export function rowsFromPack(pack: FightPack): FightPlayerRow[] {
  const ranks = rankingRows(pack.t.rankings);
  const details = detailRows(pack.t.details);
  return ((pack.t.damage?.data?.entries ?? []) as any[])
    .filter((e) => e.type !== 'Pet' && e.type !== 'NPC')
    .map((e): FightPlayerRow => {
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

/** Each class's auto attack (ability ID in the log). Casters' wand shots aren't shown. GAME CONTENT */
const AUTO_ATTACK: Record<string, number | null> = { Hunter: 75, Mage: null, Priest: null, Warlock: null, default: 1 };

/**
 * Step 2: one player's analysis data from the stored fight. Before the whole fight has been read
 * (Warcraft Logs down or slow), it falls back to the fight-wide numbers, without the cast timeline.
 */
export function snapshotFromPack(host: string, code: string, pack: FightPack, actorRef: ActorRef): PlayerSnapshot {
  const fight: Fight = { ...pack.fight, size: null, difficulty: null };
  const row = rowsFromPack(pack).find((x) => x.id === actorRef.id || x.name === actorRef.name);
  const id = row?.id ?? actorRef.id;
  const p = pack.full?.players[id];
  const names = pack.full?.names ?? {};
  const nameOf = (a: number) => names[a]?.[0] ?? `Spell ${a}`;
  const iconOf = (a: number) => names[a]?.[1];
  const tableRow = (tbl: any) => ((tbl?.data?.entries ?? []) as any[]).find((e) => e.id === id);

  // Damage by ability: the player's own, and each pet's separately
  const dmgRow = ([a, total, hits, crits, misses, uses]: number[]) => ({ name: nameOf(a), guid: a, total, hitCount: hits, critHitCount: crits, missCount: misses, uses, abilityIcon: iconOf(a) });
  const dmg = p
    ? { data: { entries: p.dmg.map(dmgRow) } }
    : { data: { entries: ((tableRow(pack.t.damage)?.abilities ?? []) as any[]).filter((a) => a.type !== 'Pet').map((a) => ({ name: a.name, total: a.total })) } };
  const pets = p
    ? p.pets.map((x) => ({ name: x.name, entries: x.dmg.map(dmgRow) }))
    : ((tableRow(pack.t.damage)?.pets ?? []) as any[]).map((x) => ({ name: x.name, entries: [{ name: x.name, total: x.total }] }));
  const casts = { data: { entries: ((tableRow(pack.t.casts)?.abilities ?? []) as any[]).map((a) => ({ name: a.name, total: a.total, abilityIcon: a.abilityIcon })) } };
  const buffs = p
    ? { data: { totalTime: p.buffs.total, auras: p.buffs.auras.map(([a, up, n, bands]) => ({ name: nameOf(a), guid: a, totalUptime: up, totalUses: n, abilityIcon: iconOf(a), bands: (bands ?? []).map(([s, e]) => ({ startTime: s + fight.startTime, endTime: e + fight.startTime })) })) } }
    : { data: { auras: [] } };
  const taken = { data: { entries: ((tableRow(pack.t.taken)?.abilities ?? []) as any[]).map((a) => ({ name: a.name, total: a.total })) } };
  const deaths = { data: { entries: ((pack.t.deaths?.data?.entries ?? []) as any[]).filter((d) => d.id === id).map((d) => ({ timestamp: num(d.deathTime ?? d.timestamp), killingBlow: d.killingBlow })) } };

  // The cast timeline, with auto attacks added from the swings when the casts leave them out
  const abilities = new Map<number, string>();
  const events: CastEvent[] = (p?.casts ?? []).map(([t, a]) => {
    abilities.set(a, nameOf(a));
    return { timestamp: fight.startTime + t * 10, type: 'cast', abilityGameID: a, sourceID: id };
  });
  const auto = AUTO_ATTACK[actorRef.className] === undefined ? AUTO_ATTACK.default : AUTO_ATTACK[actorRef.className];
  const swings = auto ? p?.autos[auto] ?? [] : [];
  if (auto && swings.length && !events.some((e) => e.abilityGameID === auto)) {
    abilities.set(auto, nameOf(auto));
    events.push(...swings.map((t) => ({ timestamp: fight.startTime + t * 10, type: 'cast', abilityGameID: auto, sourceID: id })));
    events.sort((a, b) => a.timestamp - b.timestamp);
  }

  const snapshot = buildSnapshot({
    host,
    code,
    fight,
    actor: { id, name: actorRef.name, type: 'Player', subType: actorRef.className, petOwner: null },
    fightRow: row ? { icon: row.icon, activeTime: row.activeTime } : undefined,
    rankingRow: row ? { rankPercent: row.rankPercent, class: row.className, spec: row.specName } : undefined,
    itemLevel: row?.itemLevel ?? null,
    tables: { dmg, casts, buffs, taken, deaths, pets },
    casts: { events, abilities },
  });
  // The headline total is Warcraft Logs' own (it's what the parse is based on)
  if (row && row.total > 0) {
    snapshot.total = row.total;
    snapshot.dps = Math.round(row.total / (snapshot.fightSeconds || 1));
  }
  snapshot.server = row?.server ?? null;
  // Healing totals, parse and spells, so two healers can be compared on healing
  const healing = healingFromPack(pack, id, false);
  if (healing) snapshot.healing = healing;
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
