// The bot's pages on the site: "Your raid" (the five DM pages for one character in one raid) and the
// officers' Performance page (/performance and /check). Both are built by the same code as the
// bot's messages, so Discord and the site always say the same thing.
import { buildCard } from './archive.js';
import { LIMITS } from './coach.js';
import { dbEnabled, rest } from './db.js';
import { type FightDigest, raidDigest } from './discord/digest.js';
import { personalPages } from './discord/pages.js';
import { perfReport, type PerfRequest } from './discord/perfReport.js';
import { CAVEAT, perfHighlights, perfWatch } from './discord/performance.js';
import { claimOnCharacter, claimsFor } from './discord/store.js';
import { goalsFor } from './goals.js';
import type { PerformanceCharacter, PerformancePage, SiteEmbed, YourRaid } from './types.js';

const q = encodeURIComponent;
const plain = (e: { title?: string; description?: string; fields?: SiteEmbed['fields']; footer?: { text: string } }): SiteEmbed =>
  ({ title: e.title, description: e.description, fields: e.fields, footer: e.footer });

/**
 * One character's raid. `character` defaults to the person's first claimed character in the raid.
 * Their own characters only, unless `canLookup` (officers, raid leaders, loot council: like /check).
 */
export async function yourRaid(uid: string | null, canLookup: boolean, req: { host: string; code: string; character?: string | null }): Promise<YourRaid> {
  const claims = uid ? (await claimsFor(uid).catch(() => [])).filter((c) => c.status !== 'rejected') : [];
  const digest = await raidDigest(req.host, req.code, 30_000);
  const names = new Set(digest.fights.flatMap((f) => f.players.map((p) => p.name.toLowerCase())));
  const mineHere = claims.filter((c) => names.has(c.character.toLowerCase()));
  const wanted = req.character?.trim() || mineHere[0]?.character;
  if (!wanted) throw new Error(claims.length ? 'None of your characters was in this raid.' : 'Claim your character with /claim in Discord to see your raid here.');
  const own = claims.some((c) => c.character.toLowerCase() === wanted.toLowerCase());
  if (!own && !canLookup) throw new Error('You can only see your own characters. Officers, raid leaders and loot council can look anyone up.');
  const claim = claims.find((c) => c.character.toLowerCase() === wanted.toLowerCase());
  const built = personalPages(digest, wanted, claim?.realm ?? null);
  if (!built) throw new Error(`${wanted} isn’t in any boss kill read for this raid yet.`);
  const { rows, healer, pages } = built;
  const me = rows[0].p;

  const bosses = rows.map(({ fight, p }) => ({
    fightId: fight.id,
    playerId: p.id,
    name: fight.name,
    encounterId: fight.encounterID,
    seconds: fight.seconds,
    parse: healer ? p.healing?.parse ?? null : p.parse,
    perSecond: healer ? p.healing?.hps ?? 0 : p.dps,
    activePct: healer ? p.healing?.activePct ?? null : p.activePct,
    deaths: p.deaths.length,
    consumes: p.consumes ?? null,
    potion: p.potions ? p.potions.used.length > 0 || p.potions.prePot : null,
  }));

  return {
    host: digest.host,
    code: digest.code,
    title: digest.meta.title,
    startTime: digest.meta.startTime,
    zone: digest.meta.zone ?? null,
    card: buildCard(digest.meta, digest.fights),
    character: me.name,
    className: me.className,
    specName: me.specName,
    role: me.role,
    healer,
    itemLevel: [...rows].reverse().find((r) => r.p.itemLevel)?.p.itemLevel ?? null,
    others: own ? mineHere.map((c) => c.character).filter((c) => c.toLowerCase() !== me.name.toLowerCase()) : [],
    lookingAtSomeoneElse: !own,
    pages: { summary: plain(pages.summary), rotation: plain(pages.rotation), damage: plain(pages.damage), gear: plain(pages.gear), survival: plain(pages.survival) },
    bosses,
    vsLast: await vsLastRaid(me.name, digest.code, healer).catch(() => null),
    goals: own && uid ? (await goalsFor(uid).catch(() => [])).filter((g) => g.character.toLowerCase() === me.name.toLowerCase()) : [],
    pending: digest.pending,
  };
}

