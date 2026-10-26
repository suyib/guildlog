// The home page as a guild page: who the guild is on Warcraft Logs, progress in each raid (from Past
// raids), Warcraft Logs ranks, and the roster. Warcraft Logs is asked at most once an hour.
import { dbEnabled, rest } from './db.js';
import { GAME } from './game.js';
import type { GuildRankings, HomeData, RankSet, SavedRaid, ZoneProgress } from './types.js';
import { gql } from './wcl.js';

const q = encodeURIComponent;
const HOUR = 3_600_000;
const WEEK = 7 * 86_400_000;

type Guild = NonNullable<HomeData['wcl']>;
let cached: { at: number; guild: Guild | null; ranks: Map<number, ZoneProgress['ranks']> } | null = null;

/** Which guild to show: WCL_GUILD_ID, or GUILD_NAME + GUILD_REALM + GUILD_REGION (also used to pick up raids). */
function guildArgs(): { decl: string; args: string; vars: Record<string, unknown> } | null {
  const id = Number(process.env.WCL_GUILD_ID?.trim());
  if (id > 0) return { decl: '$id:Int', args: 'id:$id', vars: { id } };
  const name = process.env.GUILD_NAME?.trim();
  const realm = process.env.GUILD_REALM?.trim();
  const region = process.env.GUILD_REGION?.trim().toLowerCase();
  if (!name || !realm || !region) return null;
  const slug = realm.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { decl: '$n:String,$s:String,$r:String', args: 'name:$n,serverSlug:$s,serverRegion:$r', vars: { n: name, s: slug, r: region } };
}

const RANK = 'worldRank{number color} regionRank{number color} serverRank{number color}';
const rankSet = (r: any): RankSet | null =>
  r ? { world: r.worldRank ?? null, region: r.regionRank ?? null, server: r.serverRank ?? null } : null;

/**
 * The guild on Warcraft Logs and its ranks in the given raids. Optional throughout: with no guild
 * set up, or if Warcraft Logs doesn't answer, the page just leaves these out.
 */
export async function wclGuild(zoneIds: number[]): Promise<{ guild: Guild | null; ranks: Map<number, ZoneProgress['ranks']> }> {
  const want = zoneIds.slice(0, 4);
  if (cached && Date.now() - cached.at < HOUR && want.every((z) => cached!.ranks.has(z))) return cached;
  const g = guildArgs();
  const host = GAME.hosts[0];
  const empty = { guild: null, ranks: new Map<number, ZoneProgress['ranks']>() };
  if (!g) return empty;
  const base = await gql<any>(host, `query(${g.decl}){guildData{guild(${g.args}){id name faction{name} server{name region{slug}}}}}`, g.vars, 10_000).catch(() => null);
  const info = base?.guildData?.guild;
  if (!info?.id) {
    cached = { at: Date.now(), ...empty };
    return empty;
  }
  const guild: Guild = {
    id: info.id,
    url: `https://${host}/guild/id/${info.id}`,
    name: info.name,
    server: info.server?.name ?? null,
    region: info.server?.region?.slug?.toUpperCase() ?? null,
    faction: info.faction?.name ?? null,
  };
  // Ranks in each raid (asked separately, so a problem with them doesn't lose the rest)
  const ranks = new Map<number, ZoneProgress['ranks']>();
  if (want.length) {
    const fields = want.map((z) => `z${z}: zoneRanking(zoneId:${Math.trunc(z)}){progress{${RANK}} speed{${RANK}}}`).join(' ');
    const r = await gql<any>(host, `query($id:Int){guildData{guild(id:$id){ ${fields} }}}`, { id: info.id }, 10_000).catch((e) => {
      console.error('guild ranks not read:', (e as Error).message);
      return null;
    });
    for (const z of want) {
      const zr = r?.guildData?.guild?.[`z${z}`];
      ranks.set(z, zr ? { progress: rankSet(zr.progress), speed: rankSet(zr.speed) } : null);
    }
  }
  cached = { at: Date.now(), guild, ranks };
  return cached;
}

/** Each saved raid's zone (from its stored report). */
async function zonesOf(raids: SavedRaid[]): Promise<Map<string, { id: number; name: string }>> {
  if (!dbEnabled() || !raids.length) return new Map();
  const codes = raids.map((r) => q(r.code)).join(',');
  const rows: { report_code: string; zone: { id: number; name: string } | null }[] =
    (await rest(`fight_packs?fight_id=eq.0&report_code=in.(${codes})&select=report_code,zone:digest->zone`).catch(() => [])) ?? [];
  return new Map(rows.filter((r) => r.zone?.id).map((r) => [r.report_code, r.zone!]));
}

