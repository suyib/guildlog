// The home page (guild at a glance) and each person's profile (their claimed characters).
// Built from what's already stored: Past raids cards, the bot's raid summaries, claims and
// saved analyses. Nothing here needs Warcraft Logs, except a character's level (optional).
import { listRaids } from './archive.js';
import { characterLevel } from './blizzard.js';
import { dbEnabled, listHistory, rest } from './db.js';
import { discord, env } from './discord/api.js';
import { type FightDigest, type PlayerDigest, healsMost } from './discord/digest.js';
import { claimsFor, recentRaids } from './discord/store.js';
import { reportRegion, storedDigests } from './pack.js';
import { trendFor } from './benchmarks.js';
import type { Session } from './auth.js';
import type { HomeData, ProfileCharacter, ProfileData, SavedRaid } from './types.js';
import { membership } from './officers.js';
import { discordRank, effectiveRank } from './ranks.js';

const WEEK = 7 * 86_400_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);

/** The guild's Discord server: name, icon and member counts (via the bot). */
async function guildInfo(): Promise<HomeData['guild']> {
  const id = env.guildId();
  if (!id) return null;
  const g = await discord<{ id: string; name: string; icon: string | null; approximate_member_count?: number; approximate_presence_count?: number }>(`/guilds/${id}?with_counts=true`).catch(() => null);
  if (!g) return null;
  return {
    name: g.name,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    members: g.approximate_member_count ?? null,
    online: g.approximate_presence_count ?? null,
  };
}

/** The next raid someone set a reminder for with /remind. */
async function nextRaid(): Promise<HomeData['nextRaid']> {
  const now = encodeURIComponent(new Date().toISOString());
  const rows: { payload: { message?: string; place?: string | null; gatherAt?: string } }[] =
    (await rest(`bot_reminders?select=payload&payload->>gatherAt=gt.${now}&order=send_at.asc&limit=1`).catch(() => [])) ?? [];
  const p = rows[0]?.payload;
  return p?.gatherAt ? { message: p.message ?? 'Raid', place: p.place ?? null, gatherAt: p.gatherAt } : null;
}

export async function homeData(session: Session | null): Promise<HomeData> {
  const [guild, next, list, recent, claims] = await Promise.all([
    guildInfo(),
    dbEnabled() ? nextRaid() : Promise.resolve(null),
    dbEnabled() ? listRaids().catch(() => ({ raids: [] as SavedRaid[], archiveDays: 90 })) : Promise.resolve({ raids: [] as SavedRaid[], archiveDays: 90 }),
    dbEnabled() ? listHistory(6).catch(() => []) : Promise.resolve([]),
    session?.uid && dbEnabled() ? claimsFor(session.uid).catch(() => []) : Promise.resolve([]),
  ]);
  const dated = list.raids.filter((r) => r.startTime && r.card);
  const last8 = dated.filter((r) => Date.now() - new Date(r.startTime!).getTime() <= 8 * WEEK);
  const last4 = dated.filter((r) => Date.now() - new Date(r.startTime!).getTime() <= 4 * WEEK);
  const raiders = new Set(last4.flatMap((r) => r.card!.raiders.map((p) => p.name)));
  // Highlights from the latest raid that's been read in full
  const latest = dated.find((r) => (r.card!.summarized ?? r.card!.kills) >= r.card!.kills) ?? null;
  return {
    guild,
    nextRaid: next,
    stats: {
      raids8w: last8.length,
      fullClears8w: last8.filter((r) => r.card!.kills > 0 && r.card!.bosses.every((b) => b.kill)).length,
      avgRaidSeconds: avg(last8.map((r) => r.card!.raidSeconds).filter((v) => v > 0)),
      activeRaiders4w: raiders.size,
    },
    // Including raids still being read, so a new raid shows up straight away
    latestRaids: list.raids.filter((r) => r.startTime).slice(0, 4),
    highlights: latest?.card?.feedback.good.slice(0, 3) ?? [],
    recentAnalyses: recent,
    myCharacters: claims.map((c) => ({ name: c.character, status: c.status })),
  };
}

// ---------- Profile ----------

/** Raids to look through for a character: Past raids first, then any the bot knows. */
async function raidCodes(): Promise<{ host: string; code: string; title: string; date: string }[]> {
  const [list, bot] = await Promise.all([listRaids().catch(() => ({ raids: [] as SavedRaid[] })), recentRaids(10).catch(() => [])]);
  const out = new Map<string, { host: string; code: string; title: string; date: string }>();
  for (const r of list.raids) if (r.startTime) out.set(r.code, { host: r.host, code: r.code, title: r.title ?? r.code, date: r.startTime });
  for (const r of bot) if (!out.has(r.report_code)) out.set(r.report_code, { host: r.host, code: r.report_code, title: r.title ?? r.report_code, date: r.started_at });
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}

