import { GAP_SECONDS, IGNORE_FOR_GAPS, cooldownFor } from './cooldowns.js';
import { isGeneralBuff } from './buffs.js';
import { DEFENSE_CAP_NOTE, tankCanBeCritCapped } from './gameData.js';
import { recapLine } from './insights.js';
import type { AbilityRow, BuffRow, BuffWindow, Comparison, CooldownUse, Finding, Gap, GearItem, Healing, PlayerSnapshot, Strength } from './types.js';
import type { Actor, CastEvent, Fight, PlayerTables } from './wcl.js';

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
/** Raid-wide haste effects, shown as their own band on the cast timeline. */
const LUST = new Set(['Bloodlust', 'Heroism', 'Time Warp', 'Ancient Hysteria']);
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
  /** From playerDetails (fetched once per fight). */
  itemLevel?: number | null;
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
  const castIcons = new Map<string, string>();
  for (const e of castTable) if (e?.name && typeof e.abilityIcon === 'string') castIcons.set(e.name, e.abilityIcon);

  const row = (e: any, isPet: boolean, petName?: string, part?: number): AbilityRow => {
    const amount = part ?? num(e.total);
    const scale = num(e.total) ? amount / num(e.total) : 1;
    const hits = Math.round((num(e.hitCount) + num(e.tickCount)) * scale);
    const crits = Math.round((num(e.critHitCount) + num(e.critTickCount)) * scale);
    const misses = Math.round(num(e.missCount) * scale);
    return {
      name: String(e.name ?? 'Unknown'),
      id: num(e.guid),
      total: amount,
      share: total ? amount / total : 0,
      casts: isPet ? num(e.uses) : (castCounts[e.name] ?? num(e.uses)),
      hits,
      critPct: hits ? round((crits / hits) * 100) : null,
      missPct: hits + misses ? round((misses / (hits + misses)) * 100) : null,
      avgHit: hits ? Math.round(amount / hits) : null,
      isPet,
      ...(petName ? { petName } : {}),
      icon: typeof e.abilityIcon === 'string' ? e.abilityIcon : undefined,
    };
  };

  // Warcraft Logs folds pet damage into the owner's table under the pet's ability names ("Melee",
  // "Bite"), so take each pet's own share back out and list it separately as pet damage.
  const petRows: AbilityRow[] = [];
  const petTotals = new Map<number, number>();
  for (const pet of tables.pets ?? []) {
    for (const e of pet.entries) {
      if (!num(e.total)) continue;
      petTotals.set(num(e.guid), (petTotals.get(num(e.guid)) ?? 0) + num(e.total));
      petRows.push(row(e, true, pet.name));
    }
  }
  // Folded in when the owner's rows hold at least each pet ability's damage; otherwise nothing to take out
  const folded = [...petTotals].every(([guid, t]) => dmgEntries.some((e) => num(e.guid) === guid && num(e.total) >= t * 0.99));
  if (!folded) petTotals.clear();
  const ownRows: AbilityRow[] = [];
  for (const e of dmgEntries) {
    const flaggedPet = e.type === 'Pet' || (e.petOwner ?? null) !== null;
    if (flaggedPet) {
      if (!petRows.some((r) => r.id === num(e.guid))) ownRows.push(row(e, true));
      continue;
    }
    const own = num(e.total) - (petTotals.get(num(e.guid)) ?? 0);
    // Anything left after the pet's share is the player's own (a hunter's melee swings, say)
    if (own > Math.max(1, num(e.total) * 0.005)) ownRows.push(row(e, false, undefined, own));
  }
  const abilities: AbilityRow[] = [...ownRows, ...petRows].sort((a, b) => b.total - a.total);
  // Shares of everything listed, in case a pet's damage wasn't folded into the owner's table
  const listed = abilities.reduce((t, a) => t + a.total, 0) || 1;
  for (const a of abilities) a.share = a.total / listed;

  // ---- Buffs ----
  const buffTotal = num(tables.buffs?.data?.totalTime) || fightMs;
  const buffs: BuffRow[] = (tables.buffs?.data?.auras ?? [])
    .map((a: any) => ({
      name: String(a.name),
      id: num(a.guid),
      uptimePct: round(Math.min(100, (num(a.totalUptime) / buffTotal) * 100)),
      uses: num(a.totalUses),
      icon: typeof a.abilityIcon === 'string' ? a.abilityIcon : undefined,
    }))
    .sort((a: BuffRow, b: BuffRow) => b.uptimePct - a.uptimePct);

  // When raid haste and your own big cooldowns were active (from the buff's uptime bands)
  const windows: BuffWindow[] = [];
  for (const a of (tables.buffs?.data?.auras ?? []) as any[]) {
    const name = String(a?.name ?? '');
    const kind = LUST.has(name) ? 'lust' : cooldownFor(name, input.host) !== undefined ? 'cooldown' : null;
    if (!kind) continue;
    for (const b of (a.bands ?? []) as any[]) {
      const start = round(Math.max(0, (num(b.startTime) - fight.startTime) / 1000));
      const end = round(Math.min(fightSeconds, (num(b.endTime) - fight.startTime) / 1000));
      if (end > start) windows.push({ name, start, end, kind, icon: typeof a.abilityIcon === 'string' ? a.abilityIcon : undefined });
    }
  }

  // ---- Cast timeline, cooldowns, gaps ----
  const timeline = casts.events
    .map((e) => ({ t: (e.timestamp - fight.startTime) / 1000, name: casts.abilities.get(e.abilityGameID) ?? String(e.abilityGameID) }))
    .filter((e) => e.t >= 0 && e.t <= fightSeconds)
    .sort((a, b) => a.t - b.t);

  const cooldowns: CooldownUse[] = [];
  const byName = new Map<string, number[]>();
  for (const e of timeline) {
    if (cooldownFor(e.name, input.host) === undefined) continue;
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name)!.push(round(e.t));
  }
  for (const [name, times] of byName) {
    const cd = cooldownFor(name, input.host)!;
    cooldowns.push({ name, cooldownSec: cd, uses: times.length, possible: possibleUses(fightSeconds, cd), times, icon: castIcons.get(name) });
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
    itemLevel: input.itemLevel ? round(input.itemLevel) : null,
    abilities,
    castsPerMinute,
    castCounts,
    buffs,
    cooldowns,
    gaps,
    castSeconds: active.map((t) => round(t)),
    casts: timeline.map((e) => ({ t: round(e.t, 2), name: e.name, ...(IGNORE_FOR_GAPS.has(e.name) ? { auto: true } : {}) })),
    windows,
    deaths,
    damageTaken,
  };
}

