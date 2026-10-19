// Warcraft Logs v2 GraphQL client (client-credentials flow).
// Response shapes for `table(...)` and `rankings` are JSON scalars, so they are typed loosely
// and read defensively in analysis.ts.

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const HOST_RE = /^([a-z0-9-]+\.)?warcraftlogs\.com$/i;

let cachedToken: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Server is missing WCL_CLIENT_ID or WCL_CLIENT_SECRET');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Warcraft Logs auth failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return cachedToken.token;
}

/** Thrown when Warcraft Logs doesn't answer in time, so callers can skip optional data. */
export class WclTimeout extends Error {}

/**
 * One GraphQL request. Each request has its own time limit (default 25s) so a slow
 * Warcraft Logs response fails with a clear message instead of running past Vercel's 60s limit.
 */
export async function gql<T>(host: string, query: string, variables: Record<string, unknown>, timeoutMs = 25_000): Promise<T> {
  if (!HOST_RE.test(host)) throw new Error('Not a Warcraft Logs host');
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`https://${host}/api/v2/client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
  if (!HOST_RE.test(url.hostname)) throw new Error('Only warcraftlogs.com links are supported.');
  const m = url.pathname.match(/\/reports\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Couldn’t find a report code in that link.');
  const host = url.hostname.toLowerCase() === 'warcraftlogs.com' ? 'www.warcraftlogs.com' : url.hostname.toLowerCase();
  const source = url.searchParams.get('source');
  return { host, code: m[1], fight: url.searchParams.get('fight') ?? undefined, source: source ? Number(source) : undefined };
}

// ---------- Queries ----------

export interface Actor { id: number; name: string; type: string; subType: string; petOwner: number | null; server?: string | null }
export interface Fight { id: number; encounterID: number; name: string; startTime: number; endTime: number; kill: boolean | null; size: number | null; difficulty: number | null }
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
    fights{id encounterID name startTime endTime kill size difficulty}
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

export interface PlayerTables { dmg: any; casts: any; buffs: any; taken: any; deaths: any }

/** One player's tables, split into two smaller queries that run at the same time. */
export async function getPlayerTables(host: string, code: string, fightId: number, sourceId: number): Promise<PlayerTables> {
  const vars = { code, fid: [fightId], sid: sourceId };
  const q1 = `query($code:String!,$fid:[Int]!,$sid:Int!){reportData{report(code:$code){
    dmg: table(dataType:DamageDone, fightIDs:$fid, sourceID:$sid)
    casts: table(dataType:Casts, fightIDs:$fid, sourceID:$sid)
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
  return { ...a.reportData.report, ...b.reportData.report };
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

export interface TopRanking { name: string; amount: number; code: string; fightID: number }

export async function getTopRankings(host: string, encounterId: number, className: string, specName: string): Promise<TopRanking[]> {
  const q = `query($enc:Int!,$cls:String!,$spec:String!){worldData{encounter(id:$enc){
    characterRankings(className:$cls, specName:$spec, metric:dps)
  }}}`;
  const d = await gql<{ worldData: { encounter: { characterRankings: any } | null } }>(host, q, { enc: encounterId, cls: className, spec: specName }, 20_000);
  const list: any[] = d.worldData.encounter?.characterRankings?.rankings ?? [];
  return list
    .filter((r) => r?.report?.code)
    .map((r) => ({ name: r.name, amount: r.amount, code: r.report.code, fightID: r.report.fightID }));
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
