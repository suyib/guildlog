// Warcraft Logs v2 GraphQL client (client-credentials flow).
// Response shapes for `table(...)` and `rankings` are JSON scalars, so they are typed loosely
// and read defensively in analysis.ts.

import { GAME } from './game.js';

// Warcraft Logs answers sign-ins on each of its sites; if one is unavailable, the next is tried
const TOKEN_URLS = ['https://www.warcraftlogs.com/oauth/token', 'https://fresh.warcraftlogs.com/oauth/token', 'https://classic.warcraftlogs.com/oauth/token'];
const HOST_RE = /^([a-z0-9-]+\.)?warcraftlogs\.com$/i;

let cachedToken: { token: string; exp: number } | null = null;
let pendingToken: Promise<string> | null = null;

/** Identifies the site to Warcraft Logs; a request with no name can look like a bot to its traffic protection. */
const CLIENT_HEADERS = { 'User-Agent': 'GuildLogs/1.0 (+https://guildlog.uk)', Accept: 'application/json' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Worth trying again: Warcraft Logs busy or briefly down (rate limit, 5xx). */
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * A Warcraft Logs access token. After the server has been idle it starts fresh with no token, so
 * the first requests all need one: they share a single sign-in, which is retried a few times if
 * Warcraft Logs is briefly unavailable.
 */
async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  pendingToken ??= fetchToken().finally(() => {
    pendingToken = null;
  });
  return pendingToken;
}

async function fetchToken(): Promise<string> {
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Server is missing WCL_CLIENT_ID or WCL_CLIENT_SECRET');
  let status = 0;
  const attempts = [...TOKEN_URLS.map((url) => ({ url, wait: 0 })), { url: TOKEN_URLS[0], wait: 2_000 }];
  for (const { url, wait } of attempts) {
    if (wait) await sleep(wait);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          ...CLIENT_HEADERS,
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      status = 0; // network error or timeout: try the next one
      continue;
    }
    if (res.ok) {
      const body = (await res.json()) as { access_token: string; expires_in: number };
      cachedToken = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
      return cachedToken.token;
    }
    status = res.status;
    if (status === 400 || status === 401) {
      throw new Error('Warcraft Logs rejected the site\u2019s API key. Check WCL_CLIENT_ID and WCL_CLIENT_SECRET in Vercel.');
    }
    if (!retryable(status)) break;
    console.warn(`Warcraft Logs sign-in at ${url} returned ${status}`);
  }
  throw new Error(`Warcraft Logs is having trouble right now (sign-in ${status ? `returned ${status}` : 'didn\u2019t answer'} on all its sites). Try again in a few minutes.`);
}

/** For troubleshooting: what each sign-in address answers right now (never includes the token itself). */
export async function signInCheck(): Promise<string[]> {
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) return ['WCL_CLIENT_ID or WCL_CLIENT_SECRET is missing in this deployment.'];
  return Promise.all(TOKEN_URLS.map(async (url) => {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', ...CLIENT_HEADERS },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(8_000),
      });
      const ms = Date.now() - started;
      if (res.ok) return `${url}: OK (${ms} ms)`;
      const text = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
      return `${url}: ${res.status} (${ms} ms) ${res.headers.get('server') ?? ''} ${text}`;
    } catch (e) {
      return `${url}: no answer (${(e as Error).message})`;
    }
  }));
}

/** Thrown when Warcraft Logs doesn't answer in time, so callers can skip optional data. */
export class WclTimeout extends Error {}

/**
 * One GraphQL request. Each request has its own time limit (default 25s) so a slow
 * Warcraft Logs response fails with a clear message instead of running past Vercel's 60s limit.
 */
