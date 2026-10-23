// One read of each boss fight from Warcraft Logs, stored compactly ("a fight pack"). Everything
// else (a player's analysis, gear and charts, the raid breakdown, Whole night, the Discord DMs and
// raid summary) is worked out from the stored pack, so Warcraft Logs is asked about a fight once.
//
// A pack is read in two stages, each saved as soon as it arrives:
//   tables  everyone's fight-wide tables, rankings and player details (a few requests). Enough
//           for the Discord bot, raid cards and the whole-raid numbers.
//   full    every event of the fight boiled down per player: damage and healing by spell, casts on
//           a timeline, buffs, per-second lines, plus gear with item names.
// Reports' fights and players (fight 0) are stored too, and reused once the log is finished.
import { gunzipSync, gzipSync } from 'node:zlib';
import { cooldownFor } from './cooldowns.js';
import { MELEE_ID, POTION_IDS } from './gameData.js';
import { gearFrom } from './dashboard.js';
import { dbEnabled, rest } from './db.js';
import { type FightDigest, DIGEST_VERSION, digestFromPack } from './fightDigest.js';
import { countsFrom, detailRows, num } from './tables.js';
import type { FightRef, GearItem, Offline } from './types.js';
import { type ReportMeta, WclTimeout, getAbilities, getFightEvents, getReportMeta, getTables } from './wcl.js';

export const PACK_VERSION = 1;

/** Everyone's fight-wide tables, trimmed to the fields that are used (Warcraft Logs' own shapes). */
export interface PackTables {
  damage: any;
  casts: any;
  taken: any;
  deaths: any;
  healing: any;
  rankings: any;
  hps: any;
  details: any;
  interrupts: Record<string, number>;
  dispels: Record<string, number>;
  /** Debuffs on the boss and its adds: [{ guid, name, totalUptime, totalUses, abilityIcon }]. */
  debuffs?: any[];
}

/** [abilityId, total, hits, crits, misses, uses] */
export type DamageRow = number[];
/** [abilityId, total, overheal, hits, crits] */
export type HealRow = number[];

export interface PackPlayer {
  dmg: DamageRow[];
  pets: { name: string; dmg: DamageRow[] }[];
  heal: HealRow[];
  /** [centiseconds from the pull, abilityId] */
  casts: number[][];
  /** Auto attack swings by ability (1 Melee, 75 Auto Shot), centiseconds from the pull. */
  autos: Record<string, number[]>;
  /** totalTime in ms; auras: [abilityId, uptime ms, uses, bands ([start, end] ms from the pull) for Bloodlust and big cooldowns] */
  buffs: { total: number; auras: [number, number, number, number[][]?][] };
  /** Per second: damage done (with pets), healing done, and damage taken as [second, abilityId, amount]. */
  db: number[];
  hb: number[];
  tb: number[][];
  gear: GearItem[];
  /** Damage-over-time spells on their main target: [abilityId, uptime per mille, ticks]. */
  dots?: number[][];
  /** Mana in percent every 5 seconds (-1 before it's known), for anyone who uses mana. */
  mana?: number[];
  /** A boss's melee swings at this player: [swings, dodged, parried, missed, blocked, crits]. */
  mit?: number[];
}

/** What happened in the 10 seconds before a death. */
export interface PackDeath {
  id: number;
  /** Centiseconds from the pull. */
  at: number;
  /** The last hits: [centiseconds, abilityId, amount, source name]. */
  hits: (number | string)[][];
  /** Healing received in those 10 seconds. */
  healed: number;
}

export interface PackFull {
  /** abilityId -> [name, icon] for everything the pack mentions. */
  names: Record<string, [string, string?]>;
  players: Record<string, PackPlayer>;
  /** The raid's damage per second (players and pets). */
  raid: number[];
  /** Bloodlust / Heroism casts: [centiseconds, sourceId, abilityId] */
  lust: number[][];
  deaths?: PackDeath[];
}

export interface FightPack {
  v: number;
  stage: 'tables' | 'full';
  fight: FightRef;
  t: PackTables;
  full?: PackFull;
}

const q = encodeURIComponent;
const pack64 = (v: unknown) => gzipSync(Buffer.from(JSON.stringify(v))).toString('base64');
const unpack64 = <T>(s: string): T => JSON.parse(gunzipSync(Buffer.from(s, 'base64')).toString());

// ---------- Storage ----------

interface PackRow { report_code: string; fight_id: number; host: string; stage: string; created_at: string; digest: any; pack?: string | null }

