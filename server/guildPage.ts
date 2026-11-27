// The home page as a guild page: who the guild is on Warcraft Logs, progress in each raid (from Past
// raids), Warcraft Logs ranks, and the roster. Warcraft Logs is asked at most once an hour.
import { dbEnabled, rest } from './db.js';
import { GAME } from './game.js';
import type { GuildRankings, HomeData, RankSet, SavedRaid, ZoneProgress } from './types.js';
import { gql } from './wcl.js';
import { guildSettings } from './guildSettings.js';

const q = encodeURIComponent;
const HOUR = 3_600_000;

type Guild = NonNullable<HomeData['wcl']>;
let cached: { at: number; key: string; guild: Guild | null; ranks: Map<number, ZoneProgress['ranks']> } | null = null;

/** Which guild to show: WCL_GUILD_ID, or GUILD_NAME + GUILD_REALM + GUILD_REGION (also used to pick up raids). */
async function guildArgs(): Promise<{ decl: string; args: string; vars: Record<string, unknown> } | null> {
  // The Admin page's setting first, then Vercel's environment variables
  const saved = (await guildSettings().catch(() => null))?.wclGuildId;
  const id = saved && saved > 0 ? saved : Number(process.env.WCL_GUILD_ID?.trim());
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
  const g = await guildArgs();
  const key = JSON.stringify(g?.vars ?? null);
  if (cached && cached.key === key && Date.now() - cached.at < HOUR && want.every((z) => cached!.ranks.has(z))) return cached;
  const host = GAME.hosts[0];
  const empty = { guild: null, ranks: new Map<number, ZoneProgress['ranks']>() };
  if (!g) return empty;
  const base = await gql<any>(host, `query(${g.decl}){guildData{guild(${g.args}){id name faction{name} server{name slug region{slug}}}}}`, g.vars, 10_000).catch(() => null);
  const info = base?.guildData?.guild;
  if (!info?.id) {
    cached = { at: Date.now(), key, ...empty };
    return empty;
  }
  const guild: Guild = {
    id: info.id,
    url: `https://${host}/guild/id/${info.id}`,
    name: info.name,
    server: info.server?.name ?? null,
    serverSlug: info.server?.slug ?? null,
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
  cached = { at: Date.now(), key, guild, ranks };
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

/**
 * Progress in each raid: every boss with its first kill, number of kills and fastest kill. Biggest
 * raid first (most bosses), then the most recently raided, so the order doesn't change week to week
 * when several raids are current.
 */
export async function zoneProgress(raids: SavedRaid[]): Promise<ZoneProgress[]> {
  const dated = raids.filter((r) => r.startTime && r.card).sort((a, b) => a.startTime!.localeCompare(b.startTime!));
  const zoneOf = await zonesOf(dated);
  const zones = new Map<number, Omit<ZoneProgress, 'visits'> & { last: string; nights: SavedRaid[] }>();
  for (const r of dated) {
    const z = zoneOf.get(r.code);
    if (!z) continue;
    const zone = zones.get(z.id) ?? { id: z.id, name: z.name, host: r.host, killed: 0, total: 0, bosses: [], ranks: null, last: r.startTime!, nights: [] as SavedRaid[] };
    zone.last = r.startTime!;
    zone.nights.push(r);
    for (const b of r.card!.bosses) {
      let boss = zone.bosses.find((x) => x.encounterId === b.encounterId);
      if (!boss) zone.bosses.push((boss = { name: b.name, encounterId: b.encounterId, firstKill: null, kills: 0, best: null, bestPct: null }));
      // How far the best wipe got (boss health left), for bosses not killed yet
      for (const p of b.pulls ?? []) if (p.pct !== null && (boss.bestPct === null || boss.bestPct === undefined || p.pct < boss.bestPct)) boss.bestPct = p.pct;
      if (!b.kill || !b.seconds || !b.fightId) continue;
      boss.kills++;
      boss.firstKill ??= r.startTime!;
      if (!boss.best || b.seconds < boss.best.seconds) boss.best = { seconds: b.seconds, host: r.host, code: r.code, fightId: b.fightId };
    }
    zones.set(z.id, zone);
  }
  return [...zones.values()]
    .sort((a, b) => b.bosses.length - a.bosses.length || b.last.localeCompare(a.last))
    .map(({ last, nights: visits, ...z }): ZoneProgress => {
      const ids = z.bosses.map((b) => b.encounterId);
      const latest = visits.at(-1)!;
      // Full clears: every boss known in this raid killed in one night
      const clears = visits.filter((r) => r.card!.raidSeconds > 0 && ids.every((id) => r.card!.bosses.some((b) => b.encounterId === id && b.kill)));
      const fastest = clears.reduce<SavedRaid | null>((m, r) => (!m || r.card!.raidSeconds < m.card!.raidSeconds ? r : m), null);
      const inZone = (r: SavedRaid) => r.card!.bosses.filter((b) => ids.includes(b.encounterId));
      return {
        ...z,
        killed: z.bosses.filter((b) => b.kills).length,
        total: z.bosses.length,
        visits: visits.length,
        lastRaid: { code: latest.code, host: latest.host, title: latest.title, date: latest.startTime!, seconds: latest.card!.raidSeconds, kills: inZone(latest).filter((b) => b.kill).length, wipes: inZone(latest).reduce((t, b) => t + b.wipes, 0) },
        fastestClear: fastest ? { code: fastest.code, host: fastest.host, date: fastest.startTime!, seconds: fastest.card!.raidSeconds } : null,
      };
    });
}

/** Everyone in a raid in the last 8 weeks, with how many of those raids they were in. */
export function roster(raids: SavedRaid[], days = 56): HomeData['roster'] {
  const recent = raids.filter((r) => r.startTime && r.card && Date.now() - new Date(r.startTime).getTime() <= days * 86_400_000);
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
 * Everyone's best parse on each boss of each raid in the last 8 weeks (healers by healing), from
 * kill_stats in one read, plus each raider's latest item level for the roster.
 */
export async function rankings(zones: ZoneProgress[], people: HomeData['roster'], days = 56): Promise<GuildRankings[]> {
  const want = zones.filter((z) => z.bosses.length).slice(0, 4);
  if (!dbEnabled() || !want.length) return [];
  const since = new Date(Date.now() - Math.min(days, 3650) * 86_400_000).toISOString();
  const ids = want.flatMap((z) => z.bosses.map((b) => Math.trunc(b.encounterId))).join(',');
  const rows: { name: string; class_name: string; role: string | null; healer: boolean; encounter_id: number; parse: number | null; hps_parse: number | null; item_level: number | null }[] =
    (await rest(`kill_stats?encounter_id=in.(${ids})&start_time=gte.${q(since)}&select=name,class_name,role,healer,encounter_id,parse,hps_parse,item_level&order=start_time.asc&limit=10000`).catch(() => [])) ?? [];
  const ilvl = new Map<string, number>();
  for (const r of rows) if (r.item_level) ilvl.set(r.name, Number(r.item_level));
  for (const p of people) p.itemLevel = ilvl.get(p.name) ?? null;
  return want
    .map((zone) => {
      const col = new Map(zone.bosses.map((b, i) => [b.encounterId, i]));
      const players = new Map<string, GuildRankings['players'][number]>();
      for (const r of rows) {
        const i = col.get(r.encounter_id);
        if (i === undefined) continue;
        const role = r.healer || r.role === 'healer' ? 'healer' : r.role === 'tank' ? 'tank' : 'dps';
        const p = players.get(r.name) ?? { name: r.name, className: r.class_name, role, best: zone.bosses.map(() => null), avg: null };
        p.role = role;
        const v = role === 'healer' ? r.hps_parse : r.parse;
        if (v !== null && v !== undefined) p.best[i] = Math.max(p.best[i] ?? 0, Number(v));
        players.set(r.name, p);
      }
      const list = [...players.values()].map((p) => {
        const got = p.best.filter((v): v is number => v !== null);
        return { ...p, avg: got.length ? Math.round((got.reduce((t, v) => t + v, 0) / got.length) * 10) / 10 : null };
      });
      return { zoneId: zone.id, zone: zone.name, bosses: zone.bosses.map((b) => ({ id: b.encounterId, name: b.name })), players: list.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)) };
    })
    .filter((r) => r.players.length);
}
