// Saved copies of our own raids, so they can still be read when Warcraft Logs is down.
// One table holds every piece, keyed by report, kind, fight and player:
//   meta       the report's fights and players (fight 0, player 0)
//   breakdown  the whole-raid breakdown of a boss kill
//   rows       everyone's fight-wide numbers for a kill (the first step of a player analysis)
//   snapshot   one player's analysis data for a kill
//   dashboard  one player's gear, stats, DPS over time and survival for a kill
import { dbEnabled, rest } from './db.js';
import type { Offline } from './types.js';
import { type ReportMeta, getReportMeta } from './wcl.js';

export type SavedKind = 'meta' | 'breakdown' | 'rows' | 'snapshot' | 'dashboard';

const q = encodeURIComponent;

export async function getSaved<T>(code: string, kind: SavedKind, fightId = 0, playerId = 0): Promise<{ data: T; savedAt: string } | null> {
  if (!dbEnabled()) return null;
  const rows = await rest(`saved_data?report_code=eq.${q(code)}&kind=eq.${kind}&fight_id=eq.${fightId}&player_id=eq.${playerId}&select=data,created_at`).catch(() => null);
  const r = rows?.[0];
  return r ? { data: r.data as T, savedAt: r.created_at as string } : null;
}

export async function putSaved(code: string, kind: SavedKind, data: unknown, fightId = 0, playerId = 0): Promise<void> {
  await rest('saved_data?on_conflict=report_code,kind,fight_id,player_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ report_code: code, kind, fight_id: fightId, player_id: playerId, data, created_at: new Date().toISOString() }),
  });
}

/** Which pieces of a raid are already saved, as "kind:fight:player" keys. */
export async function savedKeys(code: string): Promise<Set<string>> {
  const rows: { kind: string; fight_id: number; player_id: number }[] = (await rest(`saved_data?report_code=eq.${q(code)}&select=kind,fight_id,player_id`)) ?? [];
  return new Set(rows.map((r) => savedKey(r.kind as SavedKind, r.fight_id, r.player_id)));
}

export const savedKey = (kind: SavedKind, fightId = 0, playerId = 0) => `${kind}:${fightId}:${playerId}`;

/**
 * Run the live request; if it fails (Warcraft Logs down or too slow) and this raid was saved, use
 * the saved copy instead. Objects come back marked `offline` so the page can say so.
 */
export async function liveOrSaved<T>(code: string, kind: SavedKind, fightId: number, playerId: number, live: () => Promise<T>): Promise<T> {
  try {
    return await live();
  } catch (e) {
    const saved = await getSaved<T>(code, kind, fightId, playerId);
    if (!saved) throw e;
    const offline: Offline = { savedAt: saved.savedAt };
    return Array.isArray(saved.data) || typeof saved.data !== 'object' || saved.data === null ? saved.data : ({ ...saved.data, offline } as T);
  }
}

/** The report's fights and players, from Warcraft Logs or else the saved copy. */
export async function metaLiveOrSaved(host: string, code: string, timeoutMs?: number): Promise<{ meta: ReportMeta; offline?: Offline }> {
  try {
    return { meta: await getReportMeta(host, code, timeoutMs) };
  } catch (e) {
    const saved = await getSaved<ReportMeta>(code, 'meta');
    if (!saved) throw e;
    return { meta: saved.data, offline: { savedAt: saved.savedAt } };
  }
}