/** A stored pack (null if there isn't a usable one). */
export async function readPack(code: string, fightId: number): Promise<FightPack | null> {
  if (!dbEnabled()) return null;
  const row: PackRow | undefined = (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.${fightId}&select=stage,pack`).catch(() => null))?.[0];
  if (!row?.pack) return null;
  try {
    const p = unpack64<FightPack>(row.pack);
    return p.v === PACK_VERSION ? p : null;
  } catch {
    return null;
  }
}

async function writePack(host: string, code: string, pack: FightPack, digest: FightDigest) {
  if (!dbEnabled()) return;
  await rest('fight_packs?on_conflict=report_code,fight_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ report_code: code, fight_id: pack.fight.id, host, stage: pack.stage, digest, pack: pack64(pack), updated_at: new Date().toISOString() }),
  });
}

/**
 * Each stored fight's stage and digest for a report (small: the packs themselves aren't read).
 * Digests from an older version are worked out again from their packs, without Warcraft Logs.
 */
export async function digestRows(code: string): Promise<{ fightId: number; stage: string; digest: FightDigest | null }[]> {
  if (!dbEnabled()) return [];
  const rows: PackRow[] = (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=gt.0&select=fight_id,stage,digest`)) ?? [];
  return Promise.all(rows.map(async (r) => {
    let digest = r.digest as FightDigest | null;
    if ((r.stage === 'tables' || r.stage === 'full') && digest?.v !== DIGEST_VERSION) digest = (await refreshDigest(code, r.fight_id).catch(() => null)) ?? digest;
    return { fightId: r.fight_id, stage: r.stage, digest };
  }));
}

/** Which of a report's fights are stored, and how far (just the stage, nothing else is read). */
export async function storedStages(code: string): Promise<Map<number, string>> {
  if (!dbEnabled()) return new Map();
  const rows: PackRow[] = (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=gt.0&select=fight_id,stage`)) ?? [];
  return new Map(rows.map((r) => [r.fight_id, r.stage]));
}

/** The stored digests of a report's fights, in fight order. */
export async function storedDigests(code: string): Promise<FightDigest[]> {
  return (await digestRows(code).catch(() => []))
    .map((r) => r.digest)
    .filter((d): d is FightDigest => !!d && (d.v ?? 0) >= 3)
    .sort((a, b) => a.startTime - b.startTime);
}

/** Work a stored fight's digest out again from its pack (no Warcraft Logs request) and store it. */
async function refreshDigest(code: string, fightId: number): Promise<FightDigest | null> {
  const row: PackRow | undefined = (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.${fightId}&select=host,pack`))?.[0];
  if (!row?.pack) return null;
  const pack = unpack64<FightPack>(row.pack);
  if (pack.v !== PACK_VERSION) return null;
  const digest = digestFromPack(row.host, pack);
  await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.${fightId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ digest }) }).catch(() => undefined);
  return digest;
}

// ---------- The report (fight 0) ----------

/** A finished log doesn't change: three hours after its last fight, the stored copy is used as is. */
const isFinished = (m: ReportMeta) => Date.now() - (m.startTime + (m.fights.at(-1)?.endTime ?? 0)) > 3 * 3_600_000;

/**
 * The report's fights and players. A finished log comes from the stored copy (no request); a live
 * one is read from Warcraft Logs, falling back to the stored copy if Warcraft Logs is down.
 * `fresh` always asks Warcraft Logs first (used by /raidend).
 */
