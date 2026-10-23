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
  /** The report's region slug ("eu", "us"), for character portraits and levels. */
  region?: string | null;
}

export async function getReportMeta(host: string, code: string, timeoutMs?: number): Promise<ReportMeta> {
  const q = (withRegion: boolean) => `query($code:String!){reportData{report(code:$code){
    code title startTime zone{id name} ${withRegion ? 'region{slug}' : ''}
    fights{id encounterID name startTime endTime kill size difficulty friendlyPlayers}
    masterData{actors{id name type subType petOwner server}}
  }}}`;
  type Raw = Omit<ReportMeta, 'region'> & { region?: { slug?: string } | null };
  // The region is a nice-to-have: if asking for it fails, read the report without it
  const d = await gql<{ reportData: { report: Raw | null } }>(host, q(true), { code }, timeoutMs).catch((e) => {
    if (/region/i.test((e as Error).message)) return gql<{ reportData: { report: Raw | null } }>(host, q(false), { code }, timeoutMs);
    throw e;
  });
  const r = d.reportData.report;
  if (!r) throw new Error('Report not found (it may be private or archived).');
  return { ...r, region: r.region?.slug?.toLowerCase() ?? null };
}

/** Several tables (or rankings) for one fight in a single request, each under its own alias. */
export async function getTables(host: string, code: string, fightId: number, fields: string, timeoutMs = 25_000): Promise<Record<string, any>> {
  const d = await gql<{ reportData: { report: Record<string, any> } }>(
    host,
    `query($code:String!,$fid:[Int]!){reportData{report(code:$code){ ${fields} }}}`,
    { code, fid: [fightId] },
    timeoutMs,
  );
  return d.reportData.report ?? {};
}

/** Every ability's name and icon in the report, for naming events. */
export async function getAbilities(host: string, code: string, timeoutMs = 20_000): Promise<Map<number, { name: string; icon?: string }>> {
  const d = await gql<any>(host, 'query($code:String!){reportData{report(code:$code){masterData{abilities{gameID name icon}}}}}', { code }, timeoutMs);
  return new Map(((d.reportData?.report?.masterData?.abilities ?? []) as any[]).map((a) => [a.gameID, { name: String(a.name), icon: typeof a.icon === 'string' ? a.icon : undefined }]));
}

export type EventKind = 'DamageDone' | 'Healing' | 'DamageTaken' | 'Casts';

/**
 * Every event of one kind in a fight (everyone on the raid's side), read as several time slices
 * at once so even a long fight arrives within one function call. `run` limits how many requests
 * are open at the same time. Throws WclTimeout if it can't all be read before the deadline: a
 * partial set would give wrong totals.
 */
export async function getFightEvents(
  host: string, code: string, fight: { id: number; startTime: number; endTime: number }, kind: EventKind,
  deadline: number, run: <T>(job: () => Promise<T>) => Promise<T>, withResources = false,
): Promise<any[]> {
  // withResources: each event also carries the caster's mana (and other resources) at that moment
  const q = `query($code:String!,$fid:[Int]!,$st:Float,$et:Float){reportData{report(code:$code){
    events(dataType:${kind}, fightIDs:$fid, startTime:$st, endTime:$et, limit:10000${withResources ? ', includeResources:true' : ''}){data nextPageTimestamp}
  }}}`;
  const length = fight.endTime - fight.startTime;
  const slices = Math.min(8, Math.max(1, Math.ceil(length / 90_000)));
  const step = Math.ceil(length / slices);
  const parts = await Promise.all(Array.from({ length: slices }, (_, i) => run(async () => {
    const from = fight.startTime + i * step;
    const to = i === slices - 1 ? fight.endTime + 1 : from + step;
    const out: any[] = [];
    let st: number | null = from;
    for (let page = 0; st !== null && st < to; page++) {
      const left = deadline - Date.now();
      if (left < 3_000 || page >= 25) throw new WclTimeout('Warcraft Logs was too slow sending this fight. Try again in a minute.');
      const d: any = await gql(host, q, { code, fid: [fight.id], st, et: to }, Math.min(25_000, left));
      for (const e of d.reportData.report.events?.data ?? []) if (e && e.timestamp >= from && e.timestamp < to) out.push(e);
      st = d.reportData.report.events?.nextPageTimestamp ?? null;
    }
    return out;
  })));
  return parts.flat();
}

/** The shape analysis.ts reads a player's tables in (rebuilt from the stored fight). */
export interface PlayerTables {
  dmg: any;
  casts: any;
  buffs: any;
  taken: any;
  deaths: any;
  /** Damage by each of this player's pets (hunter and warlock pets, totems), so their damage can be told apart. */
  pets?: { name: string; entries: any[] }[];
}

export interface CastEvent { timestamp: number; type: string; abilityGameID: number; sourceID: number; targetID?: number }
export interface AmountEvent { timestamp: number; amount: number; ability?: string }