export async function gql<T>(host: string, query: string, variables: Record<string, unknown>, timeoutMs = 25_000): Promise<T> {
  if (!HOST_RE.test(host)) throw new Error('Not a Warcraft Logs host');
  let res: Response | null = null;
  // One retry: a fresh token if the old one stopped working, or a short wait if Warcraft Logs was briefly unavailable
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();
    try {
      res = await fetch(`https://${host}/api/v2/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...CLIENT_HEADERS },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WclTimeout(`Warcraft Logs didn\u2019t answer within ${Math.round(timeoutMs / 1000)}s. It may be busy; try again in a minute.`);
      }
      throw e;
    }
    if (attempt > 0) break;
    if (res.status === 401) {
      cachedToken = null;
      continue;
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      await sleep(1_500);
      continue;
    }
    break;
  }
  res = res!;
  if (!res.ok) throw new Error(`Warcraft Logs API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error('Warcraft Logs: ' + body.errors.map((e) => e.message).join('; '));
  if (!body.data) throw new Error('Warcraft Logs returned no data');
  return body.data;
}

export interface ParsedUrl {
  host: string;
  code: string;
  fight?: string; // a number or "last"
  source?: number;
}

export function parseReportUrl(input: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('That doesn’t look like a link. Paste a full Warcraft Logs report URL.');
  }
  const host = url.hostname.toLowerCase();
  if (!HOST_RE.test(host)) throw new Error('Only Warcraft Logs links are supported.');
  if (!GAME.hosts.includes(host)) throw new Error(`This site is set up for ${GAME.name} logs only (${GAME.hosts.join(', ')}).`);
  const m = url.pathname.match(/\/reports\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Couldn’t find a report code in that link.');
  const source = url.searchParams.get('source');
  return { host, code: m[1], fight: url.searchParams.get('fight') ?? undefined, source: source ? Number(source) : undefined };
}

// ---------- Queries ----------

export interface Actor { id: number; name: string; type: string; subType: string; petOwner: number | null; server?: string | null }
export interface Fight { id: number; encounterID: number; name: string; startTime: number; endTime: number; kill: boolean | null; size: number | null; difficulty: number | null; friendlyPlayers?: number[] | null }
export interface ReportMeta {
  code: string;
  title: string;
  startTime: number;
  zone: { id: number; name: string } | null;
  fights: Fight[];
  masterData: { actors: Actor[] };
}

export async function getReportMeta(host: string, code: string, timeoutMs?: number): Promise<ReportMeta> {
  const q = `query($code:String!){reportData{report(code:$code){
    code title startTime zone{id name}
    fights{id encounterID name startTime endTime kill size difficulty friendlyPlayers}
    masterData{actors{id name type subType petOwner server}}
  }}}`;
  const d = await gql<{ reportData: { report: ReportMeta | null } }>(host, q, { code }, timeoutMs);
  if (!d.reportData.report) throw new Error('Report not found (it may be private or archived).');
  return d.reportData.report;
}

export interface FightData { damage: any; rankings?: any; details?: any }

/**
 * Fight-wide tables, fetched once per fight. The damage table is required. Rankings and
 * player details (parse %, item level, realm) are often the slowest things Warcraft Logs
 * computes, so they run as separate requests with a shorter time limit and are left out
 * if they don't arrive in time.
 */
export async function getFightData(host: string, code: string, fightId: number, opts: { rankings?: boolean } = { rankings: true }): Promise<FightData> {
  const vars = { code, fid: [fightId] };
  const one = (field: string, timeoutMs: number) =>
    gql<{ reportData: { report: Record<string, any> } }>(
      host,
      `query($code:String!,$fid:[Int]!){reportData{report(code:$code){ ${field} }}}`,
      vars,
      timeoutMs,
    ).then((d) => d.reportData.report);
  const optional = (field: string) => one(field, 15_000).catch(() => ({}) as Record<string, any>);

  const [damage, rankings, details] = await Promise.all([
    one('damage: table(dataType:DamageDone, fightIDs:$fid)', 40_000),
    opts.rankings ? optional('rankings(fightIDs:$fid, playerMetric:dps)') : Promise.resolve({} as Record<string, any>),
    opts.rankings ? optional('details: playerDetails(fightIDs:$fid)') : Promise.resolve({} as Record<string, any>),
  ]);
  return { damage: damage.damage, rankings: rankings.rankings, details: details.details };
}

export interface PlayerTables {
  dmg: any;
  casts: any;
  buffs: any;
  taken: any;
  deaths: any;
  /** Damage by each of this player's pets (hunter and warlock pets, totems), so their damage can be told apart. */
  pets?: { name: string; entries: any[] }[];
}

/** One player's tables, split into two smaller queries that run at the same time, plus their pets' damage. */
export async function getPlayerTables(host: string, code: string, fightId: number, sourceId: number): Promise<PlayerTables> {
  const vars = { code, fid: [fightId], sid: sourceId };
  const q1 = `query($code:String!,$fid:[Int]!,$sid:Int!){reportData{report(code:$code){
    dmg: table(dataType:DamageDone, fightIDs:$fid, sourceID:$sid)
    casts: table(dataType:Casts, fightIDs:$fid, sourceID:$sid)
    masterData{actors(type:"Pet"){id name petOwner}}
  }}}`;
  const q2 = `query($code:String!,$fid:[Int]!,$sid:Int!){reportData{report(code:$code){
    buffs: table(dataType:Buffs, fightIDs:$fid, sourceID:$sid)
    taken: table(dataType:DamageTaken, fightIDs:$fid, sourceID:$sid)
    deaths: table(dataType:Deaths, fightIDs:$fid, sourceID:$sid)
  }}}`;
  const [a, b] = await Promise.all([
    gql<{ reportData: { report: any } }>(host, q1, vars),
    gql<{ reportData: { report: any } }>(host, q2, vars),
  ]);
  const { masterData, ...first } = a.reportData.report;
  const owned = ((masterData?.actors ?? []) as { id: number; name: string; petOwner: number | null }[]).filter((x) => x.petOwner === sourceId).slice(0, 6);
  const pets = owned.length ? await getPetTables(host, code, fightId, owned) : [];
  return { ...first, ...b.reportData.report, pets };
}

/** Each pet's own damage table in one query. Optional: without it, pet damage just isn't labeled. */
async function getPetTables(host: string, code: string, fightId: number, pets: { id: number; name: string }[]) {
  const fields = pets.map((p, i) => `p${i}: table(dataType:DamageDone, fightIDs:$fid, sourceID:${Math.trunc(p.id)})`).join('\n');
  try {
    const d = await gql<{ reportData: { report: Record<string, any> } }>(host, `query($code:String!,$fid:[Int]!){reportData{report(code:$code){ ${fields} }}}`, { code, fid: [fightId] }, 15_000);
    return pets.map((p, i) => ({ name: p.name, entries: (d.reportData.report[`p${i}`]?.data?.entries ?? []) as any[] })).filter((p) => p.entries.length);
  } catch {
    return [];
  }
}

export interface CastEvent { timestamp: number; type: string; abilityGameID: number; sourceID: number; targetID?: number }

export async function getCastEvents(host: string, code: string, fight: Fight, sourceId: number): Promise<{ events: CastEvent[]; abilities: Map<number, string> }> {
  const q = `query($code:String!,$fid:[Int]!,$sid:Int!,$st:Float,$et:Float){reportData{report(code:$code){
    events(dataType:Casts, fightIDs:$fid, sourceID:$sid, startTime:$st, endTime:$et, limit:10000){data nextPageTimestamp}
    masterData{abilities{gameID name}}
  }}}`;
  const events: CastEvent[] = [];
  let start: number | null = fight.startTime;
  let abilities = new Map<number, string>();
  const deadline = Date.now() + 45_000; // all pages together must fit inside one 60s function
  for (let page = 0; start !== null && page < 10; page++) {
    const left = deadline - Date.now();
    if (left < 3_000) throw new WclTimeout('Warcraft Logs was too slow sending the cast events for this player. Try again in a minute.');
    const d: any = await gql(host, q, { code, fid: [fight.id], sid: sourceId, st: start, et: fight.endTime }, Math.min(25_000, left));
    const rep = d.reportData.report;
    if (page === 0) abilities = new Map((rep.masterData?.abilities ?? []).map((a: any) => [a.gameID, a.name]));
    events.push(...(rep.events?.data ?? []));
    start = rep.events?.nextPageTimestamp ?? null;
  }
  return { events: events.filter((e) => e.type === 'cast'), abilities };
}

/**
 * Auto attacks (Auto Shot, Melee) as cast-like events, read from the player's damage events.
 * Warcraft Logs doesn't always include auto attacks in a player's cast events, but every swing,
 * hit or miss, shows up as a damage event. Optional: returns nothing if it's slow or fails.
 */
export async function getAutoAttackEvents(host: string, code: string, fight: Fight, sourceId: number, abilityId: number): Promise<CastEvent[]> {
  const q = `query($code:String!,$fid:[Int]!,$sid:Int!,$ab:Float,$st:Float,$et:Float){reportData{report(code:$code){
    events(dataType:DamageDone, fightIDs:$fid, sourceID:$sid, abilityID:$ab, startTime:$st, endTime:$et, limit:10000){data nextPageTimestamp}
  }}}`;
  const out: CastEvent[] = [];
  let start: number | null = fight.startTime;
  const deadline = Date.now() + 25_000;
  try {
    for (let page = 0; start !== null && page < 5; page++) {
      const left = deadline - Date.now();
      if (left < 3_000) break;
      const d: any = await gql(host, q, { code, fid: [fight.id], sid: sourceId, ab: abilityId, st: start, et: fight.endTime }, Math.min(15_000, left));
      for (const e of d.reportData.report.events?.data ?? []) {
        // One swing can log more than one damage event; keep one per swing
        if (e?.type === 'damage' && e.sourceID === sourceId && !(out.length && e.timestamp - out[out.length - 1].timestamp < 50)) {
          out.push({ timestamp: e.timestamp, type: 'cast', abilityGameID: abilityId, sourceID: sourceId });
        }
      }
      start = d.reportData.report.events?.nextPageTimestamp ?? null;
    }
  } catch {
    return [];
  }
  return out;
}

/** The report's region slug (e.g. "eu", "us"), for character portraits. Separate query so it can't break report loading. */
export async function getReportRegion(host: string, code: string): Promise<string | null> {
  try {
    const d = await gql<any>(host, `query($code:String!){reportData{report(code:$code){region{slug}}}}`, { code });
    return d.reportData?.report?.region?.slug?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ---------- Personal dashboard (no comparison) ----------

export interface DashboardRaw {
  summary: any;
  combatant: any;
  damageEvents: AmountEvent[];
  /** Damage the player took, one event per hit. */
  takenEvents: AmountEvent[];
  taken: any;
  tankIds: number[];
  raidIds: number[];
  /** Healing: the player's own table (by ability), everyone's (active time, ranks), the hps rankings, and heals over time. */
  healing: { mine: any; everyone: any; rankings: any; events: AmountEvent[] };
}

export type AmountKind = 'damage' | 'healing' | 'taken';
export interface AmountEvent { timestamp: number; amount: number; ability?: string }

/**
 * One player's damage done, healing done or damage taken across the fight, paged, within a time
 * budget. Damage taken events carry the ability's name (for "what hit you" on the chart).
 */
async function getAmountEvents(host: string, code: string, fightId: number, sourceId: number, start: number, end: number, kind: AmountKind): Promise<AmountEvent[]> {
  const dataType = kind === 'damage' ? 'DamageDone' : kind === 'healing' ? 'Healing' : 'DamageTaken';
  const who = kind === 'taken' ? 'targetID:$sid' : 'sourceID:$sid';
  const q = (withNames: boolean) => `query($code:String!,$fid:[Int]!,$sid:Int!,$st:Float,$et:Float){reportData{report(code:$code){
    events(dataType:${dataType}, fightIDs:$fid, ${who}, startTime:$st, endTime:$et, limit:10000){data nextPageTimestamp}
    ${withNames ? 'masterData{abilities{gameID name}}' : ''}
  }}}`;
  // Damage is "damage" events; healing is "heal" plus shields soaking damage ("absorbed")
  const types = kind === 'healing' ? new Set(['heal', 'absorbed']) : new Set(['damage']);
  const out: AmountEvent[] = [];
  let names = new Map<number, string>();
  let st: number | null = start;
  const deadline = Date.now() + 35_000;
  for (let page = 0; st !== null && page < 8; page++) {
    const left = deadline - Date.now();
    if (left < 3_000) break; // keep what we have; the chart is scaled to the real average anyway
    const withNames = kind === 'taken' && page === 0;
    const d: any = await gql(host, q(withNames), { code, fid: [fightId], sid: sourceId, st, et: end }, Math.min(20_000, left));
    const rep = d.reportData.report;
    if (withNames) names = new Map(((rep.masterData?.abilities ?? []) as any[]).map((a) => [a.gameID, a.name]));
    for (const e of rep.events?.data ?? []) {
      if (!types.has(e?.type) || typeof e.timestamp !== 'number') continue;
      if (kind === 'taken' && e.targetID !== sourceId) continue;
      // Damage (done or taken) counts what shields absorbed too; healing counts only what landed, not overheal
      const amount = kind === 'healing' ? Number(e.amount) || 0 : (Number(e.amount) || 0) + (Number(e.absorbed) || 0);
      if (amount <= 0) continue;
      out.push(kind === 'taken' ? { timestamp: e.timestamp, amount, ability: names.get(e.abilityGameID) ?? 'Unknown' } : { timestamp: e.timestamp, amount });
    }
    st = rep.events?.nextPageTimestamp ?? null;
  }
  return out;
}

/**
 * A player's healing tables for a fight: their own (by spell), everyone's (active time, place among
 * the healers) and the healing rankings (parse). Empty parts when Warcraft Logs doesn't answer.
 */
export async function getHealingTables(host: string, code: string, fightId: number, sourceId: number): Promise<{ mine: any; everyone: any; rankings: any }> {
  const d = await gql<{ reportData: { report: Record<string, any> } }>(
    host,
    `query($code:String!,$fid:[Int]!,$sid:Int!){reportData{report(code:$code){
      mine: table(dataType:Healing, fightIDs:$fid, sourceID:$sid)
      everyone: table(dataType:Healing, fightIDs:$fid)
      rankings(fightIDs:$fid, playerMetric:hps)
    }}}`,
    { code, fid: [fightId], sid: sourceId },
    20_000,
  ).catch(() => null);
  const r = d?.reportData.report ?? {};
  return { mine: r.mine, everyone: r.everyone, rankings: r.rankings };
}

/**
 * One player's gear, stats, damage done, healing and damage taken over time, and the raid's damage taken. Each part is its own
 * request with a time limit, and any part that fails or is slow is simply left out.
 */
export async function getDashboardRaw(host: string, code: string, fightId: number, sourceId: number, start: number, end: number): Promise<DashboardRaw> {
  const report = (query: string, vars: Record<string, unknown>) =>
    gql<{ reportData: { report: Record<string, any> } }>(host, query, vars, 20_000)
      .then((d) => d.reportData.report)
      .catch(() => ({}) as Record<string, any>);
  // Healing: the tables first (cheap); heals over time only for players who actually healed
  const healing = getHealingTables(host, code, fightId, sourceId).then(async (h) => {
    const mineTotal = ((h.mine?.data?.entries ?? []) as any[]).reduce((t, e) => t + (Number(e?.total) || 0), 0);
    const events = mineTotal > 0 ? await getAmountEvents(host, code, fightId, sourceId, start, end, 'healing').catch(() => []) : [];
    return { ...h, events };
  });
  const [summary, details, damageEvents, taken, heal, takenEvents] = await Promise.all([
    report(`query($code:String!,$fid:[Int]!,$sid:Int!){reportData{report(code:$code){ summary: table(dataType:Summary, fightIDs:$fid, sourceID:$sid) }}}`, { code, fid: [fightId], sid: sourceId }),
    report(`query($code:String!,$fid:[Int]!){reportData{report(code:$code){ details: playerDetails(fightIDs:$fid, includeCombatantInfo:true) }}}`, { code, fid: [fightId] }),
    getAmountEvents(host, code, fightId, sourceId, start, end, 'damage').catch(() => []),
    report(`query($code:String!,$fid:[Int]!){reportData{report(code:$code){ taken: table(dataType:DamageTaken, fightIDs:$fid) }}}`, { code, fid: [fightId] }),
    healing,
    getAmountEvents(host, code, fightId, sourceId, start, end, 'taken').catch(() => []),
  ]);
  const d = details.details?.data?.playerDetails ?? details.details?.playerDetails ?? {};
  const everyone = ['tanks', 'healers', 'dps'].flatMap((r) => (d[r] ?? []) as any[]);
  const mine = everyone.find((p) => p.id === sourceId);
  return {
    summary: summary.summary,
    combatant: mine?.combatantInfo ?? null,
    damageEvents,
    takenEvents,
    taken: taken.taken,
    tankIds: ((d.tanks ?? []) as any[]).map((p) => p.id),
    raidIds: everyone.map((p) => p.id),
    healing: heal,
  };
}
