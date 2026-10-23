// Everyone's numbers for each boss kill in a report, for the Discord bot, raid cards and Whole night.
// Each fight's digest is stored with the fight (see pack.ts); a kill that hasn't been read yet is
// read once (its fight-wide tables only, a few requests), so button presses afterwards are instant.
import { type FightDigest, DIGEST_VERSION, digestFromPack } from '../fightDigest.js';
import { digestRows, getMeta, getPack } from '../pack.js';
import type { ReportMeta } from '../wcl.js';

export { type FightDigest, type PlayerDigest, DIGEST_VERSION, healsMost } from '../fightDigest.js';

export interface RaidDigest {
  host: string;
  code: string;
  meta: ReportMeta;
  fights: FightDigest[];
  /** Boss kills not summarized yet (Warcraft Logs was slow); pressing the button again picks them up. */
  pending: number;
}

/**
 * The digest for a whole report: stored fights plus any boss kills not read yet, within a time
 * budget so it fits in one function call. `fresh` reads the report's fight list from Warcraft Logs
 * even if a stored copy exists (for /raidend, while the log may still be growing).
 */
export async function raidDigest(host: string, code: string, budgetMs = 40_000, opts: { fresh?: boolean } = {}): Promise<RaidDigest> {
  const deadline = Date.now() + budgetMs;
  const [{ meta }, rows] = await Promise.all([getMeta(host, code, { fresh: opts.fresh, timeoutMs: 15_000 }), digestRows(code).catch(() => [])]);
  const kills = meta.fights.filter((f) => f.encounterID > 0 && f.kill);
  const have = new Map(rows.filter((r) => r.digest?.v === DIGEST_VERSION).map((r) => [r.fightId, r.digest!]));
  // Older digests (stored before fights were kept whole) still answer until the fight is read again
  const older = new Map(rows.filter((r) => r.digest && (r.digest.v ?? 0) >= 3).map((r) => [r.fightId, r.digest!]));
  const missing = kills.filter((f) => !have.has(f.id) && !rows.some((r) => r.fightId === f.id && r.stage === 'legacy'));

  // Read missing fights three at a time until the budget runs out
  let next = 0;
  const worker = async () => {
    while (next < missing.length && Date.now() < deadline - 20_000) {
      const f = missing[next++];
      try {
        const pack = await getPack(host, code, { id: f.id, encounterID: f.encounterID, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: !!f.kill }, 'tables');
        have.set(f.id, digestFromPack(host, pack));
      } catch {
        /* left pending; the next request tries again */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const fights = kills.map((f) => have.get(f.id) ?? older.get(f.id)).filter((x): x is FightDigest => !!x && (x.v ?? 0) >= 3);
  return { host, code, meta, fights, pending: kills.length - fights.length };
}

/** The player's rows across the raid, matched by name (and realm when both are known). */
export function playerFights(digest: RaidDigest, name: string, realm: string | null) {
  const key = name.trim().toLowerCase();
  return digest.fights
    .map((f) => ({ fight: f, p: f.players.find((p) => p.name.toLowerCase() === key && (!realm || !p.server || p.server.toLowerCase() === realm.toLowerCase())) }))
    .filter((x): x is { fight: FightDigest; p: FightDigest['players'][number] } => !!x.p);
}
