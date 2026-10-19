// Minimal Supabase (PostgREST) access using the service role key. Server-side only.
import type { AnalysisResult, HistoryRow, PlayerSnapshot } from './types.js';

function cfg() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '');
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const c = cfg();
  if (!c) throw new Error('Supabase is not configured');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only need apikey.
      ...(c.key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${c.key}` }),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
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
      compare_key: result.compareKey ?? 'auto',
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

/** The same character's most recent earlier analysis of the same boss, from another report. */
export async function previousKill(playerName: string, encounterId: number, excludeCode: string): Promise<{ snapshot: PlayerSnapshot; createdAt: string } | null> {
  if (!dbEnabled()) return null;
  const q = `analyses?player_name=eq.${encodeURIComponent(playerName)}&encounter_id=eq.${encounterId}&report_code=neq.${encodeURIComponent(excludeCode)}&select=created_at,result&order=created_at.desc&limit=1`;
  const rows = await rest(q);
  if (!rows?.[0]) return null;
  return { snapshot: rows[0].result.player, createdAt: rows[0].created_at };
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

/** Top-ranked parse lookups are slow and rankings change slowly, so reuse them for 12 hours. */
export async function getCachedTop(key: string): Promise<unknown | undefined> {
  if (!dbEnabled()) return undefined;
  try {
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const rows = await rest(`top_cache?key=eq.${encodeURIComponent(key)}&created_at=gte.${since}&select=target`);
    return rows?.[0] ? rows[0].target : undefined;
  } catch {
    return undefined;
  }
}

export async function putCachedTop(key: string, target: unknown): Promise<void> {
  if (!dbEnabled()) return;
  try {
    await rest('top_cache?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, target, created_at: new Date().toISOString() }),
    });
  } catch {
    /* cache is optional */
  }
}
