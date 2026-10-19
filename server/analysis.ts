import { COOLDOWNS, GAP_SECONDS, IGNORE_FOR_GAPS } from './cooldowns.js';
import { isGeneralBuff } from './buffs.js';
import type { AbilityRow, BuffRow, Comparison, CooldownUse, Finding, Gap, PlayerSnapshot } from './types.js';
import type { Actor, CastEvent, Fight, PlayerTables } from './wcl.js';

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface SnapshotInput {
  host: string;
  code: string;
  fight: Fight;
  actor: Actor;
  /** This player's row from the fight-wide DamageDone table (has activeTime, icon). */
  fightRow?: any;
  /** This player's row from report rankings (has rankPercent, class, spec). */
  rankingRow?: any;
  tables: PlayerTables;
  casts: { events: CastEvent[]; abilities: Map<number, string> };
}

export function buildSnapshot(input: SnapshotInput): PlayerSnapshot {
  const { fight, actor, tables, casts } = input;
  const fightMs = fight.endTime - fight.startTime;
  const fightSeconds = fightMs / 1000;
  const minutes = fightSeconds / 60 || 1;

  // ---- Damage by ability ----
  const dmgEntries: any[] = tables.dmg?.data?.entries ?? [];
  const total = dmgEntries.reduce((s, e) => s + num(e.total), 0);
  const castTable: any[] = tables.casts?.data?.entries ?? [];
  const castCounts: Record<string, number> = {};
  for (const e of castTable) if (e?.name) castCounts[e.name] = num(e.total);

  const abilities: AbilityRow[] = dmgEntries
    .map((e) => {
      const hits = num(e.hitCount) + num(e.tickCount);
      const crits = num(e.critHitCount) + num(e.critTickCount);
      const misses = num(e.missCount);
      const isPet = e.type === 'Pet' || (e.petOwner ?? null) !== null;
      return {
        name: String(e.name ?? 'Unknown'),
        id: num(e.guid),
        total: num(e.total),
        share: total ? num(e.total) / total : 0,
        casts: castCounts[e.name] ?? num(e.uses),
        hits,
        critPct: hits ? round((crits / hits) * 100) : null,
        missPct: hits + misses ? round((misses / (hits + misses)) * 100) : null,
        avgHit: hits ? Math.round(num(e.total) / hits) : null,
        isPet,
      };
    })
    .sort((a, b) => b.total - a.total);

  // ---- Buffs ----
  const buffTotal = num(tables.buffs?.data?.totalTime) || fightMs;
  const buffs: BuffRow[] = (tables.buffs?.data?.auras ?? [])
    .map((a: any) => ({
      name: String(a.name),
      id: num(a.guid),
      uptimePct: round(Math.min(100, (num(a.totalUptime) / buffTotal) * 100)),
      uses: num(a.totalUses),
    }))
    .sort((a: BuffRow, b: BuffRow) => b.uptimePct - a.uptimePct);

  // ---- Cast timeline, cooldowns, gaps ----
  const timeline = casts.events
    .map((e) => ({ t: (e.timestamp - fight.startTime) / 1000, name: casts.abilities.get(e.abilityGameID) ?? String(e.abilityGameID) }))
    .filter((e) => e.t >= 0 && e.t <= fightSeconds)
    .sort((a, b) => a.t - b.t);

  const cooldowns: CooldownUse[] = [];
  const byName = new Map<string, number[]>();
  for (const e of timeline) {
    if (!(e.name in COOLDOWNS)) continue;
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name)!.push(round(e.t));
  }
  for (const [name, times] of byName) {
    const cd = COOLDOWNS[name];
    cooldowns.push({ name, cooldownSec: cd, uses: times.length, possible: possibleUses(fightSeconds, cd), times });
  }

  const active = timeline.filter((e) => !IGNORE_FOR_GAPS.has(e.name)).map((e) => e.t);
  const gaps = findGaps(active, fightSeconds);

  // Casts per minute for every cast ability (used for comparisons)
  const castsPerMinute: Record<string, number> = {};
  for (const [name, count] of Object.entries(castCounts)) castsPerMinute[name] = round(count / minutes, 2);

  // ---- Deaths, damage taken ----
  const deaths = (tables.deaths?.data?.entries ?? []).map((d: any) => ({
    seconds: round((num(d.timestamp) - fight.startTime) / 1000),
    by: d.killingBlow?.name ?? d.ability?.name ?? 'Unknown',
  }));
  const damageTaken = (tables.taken?.data?.entries ?? [])
    .map((e: any) => ({ name: String(e.name), total: num(e.total) }))
    .sort((a: any, b: any) => b.total - a.total)
    .slice(0, 10);

  // ---- Identity, parse, item level ----
  const icon: string = input.fightRow?.icon ?? '';
  const [iconClass, iconSpec] = icon.split('-');
  const className = input.rankingRow?.class ?? iconClass ?? actor.subType;
  const specName = input.rankingRow?.spec ?? iconSpec ?? '';
  const activeTime = num(input.fightRow?.activeTime);

  return {
    host: input.host,
    reportCode: input.code,
    fightId: fight.id,
    encounterId: fight.encounterID,
    encounterName: fight.name,
    kill: !!fight.kill,
    fightSeconds: round(fightSeconds),
    name: actor.name,
    className,
    specName,
    dps: Math.round(total / (fightSeconds || 1)),
    total,
    parsePercent: input.rankingRow?.rankPercent ?? null,
    activePct: activeTime ? round((activeTime / fightMs) * 100) : null,
    itemLevel: tables.summary?.data?.itemLevel ? round(num(tables.summary.data.itemLevel)) : null,
    abilities,
    castsPerMinute,
    castCounts,
    buffs,
    cooldowns,
    gaps,
    castSeconds: active.map((t) => round(t)),
    deaths,
    damageTaken,
  };
}