/** This raid against the character's raid before it, from the guild's kills. */
async function vsLastRaid(name: string, code: string, healer: boolean): Promise<YourRaid['vsLast']> {
  if (!dbEnabled()) return null;
  const rows: { report_code: string; start_time: string; parse: number | null; hps_parse: number | null; dps: number; hps: number }[] =
    (await rest(`kill_stats?name_key=eq.${q(name.toLowerCase())}&select=report_code,start_time,parse,hps_parse,dps,hps&order=start_time.desc&limit=300`)) ?? [];
  const byRaid = new Map<string, typeof rows>();
  for (const r of rows) byRaid.set(r.report_code, [...(byRaid.get(r.report_code) ?? []), r]);
  const codes = [...byRaid.keys()];
  const at = codes.indexOf(code);
  if (at < 0 || at + 1 >= codes.length) return null;
  const prev = codes[at + 1];
  const sum = (list: typeof rows) => {
    const ps = list.map((r) => (healer ? r.hps_parse : r.parse)).filter((v): v is number => v !== null).map(Number);
    return { parse: ps.length ? Math.round(ps.reduce((t, v) => t + v, 0) / ps.length) : null, perSecond: Math.round(list.reduce((t, r) => t + Number(healer ? r.hps : r.dps), 0) / list.length) };
  };
  const now = sum(byRaid.get(code)!);
  const then = sum(byRaid.get(prev)!);
  const title: string | null = (await rest(`guild_raids?report_code=eq.${q(prev)}&select=title`).catch(() => null))?.[0]?.title ?? null;
  return { title, date: byRaid.get(prev)![0].start_time, parse: then.parse, perSecond: then.perSecond, parseNow: now.parse, perSecondNow: now.perSecond };
}

/** The Performance page: everyone, from the same report as /performance. */
export async function performancePage(req: PerfRequest): Promise<PerformancePage> {
  const report = await perfReport({ ...req, character: null });
  const data = report.data!;
  // Active time and consumables need the fight summaries: the period's raids, read from storage
  let fights: FightDigest[] = report.fights;
  const codes = [...new Set(report.rows.map((r) => r.report_code))];
  if (!fights.length && codes.length) {
    const { storedDigests } = await import('./pack.js');
    fights = (await Promise.all(codes.slice(-12).map((c) => storedDigests(c).catch(() => [])))).flat();
  }
  const kills = fights.filter((f) => f.kill);
  const raidsOf = new Map<string, Set<string>>();
  for (const r of report.rows) raidsOf.set(r.name, (raidsOf.get(r.name) ?? new Set()).add(r.report_code));
  const classOf = new Map(report.rows.map((r) => [r.name, r.class_name]));
  const { high, low } = perfHighlights(data);
  return {
    label: report.scope.label,
    oneNight: report.scope.oneNight,
    minKills: report.scope.minKills,
    kills: data.kills,
    raids: data.raids,
    itemLevel: data.itemLevel,
    skipped: data.skipped,
    players: data.players.map((p) => {
      const mine = kills.flatMap((f) => f.players.filter((x) => x.name === p.name).map((x) => ({ f, x })));
      const healer = p.role === 'healer';
      const actives = mine.map(({ x }) => (healer ? x.healing?.activePct ?? null : x.activePct)).filter((v): v is number => v !== null);
      const judged = mine.filter(({ x }) => x.consumes || x.potions);
      const covered = judged.filter(({ f, x }) => {
        const flask = !x.consumes || x.consumes.flask || x.consumes.elixirs > 0;
        const pot = !x.potions || f.seconds < LIMITS.potionFight || x.potions.used.length > 0 || x.potions.prePot;
        return flask && pot;
      });
      return {
        ...p,
        className: classOf.get(p.name) ?? '',
        activePct: actives.length ? Math.round(actives.reduce((t, v) => t + v, 0) / actives.length) : null,
        consumesPct: judged.length ? Math.round((covered.length / judged.length) * 100) : null,
        attended: raidsOf.get(p.name)?.size ?? 0,
      };
    }),
    high: high.map((p) => p.name),
    low: low.map((x) => ({ name: x.p.name, why: x.why, help: x.help })),
    watch: perfWatch(report.scope, data),
    caveat: CAVEAT.text,
    pending: report.pending,
  };
}

/** One character on the Performance page: the same message /performance character: sends, plus who claimed them. */
export async function performanceCharacter(req: PerfRequest & { character: string }): Promise<PerformanceCharacter> {
  const report = await perfReport(req);
  const owner = await claimOnCharacter(req.character, null).catch(() => null);
  const note: string | null = owner ? (await rest(`site_users?discord_id=eq.${q(owner.discord_id)}&select=note`).catch(() => null))?.[0]?.note ?? null : null;
  const mine = report.rows.filter((r) => r.name.toLowerCase() === req.character.toLowerCase());
  const last = mine.at(-1)?.report_code ?? null;
  const host: string | null = last ? (await rest(`guild_raids?report_code=eq.${q(last)}&select=host`).catch(() => null))?.[0]?.host ?? req.raid?.host ?? null : null;
  return {
    embeds: (report.body.embeds ?? []).map(plain),
    claimedBy: owner ? `${owner.discord_name}${owner.status === 'pending' ? ' (waiting for approval)' : ''}` : null,
    note,
    latestRaid: last && host ? { host, code: last } : null,
  };
}

/** The report as a DM to the officer who asked (the "Send me this as a DM" button). */
export async function performanceDm(uid: string, req: PerfRequest): Promise<boolean> {
  const { sendDm } = await import('./discord/api.js');
  const report = await perfReport(req);
  return sendDm(uid, report.body);
}
