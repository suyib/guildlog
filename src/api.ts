import type {
  ActorRef,
  AnalysisResult,
  CompareChoice,
  Comparison,
  Dashboard,
  FightBreakdown,
  FightPlayerRow,
  FightRef,
  HistoryRow,
  PlayerSnapshot,
  AdminEdit,
  AdminOverview,
  Rank,
  HomeData,
  ProfileData,
  RaidCheck,
  RaidOverview,
  RaidsList,
  ReportSummary,
  SavedRaid,
  SnapshotTarget,
} from '../server/types';

/** Viewing a shared analysis without signing in: nothing else is asked for, and nothing reloads the page. */
let publicView = false;
export const setPublicView = (on: boolean) => {
  publicView = on;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401) {
    if (publicView) throw new Error('Sign in with Discord to do this.');
    window.location.reload(); // session expired: middleware shows the sign-in page
    throw new Error('Signed out');
  }
  const body = await res.json().catch(() => ({}));
  // Left the guild's Discord since signing in: signed out, with a page saying why
  if (res.status === 403 && body.notMember) {
    window.location.href = '/api/login?left=1';
    throw new Error(body.error);
  }
  if (res.status === 504) throw new Error('Warcraft Logs took too long to respond. Try again in a moment.');
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const loadReport = (url: string) => post<ReportSummary>('/api/report', { url });
/** Whole-raid breakdown of one fight, for when no player is chosen. */
export const loadBreakdown = (p: { host: string; code: string; fight: FightRef }) => post<FightBreakdown>('/api/fight', { ...p, breakdown: true });
/** The whole night: every boss kill and everyone's numbers. */
export const loadOverall = (p: { host: string; code: string }) => post<RaidOverview>('/api/fight', { ...p, overall: true });
export const loadHistory = () => call<HistoryRow[]>('/api/history');
export interface Me { signedIn: boolean; kind: 'discord' | 'password' | null; name: string | null; avatar: string | null; rank: Rank | null; officer: boolean; admin: boolean; discordLogin: boolean }
let mePromise: Promise<Me> | null = null;
/** Who's signed in (asked once per page load). */
export const loadMe = () => (mePromise ??= call<Me>('/api/login?me=1').catch(() => ({ signedIn: false, kind: null, name: null, avatar: null, rank: null, officer: false, admin: false, discordLogin: false })));
export const loadAdmin = () => call<AdminOverview>('/api/admin');
export const saveAdminEdit = (edit: AdminEdit) => post<{ ok: true; done: string }>('/api/admin', edit);

export const RANK_LABEL: Record<Rank, string> = { admin: 'Admin', guild_master: 'Guild master', officer: 'Officer', raider: 'Raider' };
export const loadHome = () => call<HomeData>('/api/raids?view=home');
export const loadProfile = () => call<ProfileData>('/api/raids?view=profile');
export const loadRaids = () => call<RaidsList>('/api/raids');
export const addRaid = (url: string) => post<SavedRaid>('/api/raids', { url });
export const deleteRaid = (code: string) => post<{ ok: true }>('/api/raids', { delete: code });
export const checkRaid = (code: string) => call<RaidCheck>(`/api/raids?view=check&code=${encodeURIComponent(code)}`);
export const readRaidNow = (code: string, fresh = false) => post<RaidCheck>('/api/raids', { read: code, fresh });
export const loadSaved = (id: string) => call<AnalysisResult>(`/api/history?id=${encodeURIComponent(id)}`);

export interface Progress { label: string; state: 'loading' | 'done' | 'failed'; seconds?: number }

const portraitCache = new Map<string, Promise<string | null>>();
/** Character portrait URL from the Blizzard API (null when not set up or not found). */
export function loadPortrait(p: { host: string; reportCode: string; name: string; server?: string | null }): Promise<string | null> {
  if (!p.server || publicView) return Promise.resolve(null);
  const key = `${p.host}|${p.reportCode}|${p.server}|${p.name}`;
  if (!portraitCache.has(key)) {
    const q = new URLSearchParams({ host: p.host, code: p.reportCode, name: p.name, server: p.server });
    portraitCache.set(key, call<{ url: string | null }>(`/api/portrait?${q}`).then((r) => r.url).catch(() => null));
  }
  return portraitCache.get(key)!;
}

/**
 * Runs an analysis as several short requests so long fights don't time out:
 *   1. the fight-wide table for everyone, once
 *   2. your snapshot and each comparison's snapshot, all in parallel
 *   3. the summary (findings + save)
 */
