// Past raids: which of the guild's raids are kept, and saving each one in full a little at a time.
//
// A raid is added by /raidend, by "Add a past raid" on the site, or (optionally) picked up from
// the guild's uploads on Warcraft Logs. The every-5-minutes job then works through it: the report,
// each boss kill's whole-raid breakdown, and every player's analysis and gear. One run does what
// fits in its time limit and the next carries on, so a night is usually fully saved within an hour.
import { fightBreakdown } from './breakdown.js';
import { buildDashboard } from './dashboard.js';
import { dbEnabled, rest } from './db.js';
import type { FightDigest } from './discord/digest.js';
import { storedFights } from './discord/store.js';
import { GAME } from './game.js';
import { fightRows, snapshotOne } from './pipeline.js';
import { raidFeedback } from './raidFeedback.js';
import { type SavedKind, getSaved, putSaved, savedKey, savedKeys } from './saved.js';
import type { FightBreakdown, FightPlayerRow, FightRef, RaidCard, RaidsList, SavedRaid } from './types.js';
import { type ReportMeta, WclTimeout, getReportMeta, gql } from './wcl.js';

const q = encodeURIComponent;

/** How long full detail (every player's analysis) is kept. Summaries, breakdowns and raid cards stay. */
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
    feedback: raidFeedback(digests, { wipes: bosses.filter((b) => b.wipes > 0).map((b) => ({ boss: b.name, count: b.wipes })) }),
  };
}

// ---------- Saving a raid, a piece at a time ----------

type Piece = { kind: SavedKind; fightId: number; playerId: number; run: () => Promise<unknown> };

/** Warcraft Logs itself is down or overloaded: stop this run rather than fail every piece. */
const wclDown = (e: unknown) => e instanceof WclTimeout || /having trouble right now|API error 5\d\d|rejected the site/i.test((e as Error)?.message ?? '');

async function saveRaid(raid: RaidRow, deadline: number): Promise<{ done: number; stop: boolean }> {
  const { host, report_code: code } = raid;
  const have = await savedKeys(code);
  let done = 0;

  // The report's fights and players come first: everything else is planned from them
  let meta = (await getSaved<ReportMeta>(code, 'meta'))?.data ?? null;
  if (!meta) {
    try {
      meta = await getReportMeta(host, code, 20_000);
    } catch (e) {
      await patchRaid(code, { runs: raid.runs + 1, ...(raid.runs + 1 >= MAX_RUNS ? { status: 'partial' } : {}) });
      return { done, stop: wclDown(e) };
    }
    await putSaved(code, 'meta', meta);
    have.add(savedKey('meta'));
    done++;
    const end = meta.fights.at(-1)?.endTime ?? 0;
    await patchRaid(code, {
      title: meta.title,
      start_time: new Date(meta.startTime).toISOString(),
      end_time: new Date(meta.startTime + end).toISOString(),
    });
  }
  const kills = meta.fights.filter((f) => f.encounterID > 0 && f.kill);
  if (!meta.fights.some((f) => f.encounterID > 0)) {
    await patchRaid(code, { status: 'empty' });
    return { done, stop: false };
  }
  const refs: FightRef[] = kills.map((f) => ({ id: f.id, encounterID: f.encounterID, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: true }));
  const fullDetail = Date.now() - meta.startTime < archiveDays() * 86_400_000;

  // Breakdowns and fight rows for each kill, then each player's analysis and gear
  const pieces: Piece[] = [];
  const total = { n: 1 }; // pieces in the whole raid, for the progress shown on the page
  for (const ref of refs) {
    pieces.push({ kind: 'breakdown', fightId: ref.id, playerId: 0, run: () => fightBreakdown(host, code, ref) });
    total.n++;
    if (!fullDetail) continue; // older than the keep-full-detail window: summaries only
    pieces.push({ kind: 'rows', fightId: ref.id, playerId: 0, run: () => fightRows(host, code, ref.id) });
    total.n++;
    const breakdown = (await getSaved<FightBreakdown>(code, 'breakdown', ref.id))?.data;
    if (!breakdown) {
      total.n += 2 * (meta.fights.find((f) => f.id === ref.id)?.friendlyPlayers?.length || 25); // an estimate until it's read
      continue;
    }
    const rows = (await getSaved<FightPlayerRow[]>(code, 'rows', ref.id))?.data ?? [];
    const seconds = (ref.endTime - ref.startTime) / 1000 || 1;
    for (const p of breakdown.players) {
      const actor = { id: p.id, name: p.name, className: p.className };
      const row = rows.find((r) => r.id === p.id || r.name === p.name);
      pieces.push({ kind: 'snapshot', fightId: ref.id, playerId: p.id, run: () => snapshotOne(host, code, ref, actor, row) });
      pieces.push({ kind: 'dashboard', fightId: ref.id, playerId: p.id, run: () => buildDashboard(host, code, ref.id, p.id, seconds, (row?.total ?? p.total) / seconds, ref.startTime, ref.endTime) });
      total.n += 2;
    }
  }
  const todo = pieces.filter((x) => !have.has(savedKey(x.kind, x.fightId, x.playerId)));

  // Two at a time, starting new pieces only while there's time to finish them
  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && next < todo.length && Date.now() < deadline - 25_000) {
      const piece = todo[next++];
      try {
        const data = await piece.run();
        await putSaved(code, piece.kind, data, piece.fightId, piece.playerId);
        have.add(savedKey(piece.kind, piece.fightId, piece.playerId));
        done++;
      } catch (e) {
        if (wclDown(e)) stop = true;
        // otherwise left for the next run
      }
    }
  };
  await Promise.all([worker(), worker()]);

  const saved = [savedKey('meta'), ...pieces.map((x) => savedKey(x.kind, x.fightId, x.playerId))].filter((k) => have.has(k)).length;
  const missing = pieces.some((x) => !have.has(savedKey(x.kind, x.fightId, x.playerId)));
  const allBreakdowns = refs.every((r) => have.has(savedKey('breakdown', r.id)));
  // The card is rebuilt once every kill's breakdown (and so its summary) is in
  let card = raid.card;
  if (allBreakdowns && (!card || !missing || done > 0)) {
    const digests = (await storedFights(code).catch(() => []))
      .map((s) => s.data as FightDigest)
      .filter((d) => (d.v ?? 0) >= 3 && kills.some((k) => k.id === d.id)); // any summary with roles will do for the card
    card = buildCard(meta, digests);
  }
  const runs = raid.runs + 1;
  await patchRaid(code, {
    saved,
    total: Math.max(saved, total.n),
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

/** Save one raid straight away (used right after it's added), within the time given. */
export async function archiveNow(code: string, deadline: number) {
  const raid: RaidRow | undefined = (await rest(`guild_raids?report_code=eq.${q(code)}`))?.[0];
  if (raid && (raid.status === 'queued' || raid.status === 'saving')) await saveRaid(raid, deadline);
}

/** Drop full detail for raids older than the keep window. Summaries and raid cards stay. */
async function pruneOld() {
  // Once an hour is plenty (the job runs every 5 minutes)
  if (new Date().getUTCMinutes() >= 5) return;
  const before = new Date(Date.now() - archiveDays() * 86_400_000).toISOString();
  const old: { report_code: string }[] = (await rest(`guild_raids?start_time=lt.${q(before)}&select=report_code`)) ?? [];
  for (const { report_code } of old) {
    await rest(`saved_data?report_code=eq.${q(report_code)}&kind=in.(rows,snapshot,dashboard)`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
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
