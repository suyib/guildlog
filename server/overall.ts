// The whole night on the site ("Whole night" in the boss list): the same overview as /raidend,
// plus everyone's numbers across all the boss kills. Reads each kill's stored summary (building
// any missing ones within a time budget), so asking again picks up the rest.
import { buildCard, refreshCard } from './archive.js';
import { type PlayerDigest, healsMost, raidDigest } from './discord/digest.js';
import type { RaidOverview } from './types.js';

export async function overallRaid(host: string, code: string): Promise<RaidOverview> {
  const digest = await raidDigest(host, code, 40_000);
  const { meta, fights } = digest;
  const card = buildCard(meta, fights);
  // Keep the Past raids card up to date too
  await refreshCard(code, meta, fights).catch(() => undefined);

  // Everyone across the night: bosses, average parse (healing parse for healers), DPS or HPS, deaths
  const byName = new Map<string, { p: PlayerDigest; rows: { fightId: number; boss: string; p: PlayerDigest; seconds: number }[] }>();
  for (const f of fights) {
    for (const p of f.players) {
      const x = byName.get(p.name) ?? { p, rows: [] };
      x.rows.push({ fightId: f.id, boss: f.name, p, seconds: f.seconds });
      x.p = p;
      byName.set(p.name, x);
    }
  }
  const players = [...byName.values()].map(({ p, rows }) => {
    const healer = rows.filter((r) => healsMost(r.p)).length * 2 > rows.length;
    const parseOf = (x: PlayerDigest) => (healer ? x.healing?.parse ?? null : x.parse);
    const parses = rows.map((r) => parseOf(r.p)).filter((v): v is number => v !== null);
    const seconds = rows.reduce((t, r) => t + r.seconds, 0) || 1;
    const amount = rows.reduce((t, r) => t + (healer ? r.p.healing?.total ?? 0 : r.p.total), 0);
    const best = [...rows].sort((a, b) => (parseOf(b.p) ?? -1) - (parseOf(a.p) ?? -1))[0];
    return {
      id: p.id,
      name: p.name,
      className: p.className,
      specName: p.specName,
      role: p.role,
      healer,
      bosses: rows.length,
      avgParse: parses.length ? Math.round(parses.reduce((t, v) => t + v, 0) / parses.length) : null,
      perSecond: amount / seconds,
      deaths: rows.reduce((t, r) => t + r.p.deaths.length, 0),
      itemLevel: p.itemLevel,
      best: { fightId: best.fightId, playerId: best.p.id, boss: best.boss, parse: parseOf(best.p) },
    };
  });
  return {
    host,
    code,
    title: meta.title,
    startTime: meta.startTime,
    card,
    players: players.sort((a, b) => (b.avgParse ?? -1) - (a.avgParse ?? -1) || b.perSecond - a.perSecond),
    pending: digest.pending,
  };
}