export async function runAnalysis(
  p: { host: string; code: string; fight: FightRef; actor: ActorRef; compare: CompareChoice; chosen?: ActorRef; otherLabel?: string },
  onProgress: (items: Progress[]) => void,
): Promise<AnalysisResult> {
  const progress: Progress[] = [];
  const update = () => onProgress(progress.map((x) => ({ ...x })));
  const step = <T,>(label: string, work: Promise<T>): Promise<T> => {
    const item: Progress = { label, state: 'loading' };
    const started = performance.now();
    const took = () => Math.round((performance.now() - started) / 100) / 10;
    progress.push(item);
    update();
    return work.then(
      (v) => { item.state = 'done'; item.seconds = took(); update(); return v; },
      (e) => { item.state = 'failed'; item.seconds = took(); update(); throw new Error(`${label}: ${(e as Error).message}`); },
    );
  };

  const notes: string[] = [];
  const rows = await step('Reading the fight', post<FightPlayerRow[]>('/api/fight', { host: p.host, code: p.code, fightId: p.fight.id, fight: p.fight }));
  const rowFor = (a: ActorRef) => rows.find((r) => r.id === a.id || r.name === a.name);
  const myRow = rowFor(p.actor);

  const snap = (t: { host: string; code: string; fight: FightRef; actor: ActorRef }) =>
    post<PlayerSnapshot>('/api/snapshot', { host: t.host, code: t.code, fight: t.fight, actor: t.actor });

  const mePromise = step(p.actor.name, snap({ host: p.host, code: p.code, fight: p.fight, actor: p.actor }));

  // Gear, stats and DPS over time load alongside, for every kind of analysis
  const dashboardPromise = step(
    'Gear, stats and DPS over time',
    post<Dashboard>('/api/dashboard', { host: p.host, code: p.code, fight: p.fight, sourceId: myRow?.id ?? p.actor.id }),
  ).catch((e) => {
    notes.push(`Couldn\u2019t load gear and stats: ${(e as Error).message}`);
    return undefined;
  });

  if (p.compare.kind === 'none') {
    const [player, dashboard] = await Promise.all([mePromise, dashboardPromise]);
    return step('Building the summary', post<AnalysisResult>('/api/finish', { player, comparisons: [], compareKey: 'none', notes, dashboard }));
  }

  // Who to compare with
  const targets: SnapshotTarget[] = [];
  const comparisonJobsPre: Promise<Comparison | null>[] = [];
  if (p.compare.kind === 'player' && p.chosen) {
    targets.push({
      kind: 'chosen-player',
      label: `${p.chosen.name} (${p.chosen.className}, same raid)`,
      host: p.host, code: p.code, fight: p.fight, actor: p.chosen,
      sameClass: p.chosen.className === p.actor.className,
    });
  }
  if (p.compare.kind === 'log') {
    const o = p.compare;
    const label = p.otherLabel ?? `${o.actor.name} (other log)`;
    // Read the other log's fight first so the comparison gets their parse and item level too
    comparisonJobsPre.push(
      step(`${o.actor.name}: reading the other log`, post<FightPlayerRow[]>('/api/fight', { host: o.host, code: o.code, fightId: o.fight.id, fight: o.fight }))
        .then((otherRows) => {
          const row = otherRows.find((r) => r.id === o.actor.id || r.name === o.actor.name);
          return step(o.actor.name, snap({ host: o.host, code: o.code, fight: o.fight, actor: row ? { ...o.actor, id: row.id } : o.actor }));
        })
        .then((snapshot) => ({ kind: 'other-log' as const, label, snapshot, sameClass: snapshot.className === p.actor.className })),
    );
  }
  const comparisonJobs: Promise<Comparison | null>[] = [...comparisonJobsPre, ...targets.map((t) =>
    step(t.actor.name, snap(t)).then((snapshot) => ({ kind: t.kind, label: t.label, snapshot, sameClass: t.sameClass })),
  )];

  const settled = await Promise.allSettled(comparisonJobs);
  const comparisons: Comparison[] = [];
  settled.forEach((s) => {
    if (s.status === 'fulfilled' && s.value) comparisons.push(s.value);
    else if (s.status === 'rejected') notes.push(`Couldn\u2019t load a comparison: ${(s.reason as Error).message}`);
  });

  const [player, dashboard] = await Promise.all([mePromise, dashboardPromise]);
  const compareKey =
    p.compare.kind === 'player' ? `p:${p.chosen?.name ?? ''}`
    : `l:${p.compare.host}:${p.compare.code}:${p.compare.fight.id}:${p.compare.actor.name}`;
  return step('Building the summary', post<AnalysisResult>('/api/finish', { player, comparisons, compareKey, notes, dashboard }));
}
