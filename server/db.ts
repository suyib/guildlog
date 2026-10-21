// Minimal Supabase (PostgREST) access using the service role key. Server-side only.
import type { AnalysisResult, HistoryRow, PlayerSnapshot } from './types.js';

function cfg() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '');
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError' || /aborted due to timeout/i.test(e.message));

/**
 * One PostgREST call. Reads are retried once if the database is slow to answer (a Supabase project
 * that's been idle can take a few seconds to wake); writes aren't, as they may already have landed.
 */
export async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const read = !init.method || init.method === 'GET';
  try {
    return await restOnce(path, init);
  } catch (e) {
    if (!read || !isTimeout(e)) throw e;
    return restOnce(path, init);
  }
}

export class DbTimeout extends Error {
  constructor() {
    super('The database was slow to answer. Please try again in a minute.');
    this.name = 'TimeoutError'; // so callers can tell it apart from other errors
  }
}

async function restOnce(path: string, init: RequestInit): Promise<any> {
  const c = cfg();
  if (!c) throw new Error('Supabase is not configured');
  let res: Response;
  try {
    res = await fetch(`${c.url}/rest/v1/${path}`, {
      signal: AbortSignal.timeout(8_000), // the database should never be what makes a step time out
      ...init,
      headers: {
        apikey: c.key,
        // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only need apikey.
        ...(c.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${c.key}` }),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    if (isTimeout(e)) throw new DbTimeout();
    throw e;
  }
  if (res.status === 401) {
    throw new Error('Supabase rejected the key. In Vercel, set SUPABASE_SERVICE_ROLE_KEY to the secret (sb_secret_…) or legacy service_role key from the same project as SUPABASE_URL, then redeploy.');
  }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const dbEnabled = () => cfg() !== null;

export async function saveAnalysis(result: AnalysisResult): Promise<{ id: string; created_at: string } | null> {
  if (!dbEnabled()) return null;
  const p = result.player;
  const rows = await rest('analyses?on_conflict=report_code,fight_id,player_name,compare_key&select=id,created_at', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      host: p.host,
      report_code: p.reportCode,
      fight_id: p.fightId,
      encounter_id: p.encounterId,
      encounter_name: p.encounterName,
      player_name: p.name,
      class_name: p.className,
      spec_name: p.specName,
      dps: p.dps,
      parse_percent: p.parsePercent,
      compare_key: result.compareKey ?? 'none',
      result,
    }),
  });
  return rows?.[0] ?? null;
}

export async function listHistory(limit = 100): Promise<HistoryRow[]> {
  if (!dbEnabled()) return [];
  return rest(`analyses?select=id,created_at,report_code,fight_id,encounter_name,player_name,class_name,spec_name,dps,parse_percent,compare_key&order=created_at.desc&limit=${limit}`);
}

export async function getAnalysis(id: string): Promise<AnalysisResult | null> {
  if (!dbEnabled() || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await rest(`analyses?id=eq.${id}&select=id,created_at,result`);
  if (!rows?.[0]) return null;
  return { ...rows[0].result, id: rows[0].id, createdAt: rows[0].created_at };
}

// ---------- Caches (make repeat analyses fast) ----------

/** A finished fight doesn't change, so a player's snapshot for it can be reused. */
export async function getCachedSnapshot(key: string): Promise<PlayerSnapshot | null> {
  if (!dbEnabled()) return null;
  try {
    const rows = await rest(`snapshot_cache?key=eq.${encodeURIComponent(key)}&select=snapshot`);
    return rows?.[0]?.snapshot ?? null;
  } catch {
    return null; // cache is optional
  }
}

export async function putCachedSnapshot(key: string, snapshot: PlayerSnapshot): Promise<void> {
  if (!dbEnabled()) return;
  try {
    await rest('snapshot_cache?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, snapshot }),
    });
  } catch {
    /* cache is optional */
  }
}