export async function getMeta(host: string, code: string, opts: { fresh?: boolean; timeoutMs?: number } = {}): Promise<{ meta: ReportMeta; offline?: Offline }> {
  const stored: PackRow | undefined = dbEnabled() ? (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.0&select=stage,digest,created_at,updated_at`).catch(() => null))?.[0] : undefined;
  const storedMeta = stored?.digest as ReportMeta | undefined;
  // (copies stored before v0.23.0 lack the region, so they're read once more)
  if (storedMeta && stored!.stage === 'meta-final' && !opts.fresh && storedMeta.region !== undefined) return { meta: storedMeta };
  try {
    const meta = await getReportMeta(host, code, opts.timeoutMs);
    const finished = isFinished(meta);
    if (dbEnabled() && (!storedMeta || finished || storedMeta.fights.length !== meta.fights.length || storedMeta.masterData.actors.length !== meta.masterData.actors.length || storedMeta.region === undefined)) {
      await rest('fight_packs?on_conflict=report_code,fight_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ report_code: code, fight_id: 0, host, stage: finished ? 'meta-final' : 'meta-live', digest: meta, pack: null, updated_at: new Date().toISOString() }),
      }).catch(() => undefined);
    }
    return { meta };
  } catch (e) {
    if (!storedMeta) throw e;
    return { meta: storedMeta, offline: { savedAt: (stored as any).updated_at ?? stored!.created_at } };
  }
}

/** The report's region ("eu", "us"), for portraits and character levels. */
export async function reportRegion(host: string, code: string): Promise<string | null> {
  return (await getMeta(host, code).catch(() => null))?.meta.region ?? null;
}

// ---------- Reading a fight from Warcraft Logs ----------

/** Run at most `n` jobs at once. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const pick = (o: any, keys: string[]) => {
  if (!o || typeof o !== 'object') return o;
  const out: any = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
const entriesOf = (table: any, keys: string[], abilityKeys?: string[], petKeys?: string[]) => ({
  data: {
    entries: ((table?.data?.entries ?? []) as any[]).map((e) => ({
      ...pick(e, keys),
      ...(abilityKeys && Array.isArray(e.abilities) ? { abilities: e.abilities.map((a: any) => pick(a, abilityKeys)) } : {}),
      ...(petKeys && Array.isArray(e.pets) ? { pets: e.pets.map((a: any) => pick(a, petKeys)) } : {}),
    })),
  },
});
const GEAR_KEYS = ['id', 'slot', 'quality', 'icon', 'name', 'itemLevel', 'permanentEnchant', 'permanentEnchantName', 'gems'];
const trimRankings = (r: any) => {
  const roles = r?.data?.[0]?.roles ?? {};
  const out: any = {};
  for (const k of ['tanks', 'healers', 'dps']) {
    out[k] = { characters: ((roles[k]?.characters ?? []) as any[]).map((c) => ({ ...pick(c, ['name', 'class', 'spec', 'rankPercent']), ...(c.server?.name ? { server: { name: c.server.name } } : {}) })) };
  }
  return { data: [{ roles: out }] };
};
const trimDetails = (d: any) => {
  const pd = d?.data?.playerDetails ?? d?.playerDetails ?? {};
  const row = (p: any) => ({
    ...pick(p, ['id', 'name', 'type', 'server', 'icon', 'minItemLevel', 'maxItemLevel']),
    specs: ((p.specs ?? []) as any[]).map((s) => pick(s, ['spec', 'role'])),
    ...(p.combatantInfo ? { combatantInfo: { stats: p.combatantInfo.stats ?? null, gear: ((p.combatantInfo.gear ?? []) as any[]).map((g) => pick(g, GEAR_KEYS)) } } : {}),
  });
  return { data: { playerDetails: { tanks: (pd.tanks ?? []).map(row), healers: (pd.healers ?? []).map(row), dps: (pd.dps ?? []).map(row) } } };
};

/** Stage one: the fight-wide tables (three requests at once; rankings and details are optional). */
async function readTables(host: string, code: string, fightId: number): Promise<PackTables> {
  const optional = (p: Promise<Record<string, any>>) => p.catch(() => ({}) as Record<string, any>);
  const [a, b, c] = await Promise.all([
    getTables(host, code, fightId, `
      damage: table(dataType:DamageDone, fightIDs:$fid) casts: table(dataType:Casts, fightIDs:$fid)
      taken: table(dataType:DamageTaken, fightIDs:$fid) deaths: table(dataType:Deaths, fightIDs:$fid)`, 35_000),
    getTables(host, code, fightId, `
      healing: table(dataType:Healing, fightIDs:$fid) interrupts: table(dataType:Interrupts, fightIDs:$fid)
      dispels: table(dataType:Dispels, fightIDs:$fid)
      debuffs: table(dataType:Debuffs, fightIDs:$fid, hostilityType:Enemies)`, 30_000),
    optional(getTables(host, code, fightId, `
      rankings(fightIDs:$fid, playerMetric:dps) hps: rankings(fightIDs:$fid, playerMetric:hps)
      details: playerDetails(fightIDs:$fid, includeCombatantInfo:true)`, 25_000)),
  ]);
  return {
    damage: entriesOf(a.damage, ['id', 'name', 'type', 'icon', 'total', 'activeTime'], ['name', 'total', 'type'], ['name', 'total']),
    casts: entriesOf(a.casts, ['id', 'name', 'type', 'icon'], ['name', 'guid', 'total', 'abilityIcon']),
    taken: entriesOf(a.taken, ['id', 'name', 'type', 'total'], ['name', 'guid', 'total', 'abilityIcon']),
    deaths: { data: { entries: ((a.deaths?.data?.entries ?? []) as any[]).map((e) => ({ ...pick(e, ['id', 'name', 'deathTime', 'timestamp']), killingBlow: { name: e.killingBlow?.name ?? e.ability?.name ?? 'Unknown' } })) } },
    healing: entriesOf(b.healing, ['id', 'name', 'type', 'petOwner', 'total', 'overheal', 'activeTime'], ['name', 'total', 'overheal']),
    interrupts: countsFrom(b.interrupts),
    dispels: countsFrom(b.dispels),
    debuffs: ((b.debuffs?.data?.auras ?? []) as any[]).map((a) => pick(a, ['guid', 'name', 'totalUptime', 'totalUses', 'abilityIcon'])),
    rankings: trimRankings(c.rankings),
    hps: trimRankings(c.hps),
    details: trimDetails(c.details),
  };
}
/** Bloodlust and its versions, for the raid timeline. GAME CONTENT */
const LUST_IDS = new Set([2825, 32182, 80353, 90355]);
/** Each class's auto attack in the log: Melee and Auto Shot. GAME CONTENT */
const AUTO_IDS = new Set([1, 75]);
const CRIT = new Set([2, 5]);

/** Stage two: every event of the fight boiled down per player, buffs, and gear with names. */
async function readFull(host: string, code: string, meta: ReportMeta, ref: FightRef, tables: Promise<PackTables>, deadline: number): Promise<PackFull> {
  const run = limiter(5);
  const actors = new Map(meta.masterData.actors.map((a) => [a.id, a]));
  const inFight = meta.fights.find((f) => f.id === ref.id)?.friendlyPlayers ?? [];
  const isPlayer = (id: number) => actors.get(id)?.type === 'Player';
  // Who's in the fight: the fight's own player list, or else the tables
  const idsFrom = (t: PackTables) => {
    const ids = new Set<number>(inFight.filter(isPlayer));
    for (const d of detailRows(t.details)) if (d?.id) ids.add(d.id);
    for (const tbl of [t.damage, t.healing, t.casts]) for (const e of (tbl?.data?.entries ?? []) as any[]) if (e?.id && e.type !== 'Pet' && e.type !== 'NPC') ids.add(e.id);
    return ids;
  };
  const early = inFight.filter(isPlayer);

  const [damage, healing, taken, casts, abilities, { buffs, names: buffNames }, gear, t] = await Promise.all([
    getFightEvents(host, code, ref, 'DamageDone', deadline, run),
    getFightEvents(host, code, ref, 'Healing', deadline, run),
    getFightEvents(host, code, ref, 'DamageTaken', deadline, run),
    getFightEvents(host, code, ref, 'Casts', deadline, run, true),
    run(() => getAbilities(host, code)),
    early.length ? readBuffs(host, code, ref, early, run) : tables.then((t) => readBuffs(host, code, ref, [...idsFrom(t)], run)),
    tables.then((t) => readGear(host, code, ref.id, t, run)),
    tables,
  ]);
  const playerIds = idsFrom(t);
  const ownerOf = (id: number) => {
    if (playerIds.has(id)) return id;
    const a = actors.get(id);
    return a?.type === 'Pet' && a.petOwner && playerIds.has(a.petOwner) ? a.petOwner : null;
  };
  const ids = [...playerIds];

  const secs = Math.max(1, Math.ceil((ref.endTime - ref.startTime) / 1000));
  const sec = (ts: number) => Math.min(secs - 1, Math.max(0, Math.floor((ts - ref.startTime) / 1000)));
  const cs = (ts: number) => Math.max(0, Math.round((ts - ref.startTime) / 10));
  const used = new Set<number>();
  const raid = new Array<number>(secs).fill(0);
  type Agg = Map<number, number[]>;
  const work = new Map<number, { dmg: Agg; pets: Map<string, Agg>; heal: Agg; casts: number[][]; autos: Record<string, number[]>; db: number[]; hb: number[]; tb: Map<string, number> }>();
  const P = (id: number) => {
    let w = work.get(id);
    if (!w) {
      w = { dmg: new Map(), pets: new Map(), heal: new Map(), casts: [], autos: {}, db: new Array(secs).fill(0), hb: new Array(secs).fill(0), tb: new Map() };
      work.set(id, w);
    }
    return w;
  };
  const petAgg = (w: { pets: Map<string, Agg> }, sourceId: number) => {
    const name = actors.get(sourceId)?.name ?? 'Pet';
    let agg = w.pets.get(name);
    if (!agg) w.pets.set(name, (agg = new Map()));
    return agg;
  };
  const bump = (agg: Agg, id: number, size: number) => {
    let r = agg.get(id);
    if (!r) agg.set(id, (r = [id, ...new Array(size - 1).fill(0)]));
    used.add(id);
    return r;
  };

  const friendly = (id: number) => { const t = actors.get(id)?.type; return t === 'Player' || t === 'Pet'; };
  const ticks = new Map<number, Map<string, number[]>>();
  const heardTaken: any[] = [];
  const healedAt: any[] = [];
  const mit = new Map<number, number[]>();
  for (const e of damage) {
    // Damage to the raid's own side (Hellfire, Life Tap and the like) isn't damage done
    if (e.type !== 'damage' || friendly(e.targetID)) continue;
    const amount = num(e.amount) + num(e.absorbed);
    raid[sec(e.timestamp)] += amount;
    const owner = ownerOf(e.sourceID);
    if (owner === null) continue;
    const w = P(owner);
    w.db[sec(e.timestamp)] += amount;
    const isPet = e.sourceID !== owner;
    const r = bump(isPet ? petAgg(w, e.sourceID) : w.dmg, e.abilityGameID, 6);
    r[1] += amount;
    // Ticks of damage over time, per spell and target, for its uptime
    if (!isPet && e.tick) {
      const key = `${e.abilityGameID}:${e.targetID}`;
      const list = ticks.get(owner) ?? new Map<string, number[]>();
      ticks.set(owner, list);
      (list.get(key) ?? list.set(key, []).get(key)!).push(e.timestamp);
    }
    if (amount > 0) {
      r[2]++;
      if (CRIT.has(e.hitType)) r[3]++;
    } else r[4]++;
    // Swings for the cast timeline (one per swing, hit or miss)
    if (!isPet && AUTO_IDS.has(e.abilityGameID)) {
      const list = (w.autos[e.abilityGameID] ??= []);
      const t0 = cs(e.timestamp);
      if (!list.length || t0 - list[list.length - 1] >= 5) list.push(t0);
    }
  }
  for (const e of healing) {
    if (e.type !== 'heal' && e.type !== 'absorbed') continue;
    const owner = ownerOf(e.sourceID);
    if (owner === null) continue;
    const w = P(owner);
    const amount = num(e.amount);
    w.hb[sec(e.timestamp)] += amount;
    if (amount > 0 && playerIds.has(e.targetID)) healedAt.push(e);
    const r = bump(w.heal, e.abilityGameID, 5);
    r[1] += amount;
    r[2] += num(e.overheal);
    r[3]++;
    if (CRIT.has(e.hitType)) r[4]++;
  }
  for (const e of taken) {
    if (e.type !== 'damage' || !playerIds.has(e.targetID)) continue;
    // A boss's melee swings: how many were dodged, parried, missed, blocked or crits
    if (e.abilityGameID === MELEE_ID && !friendly(e.sourceID)) {
      const m = mit.get(e.targetID) ?? [0, 0, 0, 0, 0, 0];
      mit.set(e.targetID, m);
      m[0]++;
      if (e.hitType === 7) m[1]++;
      else if (e.hitType === 8) m[2]++;
      else if (e.hitType === 0) m[3]++;
      if (num(e.blocked) > 0 || e.hitType === 4 || e.hitType === 5) m[4]++;
      if (e.hitType === 2 || e.hitType === 5) m[5]++;
    }
    const amount = num(e.amount) + num(e.absorbed);
    if (amount <= 0) continue;
    heardTaken.push(e);
    const key = `${sec(e.timestamp)}:${e.abilityGameID}`;
    const tb = P(e.targetID).tb;
    tb.set(key, (tb.get(key) ?? 0) + amount);
    used.add(e.abilityGameID);
  }
  const lust: number[][] = [];
  const manaAt = new Map<number, number[]>();
  const buckets = Math.ceil(secs / 5);
  for (const e of casts) {
    if (e.type !== 'cast') continue;
    const owner = ownerOf(e.sourceID);
    if (owner === null) continue;
    used.add(e.abilityGameID);
    // Mana at the moment of each cast (resource type 0), kept every 5 seconds
    const mana = e.sourceID === owner ? ((e.classResources ?? []) as any[]).find((r) => r?.type === 0 && num(r.max) > 0) : null;
    if (mana) {
      const list = manaAt.get(owner) ?? new Array<number>(buckets).fill(-1);
      manaAt.set(owner, list);
      const b = Math.min(buckets - 1, Math.floor(sec(e.timestamp) / 5));
      list[b] = Math.round((num(mana.amount) / num(mana.max)) * 100);
    }
    if (e.sourceID === owner) {
      P(owner).casts.push([cs(e.timestamp), e.abilityGameID]);
      if (LUST_IDS.has(e.abilityGameID)) lust.push([cs(e.timestamp), owner, e.abilityGameID]);
    } else {
      // A pet's own casts count as that ability's uses
      bump(petAgg(P(owner), e.sourceID), e.abilityGameID, 6)[5]++;
    }
  }
  for (const b of buffs.values()) for (const a of b.auras) used.add(a[0]);

  // Damage over time: on each spell's main target, time covered by its ticks
  const fightMs = ref.endTime - ref.startTime;
  const dotsOf = (id: number) => {
    const byTarget = ticks.get(id);
    if (!byTarget) return undefined;
    const best = new Map<number, number[]>();
    for (const [key, times] of byTarget) {
      const a = Number(key.split(':')[0]);
      if ((best.get(a)?.length ?? 0) < times.length) best.set(a, times);
    }
    const out: number[][] = [];
    for (const [a, raw] of best) {
      const times = [...raw].sort((x, y) => x - y);
      if (times.length < 4) continue;
      const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 200).sort((x, y) => x - y);
      const every = gaps[Math.floor(gaps.length / 2)] ?? 3000;
      if (every < 900 || every > 6000) continue;
      // Each tick covers the time back to the last one, while the spell was still running
      // (a longer gap means it fell off: the first tick after re-applying covers one interval)
      let covered = every;
      for (let i = 1; i < times.length; i++) {
        const g = times[i] - times[i - 1];
        covered += g <= every * 1.6 ? g : every;
      }
      out.push([a, Math.min(1000, Math.round((covered / fightMs) * 1000)), times.length]);
      used.add(a);
    }
    return out.length ? out : undefined;
  };

  // The 10 seconds before each death: what hit them, and how much healing they got
  const deaths: PackDeath[] = [];
  for (const d of (t.deaths?.data?.entries ?? []) as any[]) {
    const at = num(d.deathTime ?? d.timestamp);
    if (!d.id || !at) continue;
    const from = at - 10_000;
    const hits = heardTaken
      .filter((e) => e.targetID === d.id && e.timestamp >= from && e.timestamp <= at)
      .sort((x, y) => x.timestamp - y.timestamp)
      .slice(-8)
      .map((e) => [cs(e.timestamp), e.abilityGameID, Math.round(num(e.amount) + num(e.absorbed)), actors.get(e.sourceID)?.name ?? '']);
    const healed = healedAt.filter((e) => e.targetID === d.id && e.timestamp >= from && e.timestamp <= at).reduce((s, e) => s + num(e.amount), 0);
    deaths.push({ id: d.id, at: cs(at), hits, healed: Math.round(healed) });
  }

  const round = (xs: number[]) => xs.map((v) => Math.round(v));
  const players: Record<string, PackPlayer> = {};
  for (const id of ids) {
    const w = work.get(id);
    const own = w ? [...w.dmg.values()] : [];
    // A player's own uses of each ability, from their casts
    const uses = new Map<number, number>();
    for (const [, a] of w?.casts ?? []) uses.set(a, (uses.get(a) ?? 0) + 1);
    for (const r of own) r[5] = uses.get(r[0]) ?? 0;
    players[id] = {
      dmg: own.filter((r) => r[1] > 0 || r[4] > 0).map(round),
      pets: w ? [...w.pets].map(([name, agg]) => ({ name, dmg: [...agg.values()].filter((r) => r[1] > 0).map(round) })).filter((p) => p.dmg.length) : [],
      heal: w ? [...w.heal.values()].filter((r) => r[1] > 0 || r[2] > 0).map(round) : [],
      casts: w?.casts.sort((x, y) => x[0] - y[0]) ?? [],
      autos: w?.autos ?? {},
      buffs: buffs.get(id) ?? { total: ref.endTime - ref.startTime, auras: [] },
      db: w ? round(w.db) : [],
      hb: w && w.hb.some((v) => v > 0) ? round(w.hb) : [],
      tb: w ? [...w.tb].map(([k, v]) => [...k.split(':').map(Number), Math.round(v)]).sort((x, y) => x[0] - y[0]) : [],
      gear: gear.get(id) ?? [],
      ...(dotsOf(id) ? { dots: dotsOf(id) } : {}),
      ...(manaAt.has(id) ? { mana: manaAt.get(id) } : {}),
      ...(mit.get(id) && mit.get(id)![0] >= 10 ? { mit: mit.get(id) } : {}),
    };
  }
  const names: PackFull['names'] = {};
  for (const id of used) {
    const a = abilities.get(id) ?? buffNames.get(id);
    if (a) names[id] = a.icon ? [a.name, a.icon] : [a.name];
  }
  return { names, players, raid: round(raid), lust, deaths };
}

/** Everyone's buffs (uptime, uses, and when Bloodlust and big cooldowns were up), eight players per request. */
async function readBuffs(host: string, code: string, ref: FightRef, ids: number[], run: <T>(job: () => Promise<T>) => Promise<T>) {
  const out = new Map<number, PackPlayer['buffs']>();
  const names = new Map<number, { name: string; icon?: string }>();
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += 8) batches.push(ids.slice(i, i + 8));
  await Promise.all(batches.map((batch) => run(async () => {
    const fields = batch.map((id) => `b${id}: table(dataType:Buffs, fightIDs:$fid, sourceID:${Math.trunc(id)})`).join('\n');
    const r = await getTables(host, code, ref.id, fields, 25_000);
    for (const id of batch) {
      const data = r[`b${id}`]?.data;
      if (!data) continue;
      out.set(id, {
        total: num(data.totalTime) || ref.endTime - ref.startTime,
        auras: ((data.auras ?? []) as any[]).filter((a) => a?.guid).map((a) => {
          if (a.name) names.set(num(a.guid), { name: String(a.name), icon: typeof a.abilityIcon === 'string' ? a.abilityIcon : undefined });
          // Bands for Bloodlust, big cooldowns and potions (a potion's band at the pull is a pre-pot)
          const keepBands = /^(Bloodlust|Heroism|Time Warp|Ancient Hysteria)$/.test(String(a.name)) || cooldownFor(String(a.name), host) !== undefined || POTION_IDS.has(num(a.guid));
          const bands = keepBands ? ((a.bands ?? []) as any[]).map((b) => [Math.round(num(b.startTime) - ref.startTime), Math.round(num(b.endTime) - ref.startTime)]) : undefined;
          return [num(a.guid), Math.round(num(a.totalUptime)), num(a.totalUses), ...(bands ? [bands] : [])] as [number, number, number, number[][]?];
        }),
      });
    }
  })));
  return { buffs: out, names };
}

// ---------- Gear with item names ----------
// Item and enchant names come from a small shared list. Warcraft Logs' per-player Summary table is
// only asked for players wearing something the list hasn't seen yet. GAME CONTENT

type Named = { name: string; icon: string | null; quality: number | null };

async function namesKnown(kind: 'item' | 'enchant', ids: number[]): Promise<Map<number, Named>> {
  if (!dbEnabled() || !ids.length) return new Map();
  const rows: any[] = (await rest(`item_names?kind=eq.${kind}&id=in.(${ids.join(',')})&select=id,name,icon,quality`).catch(() => [])) ?? [];
  return new Map(rows.map((r) => [r.id, { name: r.name, icon: r.icon, quality: r.quality }]));
}

async function rememberNames(rows: { kind: 'item' | 'enchant'; id: number; name: string; icon: string | null; quality: number | null }[]) {
  if (!dbEnabled() || !rows.length) return;
  await rest('item_names?on_conflict=kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) }).catch(() => undefined);
}

async function readGear(host: string, code: string, fightId: number, t: PackTables, run: <T>(job: () => Promise<T>) => Promise<T>): Promise<Map<number, GearItem[]>> {
  const raw = new Map<number, any[]>();
  for (const d of detailRows(t.details)) if (d?.id && d.combatantInfo?.gear?.length) raw.set(d.id, d.combatantInfo.gear);
  const itemIds = [...new Set([...raw.values()].flat().map((g) => num(g?.id)).filter((x) => x > 0))];
  const enchantIds = [...new Set([...raw.values()].flat().map((g) => num(g?.permanentEnchant)).filter((x) => x > 0))];
  const [items, enchants] = await Promise.all([namesKnown('item', itemIds), namesKnown('enchant', enchantIds)]);
  // Names that came with the gear itself
  const learned: Parameters<typeof rememberNames>[0] = [];
  for (const g of [...raw.values()].flat()) {
    if (g?.id && typeof g.name === 'string' && g.name && !items.has(g.id)) {
      items.set(g.id, { name: g.name, icon: g.icon ?? null, quality: typeof g.quality === 'number' ? g.quality : null });
      learned.push({ kind: 'item', id: g.id, ...items.get(g.id)! });
    }
    if (num(g?.permanentEnchant) > 0 && typeof g.permanentEnchantName === 'string' && g.permanentEnchantName && !enchants.has(g.permanentEnchant)) {
      enchants.set(g.permanentEnchant, { name: g.permanentEnchantName, icon: null, quality: null });
      learned.push({ kind: 'enchant', id: g.permanentEnchant, name: g.permanentEnchantName, icon: null, quality: null });
    }
  }
  const unknown = (g: any) => (g?.id && !items.has(g.id)) || (num(g?.permanentEnchant) > 0 && !enchants.has(g.permanentEnchant));
  const needs = [...raw].filter(([, gear]) => gear.some(unknown)).map(([id]) => id);
  const batches: number[][] = [];
  for (let i = 0; i < needs.length; i += 5) batches.push(needs.slice(i, i + 5));
  await Promise.all(batches.map((batch) => run(async () => {
    const fields = batch.map((id) => `s${id}: table(dataType:Summary, fightIDs:$fid, sourceID:${Math.trunc(id)})`).join('\n');
    const r = await getTables(host, code, fightId, fields, 25_000).catch(() => ({}) as Record<string, any>);
    for (const id of batch) {
      for (const g of (r[`s${id}`]?.data?.gear ?? r[`s${id}`]?.gear ?? []) as any[]) {
        if (g?.id && typeof g.name === 'string' && g.name && !items.has(g.id)) {
          items.set(g.id, { name: g.name, icon: g.icon ?? null, quality: typeof g.quality === 'number' ? g.quality : null });
          learned.push({ kind: 'item', id: g.id, ...items.get(g.id)! });
        }
        if (num(g?.permanentEnchant) > 0 && typeof g.permanentEnchantName === 'string' && g.permanentEnchantName && !enchants.has(g.permanentEnchant)) {
          enchants.set(g.permanentEnchant, { name: g.permanentEnchantName, icon: null, quality: null });
          learned.push({ kind: 'enchant', id: g.permanentEnchant, name: g.permanentEnchantName, icon: null, quality: null });
        }
      }
    }
  })));
  await rememberNames(learned);
  const out = new Map<number, GearItem[]>();
  for (const [id, gear] of raw) {
    out.set(id, gearFrom(gear.map((g) => {
      const it = items.get(g?.id);
      const en = enchants.get(num(g?.permanentEnchant));
      return { ...g, name: g?.name || it?.name || null, icon: g?.icon ?? it?.icon ?? null, quality: g?.quality ?? it?.quality ?? null, permanentEnchantName: g?.permanentEnchantName || en?.name || null };
    })));
  }
  return out;
}

// ---------- Getting a pack ----------

export type Stage = FightPack['stage'];
const inflight = new Map<string, { want: Stage; promise: Promise<FightPack> }>();

/**
 * The stored pack for a fight, reading it from Warcraft Logs if it isn't stored yet (or only the
 * tables are and the full read is wanted). Each stage is saved as soon as it's read. If the full
 * read can't be done (Warcraft Logs down or too slow), the stored tables are returned so callers
 * can still show something; with nothing stored, the error is thrown.
 */
export async function getPack(host: string, code: string, ref: FightRef, want: Stage, deadline = Date.now() + 50_000): Promise<FightPack> {
  const key = `${code}:${ref.id}`;
  const running = inflight.get(key);
  if (running && (running.want === 'full' || want === 'tables')) return running.promise;
  const promise = loadPack(host, code, ref, want, deadline);
  inflight.set(key, { want, promise });
  try {
    return await promise;
  } finally {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  }
}

async function loadPack(host: string, code: string, given: FightRef, want: Stage, deadline: number): Promise<FightPack> {
  const stored = await readPack(code, given.id);
  if (stored && (stored.stage === 'full' || want === 'tables')) return stored;

  // The fight as the report has it (never what a request says), and a player list that includes it
  let { meta } = await getMeta(host, code, { timeoutMs: 15_000 });
  if (!meta.fights.some((f) => f.id === given.id)) meta = (await getMeta(host, code, { fresh: true, timeoutMs: 15_000 })).meta;
  const f = meta.fights.find((x) => x.id === given.id);
  if (!f) throw new Error('That fight isn\u2019t in this report.');
  const ref: FightRef = { id: f.id, encounterID: f.encounterID, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: !!f.kill };

  // The fight-wide tables (saved the moment they arrive), and the full read alongside when it's wanted
  const tables: Promise<FightPack> = stored
    ? Promise.resolve(stored)
    : readTables(host, code, ref.id).then(async (t) => {
        const p: FightPack = { v: PACK_VERSION, stage: 'tables', fight: ref, t };
        await writePack(host, code, p, digestFromPack(host, p)).catch(() => undefined);
        return p;
      });
  if (want === 'tables') return tables;
  const full = readFull(host, code, meta, ref, tables.then((p) => p.t), deadline);
  full.catch(() => undefined); // handled below, once the tables are in
  const pack = await tables;
  try {
    const done: FightPack = { ...pack, stage: 'full', full: await full };
    await writePack(host, code, done, digestFromPack(host, done)).catch(() => undefined);
    return done;
  } catch (e) {
    if (e instanceof WclTimeout || /Warcraft Logs/i.test((e as Error).message)) return pack; // the tables still answer; the full read is tried again later
    throw e;
  }
}

/** Just the tables, kept for raids older than the keep-full-detail window. */
export function tablesOnly(p: FightPack): FightPack {
  return { v: p.v, stage: 'tables', fight: p.fight, t: p.t };
}

/** Replace a stored pack with its tables only (older raids), keeping the digest. */
export async function trimPack(code: string, fightId: number) {
  const row: PackRow | undefined = (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.${fightId}&select=host,pack,digest`))?.[0];
  if (!row?.pack) return;
  const p = unpack64<FightPack>(row.pack);
  await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.${fightId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ stage: 'tables', pack: pack64(tablesOnly(p)) }),
  });
}