export async function profileData(session: Session): Promise<ProfileData> {
  if (!session.uid) throw new Error('Sign in with Discord to see your profile.');
  const [claims, raids, me, users, list] = await Promise.all([
    claimsFor(session.uid).catch(() => []),
    raidCodes(),
    membership(session.uid, session.gid).catch(() => null),
    rest(`site_users?discord_id=eq.${encodeURIComponent(session.uid)}&select=first_seen,sign_ins,rank,display_name`).catch(() => []),
    listRaids().catch(() => ({ raids: [] as SavedRaid[] })),
  ]);
  // Each raid's stored summaries, read once and shared by all of this person's characters
  const fightsByCode = new Map<string, Promise<FightDigest[]>>();
  const fightsOf = (code: string) => {
    if (!fightsByCode.has(code)) fightsByCode.set(code, storedDigests(code).catch(() => []));
    return fightsByCode.get(code)!;
  };
  const cards = list.raids.filter((r) => r.startTime && r.card);
  const recent8 = cards.filter((r) => Date.now() - new Date(r.startTime!).getTime() <= 8 * WEEK);

  const characters = await Promise.all(claims.map(async (c): Promise<ProfileCharacter> => {
    const key = c.character.toLowerCase();
    const inCard = (r: SavedRaid) => r.card!.raiders.find((p) => p.name.toLowerCase() === key);
    const fromCard = cards.map(inCard).find(Boolean);
    const base: ProfileCharacter = {
      name: c.character, realm: c.realm, status: c.status,
      className: fromCard?.className ?? null, specName: fromCard?.specName ?? null, role: fromCard?.role ?? null,
      level: null, itemLevel: null, healer: fromCard?.role === 'healer',
      attendance: { attended: recent8.filter(inCard).length, of: recent8.length },
      raidsAttended: cards.filter(inCard).length,
      lastRaid: null, stats: [],
      trend: await trendFor(c.character).catch(() => []),
    };
    // The most recent raid this character was in, from the bot's summaries
    for (const r of raids) {
      const fights = await fightsOf(r.code);
      const rows = fights
        .map((f) => ({ f, p: f.players.find((p) => p.name.toLowerCase() === key && (!c.realm || !p.server || p.server.toLowerCase() === c.realm.toLowerCase())) }))
        .filter((x): x is { f: FightDigest; p: PlayerDigest } => !!x.p);
      if (!rows.length) continue;
      const last = rows.at(-1)!.p;
      const healer = rows.filter((x) => healsMost(x.p)).length * 2 > rows.length;
      const parseOf = (p: PlayerDigest) => (healer ? p.healing?.parse ?? null : p.parse);
      const parses = rows.map((x) => parseOf(x.p)).filter((v): v is number => v !== null);
      const best = [...rows].sort((a, b) => (parseOf(b.p) ?? -1) - (parseOf(a.p) ?? -1))[0];
      const seconds = rows.reduce((t, x) => t + x.f.seconds, 0) || 1;
      const realm = c.realm || last.server;
      const region = realm ? await reportRegion(r.host, r.code).catch(() => null) : null;
      const level = region && realm ? await characterLevel(region, realm, c.character).catch(() => null) : null;
      const withStats = [...rows].reverse().find((x) => x.p.stats?.length)?.p;
      return {
        ...base,
        realm: c.realm ?? last.server ?? null,
        className: last.className || base.className,
        specName: last.specName || base.specName,
        role: last.role ?? base.role,
        healer,
        level,
        itemLevel: last.itemLevel,
        stats: withStats?.stats?.slice(0, 8) ?? [],
        lastRaid: {
          host: r.host, code: r.code, title: r.title, date: r.date,
          bosses: rows.length,
          avgParse: parses.length ? Math.round(parses.reduce((t, v) => t + v, 0) / parses.length) : null,
          perSecond: healer ? rows.reduce((t, x) => t + (x.p.healing?.total ?? 0), 0) / seconds : rows.reduce((t, x) => t + x.p.total, 0) / seconds,
          deaths: rows.reduce((t, x) => t + x.p.deaths.length, 0),
          best: { fightId: best.f.id, playerId: best.p.id, boss: best.f.name, parse: parseOf(best.p) },
        },
      };
    }
    return base;
  }));

  return {
    name: users?.[0]?.display_name || session.name || 'You',
    rank: effectiveRank(session.uid, users?.[0]?.rank, me ? discordRank(me) : session.officer ? 'officer' : 'raider'),
    avatar: session.avatar ? `https://cdn.discordapp.com/avatars/${session.uid}/${session.avatar}.png?size=128` : null,
    officer: me?.officer ?? session.officer,
    server: me?.guildName ?? null,
    firstSeen: users?.[0]?.first_seen ?? null,
    signIns: users?.[0]?.sign_ins ?? null,
    characters,
  };
}
