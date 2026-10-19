import type {
  ActorRef,
  AnalysisResult,
  CompareChoice,
  Comparison,
  Dashboard,
  FightPlayerRow,
  FightRef,
  HistoryRow,
  PlayerSnapshot,
  ReportSummary,
  SnapshotTarget,
} from '../server/types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401) {
    window.location.reload(); // session expired: middleware shows the password page
    throw new Error('Signed out');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 504) throw new Error('Warcraft Logs took too long to respond. Try again in a moment.');
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const loadReport = (url: string) => post<ReportSummary>('/api/report', { url });
export const loadHistory = () => call<HistoryRow[]>('/api/history');
export const loadSaved = (id: string) => call<AnalysisResult>(`/api/history?id=${encodeURIComponent(id)}`);

export interface Progress { label: string; state: 'loading' | 'done' | 'failed'; seconds?: number }

const portraitCache = new Map<string, Promise<string | null>>();
/** Character portrait URL from the Blizzard API (null when not set up or not found). */
export function loadPortrait(p: { host: string; reportCode: string; name: string; server?: string | null }): Promise<string | null> {
  if (!p.server) return Promise.resolve(null);
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
  p: { host: string; code: string; fight: FightRef; actor: ActorRef; compare: CompareChoice; chosen?: ActorRef },
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
  const rows = await step('Reading the fight', post<FightPlayerRow[]>('/api/fight', { host: p.host, code: p.code, fightId: p.fight.id }));
  const rowFor = (a: ActorRef) => rows.find((r) => r.id === a.id || r.name === a.name);
  const myRow = rowFor(p.actor);

  const snap = (t: { host: string; code: string; fight: FightRef; actor: ActorRef; row?: FightPlayerRow }) =>
    post<PlayerSnapshot>('/api/snapshot', { host: t.host, code: t.code, fight: t.fight, actor: t.actor, row: t.row });

  const mePromise = step(p.actor.name, snap({ host: p.host, code: p.code, fight: p.fight, actor: p.actor, row: myRow }));

  // "Just my stats": no comparisons, plus gear, stats and DPS over time
  if (p.compare.kind === 'none') {
    const fightSeconds = (p.fight.endTime - p.fight.startTime) / 1000;
    const dps = myRow && fightSeconds > 0 ? myRow.total / fightSeconds : 0;
    const dashboardPromise = step(
      'Gear, stats and DPS over time',
      post<Dashboard>('/api/dashboard', { host: p.host, code: p.code, fightId: p.fight.id, sourceId: p.actor.id, fightSeconds, dps }),
    ).catch((e) => {
      notes.push(`Couldn\u2019t load gear and stats: ${(e as Error).message}`);
      return undefined;
    });
    const [player, dashboard] = await Promise.all([mePromise, dashboardPromise]);
    return step('Building the summary', post<AnalysisResult>('/api/finish', { player, comparisons: [], compareKey: 'none', notes, dashboard }));
  }

  // Who to compare with
  const targets: SnapshotTarget[] = [];
  if (p.compare.kind === 'player' && p.chosen) {
    targets.push({
      kind: 'chosen-player',
      label: `${p.chosen.name} (${p.chosen.className}, same raid)`,
      host: p.host, code: p.code, fight: p.fight, actor: p.chosen,
      sameClass: p.chosen.className === p.actor.className,
      row: rowFor(p.chosen),
    });
  }
  if (p.compare.kind === 'auto') {
    rows
      .filter((r) => r.className === p.actor.className && r.name !== p.actor.name)
      .sort((a, b) => b.total - a.total)
      .slice(0, 2)
      .forEach((r) => targets.push({
        kind: 'same-report',
        label: `${r.name} (${r.className}, same raid)`,
        host: p.host, code: p.code, fight: p.fight,
        actor: { id: r.id, name: r.name, className: r.className },
        sameClass: true,
        row: r,
      }));
  }

  const comparisonJobs: Promise<Comparison | null>[] = targets.map((t) =>
    step(t.actor.name, snap(t)).then((snapshot) => ({ kind: t.kind, label: t.label, snapshot, sameClass: t.sameClass })),
  );

  if (p.compare.kind === 'auto' || p.compare.kind === 'top') {
    const me = { name: p.actor.name, className: myRow?.className ?? p.actor.className, specName: myRow?.specName ?? '' };
    comparisonJobs.push(
      step('Finding a top-ranked parse', post<{ target: SnapshotTarget | null }>('/api/top', { host: p.host, fight: p.fight, me })).then(async ({ target }) => {
        if (!target) return null;
        const snapshot = await step(target.actor.name, snap(target));
        return { kind: target.kind, label: target.label, snapshot, sameClass: target.sameClass };
      }),
    );
  }

  const settled = await Promise.allSettled(comparisonJobs);
  const comparisons: Comparison[] = [];
  settled.forEach((s) => {
    if (s.status === 'fulfilled' && s.value) comparisons.push(s.value);
    else if (s.status === 'rejected') notes.push(`Couldn\u2019t load a comparison: ${(s.reason as Error).message}`);
  });

  const player = await mePromise;
  const compareKey = p.compare.kind === 'player' ? `p:${p.chosen?.name ?? ''}` : p.compare.kind;
  return step('Building the summary', post<AnalysisResult>('/api/finish', { player, comparisons, compareKey, notes }));
}
