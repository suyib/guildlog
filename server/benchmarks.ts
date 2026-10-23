// Guild benchmarks and trends: everyone's numbers on each boss kill of the guild's own raids
// (Past raids), one small row per player per kill in kill_stats. Written as each raid is stored;
// read for "against the guild" on analyses and in Discord, and for trends on profiles.
import { dbEnabled, rest } from './db.js';
import { type FightDigest, healsMost } from './fightDigest.js';
import type { GuildContext, GuildKill, TrendWeek } from './types.js';
import type { ReportMeta } from './wcl.js';

const q = encodeURIComponent;
const key = (name: string) => name.trim().toLowerCase();

interface KillRow {
  report_code: string;
  fight_id: number;
  encounter_id: number;
  encounter_name: string;
  start_time: string;
  seconds: number;
  name: string;
  name_key: string;
  realm: string | null;
  class_name: string;
  spec_name: string;
  role: string;
  healer: boolean;
  dps: number;
  hps: number;
  parse: number | null;
  hps_parse: number | null;
  deaths: number;
  item_level: number | null;
}

/** Record (or update) a guild raid's kills. */
export async function recordKills(code: string, meta: ReportMeta, digests: FightDigest[]) {
  if (!dbEnabled() || !digests.length) return;
  const rows: KillRow[] = digests.filter((f) => f.kill).flatMap((f) => f.players.map((p) => ({
    report_code: code,
    fight_id: f.id,
    encounter_id: f.encounterID,
    encounter_name: f.name,
    start_time: new Date(meta.startTime + f.startTime).toISOString(),
    seconds: Math.round(f.seconds),
    name: p.name,
    name_key: key(p.name),
    realm: p.server,
    class_name: p.className,
    spec_name: p.specName,
    role: p.role,
    healer: healsMost(p),
    dps: Math.round(p.dps),
    hps: Math.round(p.healing?.hps ?? 0),
    parse: p.parse,
    hps_parse: p.healing?.parse ?? null,
    deaths: p.deaths.length,
    item_level: p.itemLevel,
  })));
  if (!rows.length) return;
  await rest('kill_stats?on_conflict=report_code,fight_id,name_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

/** Remove a raid's kills (when it's deleted from Past raids). */
export async function forgetKills(code: string) {
  if (!dbEnabled()) return;
  await rest(`kill_stats?report_code=eq.${q(code)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Stat = Pick<KillRow, 'report_code' | 'fight_id' | 'start_time' | 'name' | 'name_key' | 'dps' | 'hps' | 'parse' | 'hps_parse'>;
const kill = (r: Stat, healer: boolean): GuildKill => ({ date: r.start_time, name: r.name, perSecond: healer ? r.hps : r.dps, parse: healer ? r.hps_parse : r.parse, code: r.report_code, fightId: r.fight_id });

/**
 * How someone compares with the guild on a boss, in their spec: the guild's best kill, the
 * median of everyone's best, their place, and their own kills of it. Null with no guild kills.
 */
export async function guildContext(p: { encounterId: number; encounter: string; className: string; specName: string; name: string; healer: boolean }): Promise<GuildContext | null> {
  if (!dbEnabled() || !p.className) return null;
  const rows: Stat[] = (await rest(
    `kill_stats?encounter_id=eq.${p.encounterId}&class_name=eq.${q(p.className)}&spec_name=eq.${q(p.specName)}&healer=eq.${p.healer}` +
    '&select=report_code,fight_id,start_time,name,name_key,dps,hps,parse,hps_parse&order=start_time.desc&limit=1000',
  ).catch(() => null)) ?? [];
  if (!rows.length) return null;
  const value = (r: Stat) => (p.healer ? r.hps : r.dps);
  const bestOf = new Map<string, Stat>();
  for (const r of rows) if (!bestOf.has(r.name_key) || value(r) > value(bestOf.get(r.name_key)!)) bestOf.set(r.name_key, r);
  const ranking = [...bestOf.values()].sort((a, b) => value(b) - value(a));
  const me = key(p.name);
  const place = ranking.findIndex((r) => r.name_key === me);
  return {
    unit: p.healer ? 'HPS' : 'DPS',
    spec: `${p.specName.replace(/([a-z])([A-Z])/g, '$1 $2')} ${p.className}`.trim(),
    encounter: p.encounter,
    kills: rows.length,
    players: bestOf.size,
    best: ranking[0] ? kill(ranking[0], p.healer) : null,
    median: median(ranking.map(value)),
    place: place >= 0 ? place + 1 : null,
    mine: rows.filter((r) => r.name_key === me).slice(0, 8).map((r) => kill(r, p.healer)),
  };
}

/** Monday of the week a date falls in, as YYYY-MM-DD (UTC). */
const weekOf = (iso: string) => {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** A character's last `weeks` weeks of guild raids: average parse and DPS (or HPS for healers) per week, oldest first. */
export async function trendFor(name: string, weeks = 8): Promise<TrendWeek[]> {
  if (!dbEnabled()) return [];
  const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();
  const rows: Pick<KillRow, 'start_time' | 'healer' | 'dps' | 'hps' | 'parse' | 'hps_parse'>[] =
    (await rest(`kill_stats?name_key=eq.${q(key(name))}&start_time=gte.${q(since)}&select=start_time,healer,dps,hps,parse,hps_parse&order=start_time.asc&limit=500`).catch(() => null)) ?? [];
  if (!rows.length) return [];
  const healer = rows.filter((r) => r.healer).length * 2 > rows.length;
  const byWeek = new Map<string, typeof rows>();
  for (const r of rows) byWeek.set(weekOf(r.start_time), [...(byWeek.get(weekOf(r.start_time)) ?? []), r]);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((t, v) => t + v, 0) / xs.length) : null);
  return [...byWeek].map(([week, list]) => ({
    week,
    parse: avg(list.map((r) => (healer ? r.hps_parse : r.parse)).filter((v): v is number => v !== null)),
    perSecond: avg(list.map((r) => (healer ? r.hps : r.dps))),
    kills: list.length,
  }));
}
