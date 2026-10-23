// Past raids: which of the guild's raids are kept, and storing each one a fight at a time.
//
// A raid is added by /raidend, by "Add a past raid" on the site, or (optionally) picked up from
// the guild's uploads on Warcraft Logs. The every-5-minutes job then reads each boss kill once and
// stores it whole (see pack.ts); every analysis, breakdown and Discord DM is worked out from that.
// One run does what fits in its time limit and the next carries on.
import { forgetKills, recordKills } from './benchmarks.js';
import { dbEnabled, rest } from './db.js';
import type { FightDigest } from './discord/digest.js';
import { GAME } from './game.js';
import { digestRows, getMeta, getPack, readPack, storedDigests, trimPack } from './pack.js';
import { raidFeedback } from './raidFeedback.js';
import type { FightRef, RaidCard, RaidCheck, RaidsList, SavedRaid } from './types.js';
import { type ReportMeta, WclTimeout, gql } from './wcl.js';

const q = encodeURIComponent;

/** How long each fight is kept whole (every event). After that only its tables and summary stay. */
export const archiveDays = () => Math.max(7, Number(process.env.ARCHIVE_DAYS) || 90);
/** Give up on pieces that keep failing after this many runs (the raid is then marked "partial"). */
const MAX_RUNS = 40;

interface RaidRow {
  report_code: string;
  host: string;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  logger_name: string | null;
  source: SavedRaid['source'];
  status: SavedRaid['status'];
  saved: number;
  total: number;
  runs: number;
  card: RaidCard | null;
}

const toSaved = (r: RaidRow): SavedRaid => ({
  code: r.report_code,
  host: r.host,
  title: r.title,
  startTime: r.start_time,
  endTime: r.end_time,
  loggerName: r.logger_name,
  source: r.source,
  status: r.status,
  saved: r.saved,
  total: r.total,
  card: r.card,
});