export function possibleUses(fightSeconds: number, cooldownSec: number): number {
  return Math.floor(fightSeconds / cooldownSec) + 1;
}

/** Seconds at the start of a pull that don't count as downtime (pre-pot, waiting for the tank). */
const OPENER_GRACE = 6;

export function findGaps(times: number[], fightSeconds: number): Gap[] {
  const pts = [0, ...times, fightSeconds];
  const gaps: Gap[] = [];
  for (let i = 1; i < pts.length; i++) {
    const start = i === 1 ? Math.min(OPENER_GRACE, pts[i]) : pts[i - 1];
    const d = pts[i] - start;
    if (d > GAP_SECONDS) gaps.push({ start: round(start), end: round(pts[i]), seconds: round(d) });
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
    const cd = mine?.cooldownSec ?? theirs?.cooldownSec ?? cooldownFor(name, me.host);
    if (!cd) continue;
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
      // Ignore tiny differences: in a short fight one cast either way isn't meaningful.
      const expected = (theirCpm * me.fightSeconds) / 60;
      const mine = me.castCounts[a.name] ?? 0;
      if (theirCpm > 0 && myCpm < theirCpm * 0.85 && expected - mine >= 2) {
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
    const recap = recapLine(d, short);
    out.push({ severity: 'high', title: `Died at ${mmss(d.seconds)}`, detail: `Killing blow: ${d.by}.${recap ? ` ${recap}.` : ''} Everything after this was lost damage.` });
  }

  // Potions, damage over time and tanking (from the whole fight's events)
  out.push(...insightFeedback(me, false).work);

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
  // Only abilities you cast yourself (not auto attacks or pet abilities).
  for (const a of me.abilities.filter((x) => !x.isPet && !IGNORE_FOR_GAPS.has(x.name) && (me.castCounts[x.name] ?? 0) >= 10 && (x.missPct ?? 0) >= 4).slice(0, 2)) {
    out.push({ severity: 'low', title: `${a.missPct}% misses on ${a.name}`, detail: 'Check whether you are at the hit cap for boss-level targets.' });
  }

  // 9. Item level (general)
  if (ref && me.itemLevel && ref.itemLevel && ref.itemLevel - me.itemLevel >= 3) {
    out.push({ severity: 'low', title: `Item level ${me.itemLevel} vs ${ref.itemLevel}`, detail: 'Part of the gap is gear; focus on the points above first, since they cost nothing.' });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const pct0 = (v: number | undefined) => `${Math.round(v ?? 0)}%`;

/**
 * What went well, so the summary isn't only criticism. Uses your own numbers, plus the
 * comparisons when there are any (class-specific points only against your own class).
 */
export function buildStrengths(me: PlayerSnapshot, comparisons: Comparison[], gear?: GearItem[]): Strength[] {
  const out: (Strength & { weight: number })[] = [];
  const ref = comparisons[0]?.snapshot;
  const classRef = comparisons.find((c) => c.sameClass)?.snapshot;

  // Parse
  if (me.parsePercent !== null && me.parsePercent >= 75) {
    out.push({ weight: 10, title: `Parsed ${Math.round(me.parsePercent)}`, detail: me.parsePercent >= 95 ? 'A top-tier performance for your spec on this boss.' : 'Better than most of your spec on this boss.' });
  }

  // DPS against the comparisons
  const beaten = comparisons.filter((c) => c.snapshot.dps > 0 && me.dps > c.snapshot.dps);
  if (beaten.length) {
    out.push({ weight: 9, title: `More DPS than ${beaten.map((c) => c.snapshot.name).join(' and ')}`, detail: beaten.map((c) => `${Math.round(me.dps).toLocaleString('en-US')} vs ${Math.round(c.snapshot.dps).toLocaleString('en-US')}`).join('; ') + '.' });
  }

  // Cooldowns used every time they were ready
  const fullCds = me.cooldowns.filter((c) => c.possible > 0 && c.uses >= c.possible);
  if (fullCds.length) {
    out.push({ weight: 8, title: fullCds.length === me.cooldowns.length ? 'Every cooldown used on time' : 'Cooldowns used on time', detail: fullCds.map((c) => `${c.name} (${c.times.map(mmss).join(', ')})`).join(', ') + '.' });
  }

  // Staying alive and active
  if (me.deaths.length === 0 && (!ref || ref.deaths.length > 0)) {
    out.push({ weight: ref && ref.deaths.length ? 8 : 5, title: 'Stayed alive the whole fight', detail: ref && ref.deaths.length ? `${ref.name} died; you kept doing damage to the end.` : 'No deaths, so no lost damage.' });
  }
  if (me.activePct !== null && (me.activePct >= 95 || (ref?.activePct && me.activePct >= ref.activePct + 2))) {
    out.push({ weight: 7, title: `Active ${me.activePct}% of the fight`, detail: ref?.activePct ? `${ref.name}: ${ref.activePct}%. Little time lost to downtime.` : 'Almost no time spent not attacking.' });
  }
  const myGap = me.gaps.reduce((s, g) => s + g.seconds, 0);
  if (me.gaps.length === 0) {
    out.push({ weight: 6, title: 'No gaps over 4 seconds', detail: 'You kept casting from pull to kill.' });
  } else if (ref && myGap + 3 < ref.gaps.reduce((s, g) => s + g.seconds, 0)) {
    out.push({ weight: 5, title: 'Less downtime than ' + ref.name, detail: `${Math.round(myGap)}s with no casts vs ${Math.round(ref.gaps.reduce((s, g) => s + g.seconds, 0))}s.` });
  }

  // Key abilities cast more often than a same-class comparison
  if (classRef) {
    const better = classRef.abilities
      .filter((a) => !a.isPet && a.casts > 0 && !IGNORE_FOR_GAPS.has(a.name))
      .slice(0, 5)
      .filter((a) => (classRef.castsPerMinute[a.name] ?? 0) > 0 && (me.castsPerMinute[a.name] ?? 0) >= (classRef.castsPerMinute[a.name] ?? 0) * 1.05);
    if (better.length) {
      out.push({ weight: 6, title: `More casts per minute than ${classRef.name}`, detail: better.map((a) => `${a.name} ${me.castsPerMinute[a.name]}/min vs ${classRef.castsPerMinute[a.name]}/min`).join('; ') + '.' });
    }
  }

  // Potions, damage over time and tanking
  for (const g of insightFeedback(me, false).good) out.push({ weight: 5, ...g });

  // Consumables and buffs
  const consumables = me.buffs.filter((b) => /Flask|Elixir|Well Fed|Scroll|Oil|Sharpening|Stone/i.test(b.name) && b.uptimePct >= 90).map((b) => b.name);
  if (consumables.length) {
    out.push({ weight: 4, title: 'Consumables up all fight', detail: consumables.slice(0, 5).join(', ') + '.' });
  }

  // Accuracy on your main abilities
  const clean = me.abilities.filter((a) => !a.isPet && !IGNORE_FOR_GAPS.has(a.name) && (me.castCounts[a.name] ?? 0) >= 10 && a.missPct !== null && a.missPct === 0);
  if (clean.length) {
    out.push({ weight: 3, title: 'No misses on your main abilities', detail: clean.slice(0, 3).map((a) => a.name).join(', ') + ' never missed.' });
  }

  // Gear
  if (gear?.length) {
    const enchantable = gear.filter((g) => g.enchantable);
    if (enchantable.length && enchantable.every((g) => g.enchant || g.enchantId)) {
      out.push({ weight: 4, title: 'Fully enchanted', detail: `All ${enchantable.length} enchantable slots have an enchant.` });
    }
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 6).map(({ title, detail }) => ({ title, detail }));
}

// ---------- Healing ----------

/** Healing well above their damage on this fight: compared on healing rather than damage. */
export const isHealerSnapshot = (s: PlayerSnapshot) => !!s.healing && s.healing.total > 2 * s.total;

/**
 * "What to work on" and "What worked well" for the Healing tab, in plain language: overhealing,
 * staying busy, the healing parse, cooldowns, deaths and consumables.
 */
export function healingFeedback(me: PlayerSnapshot, h: Healing, ref?: PlayerSnapshot): { work: Finding[]; good: Strength[] } {
  const work: Finding[] = [];
  const good: Strength[] = [];
  const round = (v: number) => Math.round(v);

  // Against another healer, when one is compared
  const rh = ref && isHealerSnapshot(ref) ? ref.healing! : null;
  if (ref && rh) {
    const gap = rh.hps > 0 ? (h.hps - rh.hps) / rh.hps : 0;
    if (gap <= -0.1) {
      // Where the difference comes from: spells that are a bigger part of their healing than yours
      const theirTop = rh.abilities.slice(0, 4).map((a) => {
        const mine = h.abilities.find((x) => x.name === a.name);
        return { name: a.name, theirs: a.share, mine: mine?.share ?? 0 };
      }).filter((x) => x.theirs - x.mine >= 0.08);
      work.push({
        severity: 'high',
        title: `${round(Math.abs(gap) * 100)}% less healing per second than ${ref.name}`,
        detail: theirTop.length
          ? `${theirTop.slice(0, 2).map((x) => `${x.name} is ${round(x.theirs * 100)}% of their healing and ${round(x.mine * 100)}% of yours`).join('; ')}.`
          : `${ref.name} healed ${round(rh.hps).toLocaleString('en-US')} per second against your ${round(h.hps).toLocaleString('en-US')}.`,
      });
    } else if (gap >= 0.05) {
      good.push({ title: `${round(gap * 100)}% more healing per second than ${ref.name}`, detail: `${round(h.hps).toLocaleString('en-US')} against their ${round(rh.hps).toLocaleString('en-US')}.` });
    }
    if (h.overhealPct !== null && rh.overhealPct !== null && h.overhealPct - rh.overhealPct >= 10) {
      work.push({ severity: 'medium', title: `More overhealing than ${ref.name}`, detail: `${round(h.overhealPct)}% of your healing was overheal, against their ${round(rh.overhealPct)}%.` });
    }
    if (h.activePct !== null && rh.activePct !== null && rh.activePct - h.activePct >= 10) {
      work.push({ severity: 'medium', title: `Less time casting than ${ref.name}`, detail: `Active ${h.activePct}% of the fight, against their ${rh.activePct}%.` });
    }
    // Spells they cast that you didn't
    const missing = rh.abilities.filter((a) => a.share >= 0.08 && !h.abilities.some((x) => x.name === a.name)).slice(0, 2);
    for (const a of missing) work.push({ severity: 'low', title: `${a.name} not used`, detail: `${round(a.share * 100)}% of ${ref.name}\u2019s healing came from ${a.name}.` });
  }

  // Parse and place among the healers
  if (h.parse !== null && h.parse < 25) work.push({ severity: 'high', title: `Healing parse ${round(h.parse)}`, detail: 'Below most players of your spec on this boss. Overhealing and time spent not casting (below) are the usual reasons.' });
  if (h.parse !== null && h.parse >= 75) good.push({ title: `Healing parse ${round(h.parse)}`, detail: 'Better than most players of your spec on this boss.' });
  if (h.rank && h.rank.of > 1 && h.rank.place === 1) good.push({ title: 'Top healer in the raid', detail: `Most healing of the ${h.rank.of} healers on this fight.` });

  // Overhealing: overall, then the spells that waste the most
  if (h.overhealPct !== null && h.overhealPct >= 45) {
    work.push({ severity: 'medium', title: `${round(h.overhealPct)}% overhealing`, detail: 'Almost half of what you cast healed people who were already full. Waiting a moment longer, or switching to a smaller heal, saves mana for when it’s needed.' });
  } else if (h.overhealPct !== null && h.overhealPct <= 25) {
    good.push({ title: `Only ${round(h.overhealPct)}% overhealing`, detail: 'Very little of your healing was wasted on full health bars.' });
  }
  for (const a of h.abilities.filter((x) => x.share >= 0.1 && (x.overhealPct ?? 0) >= 60).slice(0, 2)) {
    work.push({ severity: 'low', title: `${a.name}: ${round(a.overhealPct!)}% overheal`, detail: `${a.name} is ${round(a.share * 100)}% of your healing but mostly lands on people who are already full. Use it later, or on someone lower.` });
  }

  // Staying busy (healers have quiet moments, so the bar is lower than for damage)
  if (h.activePct !== null && h.activePct < 60) work.push({ severity: 'medium', title: `Active ${h.activePct}% of the fight`, detail: 'A lot of time not casting. Keeping a heal-over-time or shield rolling on the tank, or adding damage in quiet moments, helps.' });
  else if (h.activePct !== null && h.activePct >= 85) good.push({ title: `Active ${h.activePct}% of the fight`, detail: 'Always casting something.' });

  // Cooldowns (mana and healing cooldowns that are tracked)
  for (const c of me.cooldowns.filter((x) => x.possible > 0 && x.uses < x.possible).slice(0, 2)) {
    work.push({ severity: 'medium', title: `${c.name}: ${c.uses} of ${c.possible} possible uses`, detail: 'Use it early and again as soon as it’s ready, unless a big damage phase is coming within a few seconds.' });
  }
  if (me.cooldowns.length && me.cooldowns.every((x) => x.uses >= x.possible)) good.push({ title: 'Cooldowns on time', detail: 'Every tracked cooldown used as often as the fight allowed.' });

  // Alive, and prepared
  if (me.deaths.length) {
    const recap = recapLine(me.deaths[0], short);
    work.push({ severity: 'high', title: `Died at ${mmss(me.deaths[0].seconds)}`, detail: `Killed by ${me.deaths[0].by}.${recap ? ` ${recap}.` : ''} A dead healer puts the whole raid at risk; the Buffs & survival page shows what hit you.` });
  } else good.push({ title: 'Stayed alive the whole fight', detail: 'No deaths, so no lost healing.' });
  const extra = insightFeedback(me, true);
  work.push(...extra.work);
  good.push(...extra.good);
  const consumables = me.buffs.filter((b) => /Flask|Elixir|Well Fed|Scroll|Oil|Mana/i.test(b.name) && b.uptimePct >= 90).map((b) => b.name);
  if (consumables.length) good.push({ title: 'Consumables up all fight', detail: consumables.slice(0, 5).join(', ') + '.' });

  return { work, good };
}

const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));

/**
 * Potions, damage-over-time uptime, mana (healers) and being crit as a tank, from the whole
 * fight's events. Empty for fights read before v0.25.0. The Discord DMs use the same thresholds.
 */
export function insightFeedback(me: PlayerSnapshot, healer: boolean): { work: Finding[]; good: Strength[] } {
  const work: Finding[] = [];
  const good: Strength[] = [];
  const long = me.fightSeconds >= 90;

  // Potions: one before the pull and one during the fight
  const pots = me.potions;
  if (pots && long) {
    const n = pots.used.length + (pots.prePot ? 1 : 0);
    if (n === 0) {
      work.push({ severity: 'medium', title: 'No potion used', detail: `A combat potion is free ${healer ? 'healing (a mana potion)' : 'damage'}: drink one just before the pull and another during the fight.` });
    } else {
      good.push({ title: pots.prePot && pots.used.length ? 'Pre-potted and used a potion' : 'Potion used', detail: [pots.prePot ? 'One running at the pull' : '', ...pots.used.map((u) => `${u.name} at ${mmss(u.seconds)}`)].filter(Boolean).join(', ') + '.' });
      if (!pots.prePot && me.fightSeconds >= 150) work.push({ severity: 'low', title: 'Potion before the pull too', detail: 'Drinking one just before the pull gives you a second potion in a fight this long.' });
    }
  }

  // Damage over time kept up on the main target
  const dots = (me.dots ?? []).filter((d) => d.sharePct >= 5);
  const lowDots = dots.filter((d) => d.uptimePct < 80);
  for (const d of lowDots.slice(0, 2)) {
    work.push({ severity: d.uptimePct < 60 ? 'high' : 'medium', title: `${d.name} up ${d.uptimePct}% of the fight`, detail: `It's ${d.sharePct}% of your damage, so every second it's missing costs you. Refresh it just before it runs out.` });
  }
  if (dots.length && !lowDots.length && dots.every((d) => d.uptimePct >= 90)) {
    good.push({ title: 'Damage over time kept up', detail: dots.map((d) => `${d.name} ${d.uptimePct}%`).join(', ') + '.' });
  }

  // Mana, for healers
  const mana = me.mana;
  if (healer && mana) {
    if (mana.oomAt !== null) {
      work.push({ severity: 'high', title: `Ran out of mana at ${mmss(mana.oomAt)}`, detail: `${mana.lowSeconds}s under 10% mana. Pace your bigger heals, use a mana potion or rune, and ask for Innervate or a mana cooldown before you're empty.` });
    } else if (mana.endPct !== null && mana.endPct >= 50 && me.kill && me.fightSeconds >= 120) {
      work.push({ severity: 'low', title: `Finished with ${mana.endPct}% mana`, detail: 'You had mana to spare: bigger heals or more of them were affordable.' });
    } else if (mana.endPct !== null && mana.endPct <= 30) {
      good.push({ title: 'Mana used well', detail: `Finished with ${mana.endPct}% without running out.` });
    }
  }

  // Tanks: crits from the boss's melee mean you're under the defense cap
  const m = me.mitigation;
  if (m && m.swings >= 30 && tankCanBeCritCapped(me.host)) {
    if (m.crits > 0) work.push({ severity: 'high', title: `Crit by the boss ${m.crits}×`, detail: `${DEFENSE_CAP_NOTE} Avoided ${m.avoidPct}% of ${m.swings} swings.` });
    else good.push({ title: 'Never crit by the boss', detail: `Avoided ${m.avoidPct}% of ${m.swings} swings${m.blocked ? `, blocked ${m.blocked}` : ''}.` });
  }
  return { work, good };
}