export function possibleUses(fightSeconds: number, cooldownSec: number): number {
  return Math.floor(fightSeconds / cooldownSec) + 1;
}

export function findGaps(times: number[], fightSeconds: number): Gap[] {
  const pts = [0, ...times, fightSeconds];
  const gaps: Gap[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i] - pts[i - 1];
    if (d > GAP_SECONDS) gaps.push({ start: round(pts[i - 1]), end: round(pts[i]), seconds: round(d) });
  }
  return gaps;
}

// ---------------- Findings ----------------

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;


export function buildFindings(me: PlayerSnapshot, comparisons: Comparison[]): Finding[] {
  const out: Finding[] = [];
  const main = comparisons[0];
  const ref = main?.snapshot;
  const refName = ref?.name ?? '';
  // Class-specific checks (cooldowns, cast rates) only use comparisons of your class.
  const classRef = comparisons.find((c) => c.sameClass)?.snapshot;

  // 1. Cooldowns: unused or under-used (your own numbers always; their numbers only if same class)
  const cdNames = new Set([...me.cooldowns.map((c) => c.name), ...(classRef?.cooldowns.map((x) => x.name) ?? [])]);
  for (const name of cdNames) {
    const mine = me.cooldowns.find((c) => c.name === name);
    const theirs = classRef?.cooldowns.find((c) => c.name === name);
    const cd = COOLDOWNS[name];
    const possible = possibleUses(me.fightSeconds, cd);
    const uses = mine?.uses ?? 0;
    if (uses >= possible) continue;
    const when = mine?.times.length ? ` (at ${mine.times.map(mmss).join(', ')})` : '';
    const refPart = theirs && classRef ? ` ${classRef.name} used it ${theirs.uses}× (${theirs.times.map(mmss).join(', ')}).` : '';
    out.push({
      severity: (theirs?.uses ?? 0) > uses || uses === 0 ? 'high' : 'medium',
      title: `${name}: ${uses} of ${possible} possible uses`,
      detail: `You used it ${uses}×${when} in a ${mmss(me.fightSeconds)} fight with a ${Math.round((cd / 60) * 10) / 10}-minute cooldown.${refPart} Use it early and again as soon as it's ready unless a big damage window is due within a few seconds.`,
    });
  }

  // 2. Fewer casts of key abilities (same class only)
  if (classRef) {
    for (const a of classRef.abilities.filter((x) => !x.isPet && x.casts > 0).slice(0, 5)) {
      const theirCpm = classRef.castsPerMinute[a.name] ?? 0;
      const myCpm = me.castsPerMinute[a.name] ?? 0;
      if (theirCpm > 0 && myCpm < theirCpm * 0.85) {
        out.push({
          severity: myCpm < theirCpm * 0.7 ? 'high' : 'medium',
          title: `Fewer ${a.name} casts than ${classRef.name}`,
          detail: `${me.castCounts[a.name] ?? 0} casts (${myCpm}/min) vs ${classRef.castCounts[a.name] ?? 0} (${theirCpm}/min). It's ${Math.round(a.share * 100)}% of their damage.`,
        });
      }
    }
  }

  // 3. Downtime (general)
  const gapTotal = me.gaps.reduce((s, g) => s + g.seconds, 0);
  if (me.gaps.length) {
    const worst = [...me.gaps].sort((a, b) => b.seconds - a.seconds).slice(0, 3);
    const refGap = ref ? ref.gaps.reduce((s, g) => s + g.seconds, 0) : null;
    out.push({
      severity: gapTotal / me.fightSeconds > 0.08 ? 'high' : 'medium',
      title: `${Math.round(gapTotal)}s with no casts`,
      detail: `Longest gaps: ${worst.map((g) => `${mmss(g.start)}–${mmss(g.end)} (${Math.round(g.seconds)}s)`).join(', ')}.` +
        (refGap !== null ? ` ${refName} had ${Math.round(refGap)}s.` : '') + ' Check whether these were forced (movement, phase change) or avoidable.',
    });
  }

  // 4. Buffs they had that you didn't (cross-class: only buffs any class can get)
  if (ref) {
    const mine = new Map(me.buffs.map((b) => [b.name, b.uptimePct]));
    const missing = ref.buffs
      .filter((b) => b.uptimePct >= 30 && (mine.get(b.name) ?? 0) < 5)
      .filter((b) => main.sameClass || isGeneralBuff(b.name))
      .slice(0, 8);
    if (missing.length) {
      out.push({
        severity: missing.length >= 2 ? 'high' : 'medium',
        title: `Buffs ${refName} had that you didn't`,
        detail: `${missing.map((b) => `${b.name} (${Math.round(b.uptimePct)}%)`).join(', ')}. These are usually consumables you can bring or party buffs from group placement; ask your raid leader about groups.`,
      });
    }
    // Bloodlust/Heroism timing is worth calling out on its own
    const lust = (s: PlayerSnapshot) => s.buffs.find((b) => b.name === 'Bloodlust' || b.name === 'Heroism');
    const myLust = lust(me);
    const theirLust = lust(ref);
    if (theirLust && (!myLust || myLust.uptimePct + 5 < theirLust.uptimePct)) {
      out.push({
        severity: 'medium',
        title: `${theirLust.name}: ${pct0(myLust?.uptimePct)} uptime vs ${pct0(theirLust.uptimePct)}`,
        detail: 'You were outside its range or in another group when it went out. Stand with the raid when it’s called.',
      });
    }
  }

  // 5. Deaths
  for (const d of me.deaths) {
    out.push({ severity: 'high', title: `Died at ${mmss(d.seconds)}`, detail: `Killing blow: ${d.by}. Everything after this was lost damage.` });
  }

  // 6. Avoidable damage taken (general)
  if (ref) {
    const theirs = new Map(ref.damageTaken.map((d) => [d.name, d.total]));
    const worse = me.damageTaken.filter((d) => d.total > 1000 && d.total > 2 * (theirs.get(d.name) ?? 0)).slice(0, 3);
    if (worse.length) {
      out.push({
        severity: 'medium',
        title: 'More damage taken from some abilities',
        detail: worse.map((d) => `${d.name}: ${Math.round(d.total).toLocaleString()} vs ${Math.round(theirs.get(d.name) ?? 0).toLocaleString()}`).join('; ') + '. Often this is standing in something; moving out sooner keeps you casting.',
      });
    }
  }

  // 7. Activity (general)
  if (me.activePct !== null && me.activePct < 95) {
    out.push({ severity: 'medium', title: `Active ${me.activePct}% of the fight`, detail: `${ref?.activePct ? `${refName}: ${ref.activePct}%. ` : ''}Time spent not attacking is the cheapest damage to win back.` });
  }

  // 8. Misses on your main abilities (your own numbers)
  for (const a of me.abilities.filter((x) => !x.isPet && x.casts >= 10 && (x.missPct ?? 0) >= 4).slice(0, 2)) {
    out.push({ severity: 'low', title: `${a.missPct}% misses on ${a.name}`, detail: 'Check whether you are at the hit cap for boss-level targets.' });
  }

  // 9. Item level (general)
  if (ref && me.itemLevel && ref.itemLevel && ref.itemLevel - me.itemLevel >= 3) {
    out.push({ severity: 'low', title: `Item level ${me.itemLevel} vs ${ref.itemLevel}`, detail: 'Part of the gap is gear; focus on the points above first, since they cost nothing.' });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const pct0 = (v: number | undefined) => `${Math.round(v ?? 0)}%`;
