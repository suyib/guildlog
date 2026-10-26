// One boss's guild rankings from Warcraft Logs, like Raider.IO's boss rankings: by first kill
// (progress) or fastest kill (speed), for the world, the guild's region or its realm. Read when
// someone opens a boss on the home page, and kept for an hour.
import { GAME } from './game.js';
import { wclGuild } from './guildPage.js';
import type { BossRanks } from './types.js';
import { gql } from './wcl.js';

const HOUR = 3_600_000;
/** Pages of rankings to look through for the guild (Warcraft Logs gives 100 a page). */
const MAX_PAGES = 3;
const SHOW = 20;
const cache = new Map<string, { at: number; value: BossRanks }>();

const METRICS = ['progress', 'speed'] as const;
const SCOPES = ['world', 'region', 'realm'] as const;

export async function bossRanks(host: string, encounterId: number, metric: string, scope: string): Promise<BossRanks> {
  if (!GAME.hosts.includes(host)) throw new Error('Not a Warcraft Logs site this guild uses.');
  if (!Number.isInteger(encounterId) || encounterId <= 0) throw new Error('Pick a boss.');
  const m = METRICS.find((x) => x === metric) ?? 'progress';
  const sc = SCOPES.find((x) => x === scope) ?? 'world';
  const key = `${host}|${encounterId}|${m}|${sc}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;

  const { guild } = await wclGuild([]).catch(() => ({ guild: null }));
  if (sc !== 'world' && !guild?.region) throw new Error('Set up the guild on Warcraft Logs (WCL_GUILD_ID) to see region and realm rankings.');
  if (sc === 'realm' && !guild?.serverSlug) throw new Error('Warcraft Logs didn’t say which realm the guild is on.');
  const filters = sc === 'world' ? '' : sc === 'region' ? ',serverRegion:$region' : ',serverRegion:$region,serverSlug:$slug';
  const query = `query($id:Int!,$page:Int${sc === 'world' ? '' : ',$region:String'}${sc === 'realm' ? ',$slug:String' : ''}){worldData{encounter(id:$id){fightRankings(metric:${m},page:$page${filters})}}}`;

  const out: BossRanks = { encounterId, metric: m, scope: sc, top: [], mine: null, checked: 0 };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await gql<any>(host, query, { id: encounterId, page, region: guild?.region, slug: guild?.serverSlug }, 15_000);
    const fr = data?.worldData?.encounter?.fightRankings;
    const list: any[] = Array.isArray(fr?.rankings) ? fr.rankings : [];
    if (page === 1 && !list.length && fr && typeof fr === 'object') console.warn('boss rankings: no rankings in', Object.keys(fr).join(','));
    list.forEach((r, i) => {
      const rank = Number(r?.rank) > 0 ? Number(r.rank) : out.checked + i + 1;
      const name = String(r?.guild?.name ?? r?.name ?? 'Unknown');
      const server = r?.server?.name ?? r?.guild?.server?.name ?? null;
      const mine = !!guild && (r?.guild?.id === guild.id || (name === guild.name && (!server || server === guild.server)));
      const at = num(r?.startTime) ?? num(r?.report?.startTime);
      const seconds = num(r?.duration) !== null ? Math.round(num(r.duration)! / 1000) : null;
      if (out.top.length < SHOW) out.top.push({ rank, guild: name, server, region: r?.server?.region ?? null, at, seconds, mine });
      if (mine && !out.mine) out.mine = { rank, at, seconds };
    });
    out.checked += list.length;
    if (out.mine || !fr?.hasMorePages || !list.length) break;
  }
  cache.set(key, { at: Date.now(), value: out });
  return out;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