async function patchRaid(code: string, fields: Partial<RaidRow>) {
  await rest(`guild_raids?report_code=eq.${q(code)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

/** Add a raid to Past raids (or update who logged it). Existing raids keep what's already saved. */
export async function registerRaid(r: { host: string; code: string; source: SavedRaid['source']; loggerName?: string | null; addedBy?: string | null }): Promise<SavedRaid> {
  if (!dbEnabled()) throw new Error('Saving raids needs the database (Supabase) to be set up.');
  if (!GAME.hosts.includes(r.host)) throw new Error(`Only ${GAME.name} logs can be saved.`);
  const existing: RaidRow | undefined = (await rest(`guild_raids?report_code=eq.${q(r.code)}`))?.[0];
  if (existing) {
    if (r.loggerName && !existing.logger_name) await patchRaid(r.code, { logger_name: r.loggerName });
    // A raid that couldn't be finished gets another go when it's added again
    if (existing.status === 'partial') await patchRaid(r.code, { status: 'saving', runs: 0 });
    return toSaved({ ...existing, logger_name: existing.logger_name ?? r.loggerName ?? null });
  }
  const rows: RaidRow[] = await rest('guild_raids', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ report_code: r.code, host: r.host, source: r.source, logger_name: r.loggerName ?? null, added_by: r.addedBy ?? null, status: 'queued' }),
  });
  return toSaved(rows[0]);
}

/** Every raid for the Past raids page, newest first (raids with no boss fights are left out). */
export async function listRaids(): Promise<RaidsList> {
  const rows: RaidRow[] = (await rest('guild_raids?status=neq.empty&order=start_time.desc.nullsfirst&limit=500')) ?? [];
  return { raids: rows.map(toSaved), archiveDays: archiveDays() };
}

// ---------- The raid card ----------

/** One raid night at a glance: bosses, wipes, deaths, who was there, and what went well. */
export function buildCard(meta: ReportMeta, digests: FightDigest[]): RaidCard {
  const bossFights = meta.fights.filter((f) => f.encounterID > 0);
  const encounterIds = [...new Set(bossFights.map((f) => f.encounterID))];
  const bosses = encounterIds.map((id) => {
    const tries = bossFights.filter((f) => f.encounterID === id);
    const kill = tries.find((f) => f.kill);
    return {
      name: tries[0].name,
      encounterId: id,
      fightId: kill?.id ?? null,
      kill: !!kill,
      seconds: kill ? Math.round((kill.endTime - kill.startTime) / 1000) : null,
      wipes: tries.filter((f) => !f.kill).length,
    };
  });
  const kills = bossFights.filter((f) => f.kill);
  // Attendance: anyone in a boss fight, from the fight's own player list
  const actors = new Map(meta.masterData.actors.filter((a) => a.type === 'Player').map((a) => [a.id, a]));
  const present = new Map<number, number>();
  for (const f of bossFights) for (const id of f.friendlyPlayers ?? []) present.set(id, (present.get(id) ?? 0) + (f.kill ? 1 : 0));
  for (const d of digests) for (const p of d.players) if (!present.has(p.id)) present.set(p.id, 1); // no player list in the log
  const fromDigest = new Map(digests.flatMap((d) => d.players.map((p) => [p.name, p] as const)));
  const raiders = [...present]
    .map(([id, bossCount]) => {
      const a = actors.get(id);
      const name = a?.name ?? digests.flatMap((d) => d.players).find((p) => p.id === id)?.name;
      if (!name) return null;
      const p = fromDigest.get(name);
      return { name, className: p?.className ?? a?.subType ?? '', specName: p?.specName ?? '', role: p?.role ?? null, bosses: bossCount };
    })
    .filter((x): x is RaidCard['raiders'][number] => !!x && x.className !== 'Unknown')
    .sort((a, b) => a.name.localeCompare(b.name));
  const ilvls = digests.flatMap((d) => d.players.map((p) => p.itemLevel)).filter((v): v is number => !!v);
  const first = bossFights[0]?.startTime ?? 0;
  const last = bossFights.at(-1)?.endTime ?? 0;
  return {
    bosses,
    raidSeconds: Math.max(0, Math.round((last - first) / 1000)),
    wipes: bossFights.filter((f) => !f.kill).length,
    deaths: digests.reduce((t, d) => t + d.players.reduce((s, p) => s + p.deaths.length, 0), 0),
    avgItemLevel: ilvls.length ? Math.round((ilvls.reduce((t, v) => t + v, 0) / ilvls.length) * 10) / 10 : null,
    raiders,
    kills: kills.length,
    summarized: new Set(digests.map((d) => d.id)).size,
    // Feedback only once every kill is read, so a half-read raid isn't judged on part of it
    feedback: new Set(digests.map((d) => d.id)).size < kills.length ? { good: [], work: [] } : raidFeedback(digests, { wipes: bosses.filter((b) => b.wipes > 0).map((b) => ({ boss: b.name, count: b.wipes })) }),
  };
}

// ---------- Storing a raid, a fight at a time ----------

/** Warcraft Logs itself is down or overloaded: stop this run rather than fail every fight. */
const wclDown = (e: unknown) => e instanceof WclTimeout || /having trouble right now|API error 5\d\d|rejected the site/i.test((e as Error)?.message ?? '');

const killsOf = (meta: ReportMeta) => meta.fights.filter((f) => f.encounterID > 0 && f.kill);
const refOf = (f: ReportMeta['fights'][number]): FightRef => ({ id: f.id, encounterID: f.encounterID, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: !!f.kill });

async function saveRaid(raid: RaidRow, deadline: number): Promise<{ done: number; stop: boolean }> {
  const { host, report_code: code } = raid;
  let done = 0;

  // The report's fights and players come first (stored, so a finished log is only read once)
  let meta: ReportMeta;
  try {
    meta = (await getMeta(host, code, { timeoutMs: 20_000 })).meta;
  } catch (e) {
    await patchRaid(code, { runs: raid.runs + 1, ...(raid.runs + 1 >= MAX_RUNS ? { status: 'partial' } : {}) });
    return { done, stop: wclDown(e) };
  }
  if (!raid.title) {
    const end = meta.fights.at(-1)?.endTime ?? 0;
    await patchRaid(code, { title: meta.title, start_time: new Date(meta.startTime).toISOString(), end_time: new Date(meta.startTime + end).toISOString() });
  }
  if (!meta.fights.some((f) => f.encounterID > 0)) {
    await patchRaid(code, { status: 'empty' });
    return { done, stop: false };
  }
  const kills = killsOf(meta);
  // Put the raid on the calendar straight away (a long run can be cut off before the end)
  if (!raid.card) {
    raid.card = buildCard(meta, (await storedDigests(code).catch(() => [])).filter((d) => kills.some((k) => k.id === d.id)));
    await patchRaid(code, { card: raid.card, status: 'saving' });
  }

  // Each kill read whole while it's within the keep window, or just its tables after that
  const want = Date.now() - meta.startTime < archiveDays() * 86_400_000 ? 'full' : 'tables';
  const stages = new Map((await digestRows(code).catch(() => [])).map((r) => [r.fightId, r.stage]));
  const ready = (id: number) => stages.get(id) === 'full' || (want === 'tables' && stages.get(id) === 'tables');
  const todo = kills.filter((k) => !ready(k.id));

  // Two fights at a time, starting new ones only while there's time to finish them
  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && next < todo.length && Date.now() < deadline - 25_000) {
      const f = todo[next++];
      try {
        const pack = await getPack(host, code, refOf(f), want, deadline - 5_000);
        stages.set(f.id, pack.stage);
        if (ready(f.id)) done++;
      } catch (e) {
        if (wclDown(e)) stop = true;
        // otherwise left for the next run
      }
    }
  };
  await Promise.all([worker(), worker()]);

  const saved = 1 + kills.filter((k) => ready(k.id)).length;
  const missing = saved < kills.length + 1;
  // The card is filled in as each kill's summary is read: deaths, item level, roles and feedback
  const digests = (await storedDigests(code).catch(() => [])).filter((d) => kills.some((k) => k.id === d.id));
  const card = buildCard(meta, digests);
  // Everyone's numbers per kill, for guild benchmarks and trends
  await recordKills(code, meta, digests).catch((e) => console.error('couldn\u2019t record kills', e));
  const runs = raid.runs + 1;
  await patchRaid(code, {
    saved,
    total: kills.length + 1,
    runs,
    card,
    status: !missing ? 'saved' : runs >= MAX_RUNS ? 'partial' : 'saving',
  });
  return { done, stop };
}

/**
 * One run of the saving job: works through raids that aren't fully saved, newest first, until the
 * time runs out. Returns what it did, for the job's reply.
 */
export async function archiveTick(deadline: number): Promise<{ saved: number; finished: string[] }> {
  if (!dbEnabled()) return { saved: 0, finished: [] };
  await pickupGuildReports().catch(() => undefined);
  await pruneOld().catch(() => undefined);
  const raids: RaidRow[] = (await rest('guild_raids?status=in.(queued,saving)&order=start_time.desc.nullsfirst&limit=5').catch(() => [])) ?? [];
  let saved = 0;
  const finished: string[] = [];
  for (const raid of raids) {
    if (Date.now() > deadline - 25_000) break;
    const r = await saveRaid(raid, deadline);
    saved += r.done;
    const after: RaidRow | undefined = (await rest(`guild_raids?report_code=eq.${q(raid.report_code)}&select=status,title`).catch(() => null))?.[0];
    if (after?.status === 'saved') finished.push(after.title ?? raid.report_code);
    if (r.stop) break; // Warcraft Logs is down: try again next run
  }
  return { saved, finished };
}

/** Update a saved raid's card from fresh summaries (used by the whole-night view). No-op for raids not on Past raids. */
export async function refreshCard(code: string, meta: ReportMeta, digests: FightDigest[]) {
  if (!dbEnabled()) return;
  const raid: { card: RaidCard | null } | undefined = (await rest(`guild_raids?report_code=eq.${q(code)}&select=card`).catch(() => null))?.[0];
  if (!raid) return;
  const card = buildCard(meta, digests);
  if ((raid.card?.summarized ?? -1) > (card.summarized ?? 0)) return; // the saved one already knows more
  await patchRaid(code, { card });
}

/**
 * Remove a raid completely: its Past raids entry, every stored fight and the report's fight list,
 * saved analyses of it, and the bot's record once the raid has ended. Added again later, it's read
 * from Warcraft Logs as if it were new. Returns the title, for the activity log.
 */
export async function deleteRaid(code: string): Promise<string | null> {
  if (!dbEnabled()) throw new Error('Past raids need the database (Supabase) to be set up.');
  const row: { title: string | null } | undefined = (await rest(`guild_raids?report_code=eq.${q(code)}&select=title`))?.[0];
  if (!row) throw new Error('That raid isn\u2019t on Past raids.');
  const gone = { method: 'DELETE', headers: { Prefer: 'return=minimal' } };
  await rest(`guild_raids?report_code=eq.${q(code)}`, gone);
  await Promise.all([
    forgetFights(code),
    rest(`analyses?report_code=eq.${q(code)}`, gone),
    forgetKills(code),
    // A raid still in progress keeps its /raidstart record, so /raidend still works
    rest(`bot_raids?report_code=eq.${q(code)}&ended_at=not.is.null`, gone),
  ]);
  return row.title;
}

/** Every stored fight of a report, and its fight list. */
export async function forgetFights(code: string) {
  await rest(`fight_packs?report_code=eq.${q(code)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/** What's stored for a raid and why something might be missing (officers, from the raid's card). */
export async function checkRaid(code: string, host?: string): Promise<RaidCheck> {
  if (!dbEnabled()) throw new Error('Past raids need the database (Supabase) to be set up.');
  const raid: RaidRow | undefined = (await rest(`guild_raids?report_code=eq.${q(code)}`))?.[0];
  const metaRow: { stage: string; digest: ReportMeta } | undefined = (await rest(`fight_packs?report_code=eq.${q(code)}&fight_id=eq.0&select=stage,digest`))?.[0];
  const stages = new Map((await digestRows(code).catch(() => [])).map((r) => [r.fightId, r.stage]));
  const meta = metaRow?.digest ?? (raid || host ? (await getMeta(raid?.host ?? host!, code).catch(() => null))?.meta : null) ?? null;
  const kills = meta ? killsOf(meta) : [];
  const benchmarkRows: number | null = await rest(`kill_stats?report_code=eq.${q(code)}&select=fight_id`).then((r: any[]) => r?.length ?? 0).catch(() => null);
  const killRows: RaidCheck['kills'] = [];
  for (const k of kills) {
    const pack = stages.has(k.id) ? await readPack(code, k.id).catch(() => null) : null;
    const players = Object.values(pack?.full?.players ?? {});
    killRows.push({
      fightId: k.id,
      boss: k.name,
      stage: stages.get(k.id) ?? null,
      players: players.length,
      withMana: players.filter((p) => p.mana?.some((v) => v >= 0)).length,
      tanksWithSwings: players.filter((p) => p.mit).length,
      withDots: players.filter((p) => p.dots?.length).length,
      withPotionData: players.filter((p) => p.casts.length).length,
      problem: pack?.fullError ?? (stages.get(k.id) === 'legacy' ? 'Kept from before v0.23.0: it will be read again.' : null),
    });
  }
  const advice: string[] = [];
  if (!raid) advice.push('This log isn\u2019t on Past raids. Add it on the Past raids page (or end it with /raidend) to keep it and add it to the guild benchmarks.');
  else if (raid.status === 'queued' || raid.status === 'saving') advice.push('Still being read. Press Read now to carry on straight away instead of waiting for the 5-minute job.');
  if (raid && !raid.start_time) advice.push('Not on the calendar yet: its report hasn\u2019t been read. Read now fixes that, and if it keeps happening, check the 5-minute job (?task=reminders) is still running.');
  if (killRows.some((k) => k.stage === 'tables')) advice.push('Some kills only have their summary tables so far. Read now tries the full read again.');
  if (killRows.some((k) => k.stage === 'full' && k.players && !k.withMana)) advice.push('Nobody has mana on a fully read kill: Warcraft Logs didn\u2019t send mana with the casts for this log.');
  if (killRows.some((k) => k.stage === 'full' && !k.tanksWithSwings)) advice.push('No boss melee swings were found on a fully read kill, so tank dodges and parries can\u2019t be shown for it.');
  if (benchmarkRows === null) advice.push('The kill_stats table is missing: run supabase/migrate-0.23.sql in Supabase.');
  else if (raid && !benchmarkRows && kills.length) advice.push('Not in the guild benchmarks yet: they\u2019re added when the raid is read (Read now).');
  return {
    code,
    title: raid?.title ?? meta?.title ?? null,
    status: raid?.status ?? null,
    saved: raid?.saved ?? 0,
    total: raid?.total ?? 0,
    runs: raid?.runs ?? 0,
    onCalendar: !!raid?.start_time && raid.status !== 'empty',
    hasCard: !!raid?.card,
    report: metaRow ? (metaRow.stage === 'meta-final' ? 'finished' : 'live') : 'not stored',
    kills: killRows,
    benchmarkRows,
    advice,
  };
}

/** Read a raid again from the start: its stored fights and benchmarks go, and it's queued like a new raid. */
export async function rereadRaid(code: string) {
  await Promise.all([forgetFights(code), forgetKills(code)]);
  await patchRaid(code, { status: 'queued', runs: 0, saved: 0, card: null, title: null, start_time: null, end_time: null });
}

/** True while a raid is on Past raids. */
export async function isListed(code: string): Promise<boolean> {
  return !!(await rest(`guild_raids?report_code=eq.${q(code)}&select=report_code`))?.[0];
}

/** Save one raid straight away (used right after it's added), within the time given. */
export async function archiveNow(code: string, deadline: number) {
  const raid: RaidRow | undefined = (await rest(`guild_raids?report_code=eq.${q(code)}`))?.[0];
  if (raid && (raid.status === 'queued' || raid.status === 'saving')) await saveRaid(raid, deadline);
}

/**
 * Keep the database lean, once an hour (the job runs every 5 minutes):
 *  - fights from logs that aren't on Past raids (other guilds' logs used for comparisons) go after a week
 *  - Past raids older than the keep window keep only each fight's tables and summary
 */
async function pruneOld() {
  if (new Date().getUTCMinutes() >= 5) return;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const old: { report_code: string }[] = (await rest(`fight_packs?updated_at=lt.${q(weekAgo)}&select=report_code&limit=2000`)) ?? [];
  const codes = [...new Set(old.map((r) => r.report_code))];
  if (codes.length) {
    const list = codes.map((c) => q(c)).join(',');
    const [kept, bot]: { report_code: string }[][] = await Promise.all([
      rest(`guild_raids?report_code=in.(${list})&select=report_code`),
      rest(`bot_raids?report_code=in.(${list})&select=report_code`),
    ]);
    const keep = new Set([...(kept ?? []), ...(bot ?? [])].map((r) => r.report_code));
    const drop = codes.filter((c) => !keep.has(c));
    if (drop.length) await rest(`fight_packs?report_code=in.(${drop.map((c) => q(c)).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
  const before = new Date(Date.now() - archiveDays() * 86_400_000).toISOString();
  const aged: { report_code: string }[] = (await rest(`guild_raids?start_time=lt.${q(before)}&select=report_code`)) ?? [];
  if (!aged.length) return;
  const full: { report_code: string; fight_id: number }[] =
    (await rest(`fight_packs?report_code=in.(${aged.map((r) => q(r.report_code)).join(',')})&stage=eq.full&select=report_code,fight_id&limit=20`)) ?? [];
  for (const f of full) await trimPack(f.report_code, f.fight_id).catch(() => undefined);
}

/**
 * Optional: add the guild's new uploads automatically (GUILD_NAME, GUILD_REALM and GUILD_REGION in
 * Vercel). Checked every few hours.
 */
async function pickupGuildReports() {
  const name = process.env.GUILD_NAME?.trim();
  const realm = process.env.GUILD_REALM?.trim();
  const region = process.env.GUILD_REGION?.trim().toLowerCase();
  if (!name || !realm || !region) return;
  const now = new Date();
  if (now.getUTCHours() % 3 !== 0 || now.getUTCMinutes() >= 5) return;
  const slug = realm.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const host = GAME.hosts[0];
  const d = await gql<{ reportData: { reports: { data: { code: string }[] } } }>(
    host,
    'query($n:String!,$s:String!,$r:String!){reportData{reports(guildName:$n,guildServerSlug:$s,guildServerRegion:$r,limit:10){data{code}}}}',
    { n: name, s: slug, r: region },
    15_000,
  );
  for (const r of d.reportData.reports.data ?? []) await registerRaid({ host, code: r.code, source: 'auto' }).catch(() => undefined);
}