/** Progress in each raid, newest raid first: every boss with its first kill, number of kills and fastest kill. */
export async function zoneProgress(raids: SavedRaid[]): Promise<ZoneProgress[]> {
  const dated = raids.filter((r) => r.startTime && r.card).sort((a, b) => a.startTime!.localeCompare(b.startTime!));
  const zoneOf = await zonesOf(dated);
  const zones = new Map<number, ZoneProgress & { last: string }>();
  for (const r of dated) {
    const z = zoneOf.get(r.code);
    if (!z) continue;
    const zone = zones.get(z.id) ?? { id: z.id, name: z.name, killed: 0, total: 0, bosses: [], ranks: null, last: r.startTime! };
    zone.last = r.startTime!;
    for (const b of r.card!.bosses) {
      let boss = zone.bosses.find((x) => x.encounterId === b.encounterId);
      if (!boss) zone.bosses.push((boss = { name: b.name, encounterId: b.encounterId, firstKill: null, kills: 0, best: null }));
      if (!b.kill || !b.seconds || !b.fightId) continue;
      boss.kills++;
      boss.firstKill ??= r.startTime!;
      if (!boss.best || b.seconds < boss.best.seconds) boss.best = { seconds: b.seconds, host: r.host, code: r.code, fightId: b.fightId };
    }
    zones.set(z.id, zone);
  }
  return [...zones.values()]
    .sort((a, b) => b.last.localeCompare(a.last))
    .map(({ last, ...z }) => ({ ...z, killed: z.bosses.filter((b) => b.kills).length, total: z.bosses.length }));
}

/** Everyone in a raid in the last 8 weeks, with how many of those raids they were in. */
export function roster(raids: SavedRaid[]): HomeData['roster'] {
  const recent = raids.filter((r) => r.startTime && r.card && Date.now() - new Date(r.startTime).getTime() <= 8 * WEEK);
  const people = new Map<string, HomeData['roster'][number]>();
  for (const r of recent) {
    for (const p of r.card!.raiders) {
      const x = people.get(p.name) ?? { name: p.name, className: p.className, specName: p.specName, role: p.role, raids: 0, of: recent.length, itemLevel: null };
      x.raids++;
      if (p.specName) x.specName = p.specName;
      if (p.role) x.role = p.role;
      people.set(p.name, x);
    }
  }
  return [...people.values()].sort((a, b) => b.raids - a.raids || a.name.localeCompare(b.name));
}

/**
 * Everyone's best parse on each boss of the newest raid in the last 8 weeks (healers by healing),
 * from kill_stats, plus each raider's latest item level for the roster.
 */
export async function rankings(zone: ZoneProgress | undefined, people: HomeData['roster']): Promise<GuildRankings | null> {
  if (!dbEnabled() || !zone?.bosses.length) return null;
  const since = new Date(Date.now() - 8 * WEEK).toISOString();
  const ids = zone.bosses.map((b) => Math.trunc(b.encounterId)).join(',');
  const rows: { name: string; class_name: string; role: string | null; healer: boolean; encounter_id: number; parse: number | null; hps_parse: number | null; item_level: number | null }[] =
    (await rest(`kill_stats?encounter_id=in.(${ids})&start_time=gte.${q(since)}&select=name,class_name,role,healer,encounter_id,parse,hps_parse,item_level&order=start_time.asc&limit=5000`).catch(() => [])) ?? [];
  if (!rows.length) return null;
  const col = new Map(zone.bosses.map((b, i) => [b.encounterId, i]));
  const players = new Map<string, GuildRankings['players'][number]>();
  const ilvl = new Map<string, number>();
  for (const r of rows) {
    const role = r.healer || r.role === 'healer' ? 'healer' : r.role === 'tank' ? 'tank' : 'dps';
    const p = players.get(r.name) ?? { name: r.name, className: r.class_name, role, best: zone.bosses.map(() => null), avg: null };
    p.role = role;
    const v = role === 'healer' ? r.hps_parse : r.parse;
    const i = col.get(r.encounter_id)!;
    if (v !== null && v !== undefined) p.best[i] = Math.max(p.best[i] ?? 0, Number(v));
    if (r.item_level) ilvl.set(r.name, Number(r.item_level));
    players.set(r.name, p);
  }
  for (const p of people) p.itemLevel = ilvl.get(p.name) ?? null;
  const out = [...players.values()].map((p) => {
    const got = p.best.filter((v): v is number => v !== null);
    return { ...p, avg: got.length ? Math.round((got.reduce((t, v) => t + v, 0) / got.length) * 10) / 10 : null };
  });
  return { zone: zone.name, bosses: zone.bosses.map((b) => ({ id: b.encounterId, name: b.name })), players: out.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)) };
}
