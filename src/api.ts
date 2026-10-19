import type {
  ActorRef,
  AnalysisResult,
  CompareChoice,
  Comparison,
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

export interface Progress { label: string; state: 'loading' | 'done' | 'failed' }

/**
 * Runs an analysis in small steps (each its own short request) so long fights don't time out:
 * your snapshot and the comparison targets load together, then each comparison loads in parallel,
 * then the server builds the findings and saves.
 */
export async function runAnalysis(
  p: { host: string; code: string; fight: FightRef; actor: ActorRef; compare: CompareChoice; chosen?: ActorRef },
  onProgress: (items: Progress[]) => void,
): Promise<AnalysisResult> {
  const progress: Progress[] = [{ label: p.actor.name, state: 'loading' }, { label: 'Finding comparisons', state: 'loading' }];
  const update = () => onProgress(progress.map((x) => ({ ...x })));
  update();

  const notes: string[] = [];
  const mePromise = post<PlayerSnapshot>('/api/snapshot', { host: p.host, code: p.code, fight: p.fight, actor: p.actor }).then(
    (s) => { progress[0].state = 'done'; update(); return s; },
    (e) => { progress[0].state = 'failed'; update(); throw e; },
  );

  let targets: SnapshotTarget[] = [];
  if (p.compare.kind === 'player' && p.chosen) {
    targets = [{
      kind: 'chosen-player',
      label: `${p.chosen.name} (${p.chosen.className}, same raid)`,
      host: p.host,
      code: p.code,
      fight: p.fight,
      actor: p.chosen,
      sameClass: p.chosen.className === p.actor.className,
    }];
    progress[1].state = 'done';
  } else {
    try {
      const t = await post<{ targets: SnapshotTarget[]; notes: string[] }>('/api/targets', { host: p.host, code: p.code, fight: p.fight, actor: p.actor, compare: p.compare });
      targets = t.targets;
      notes.push(...t.notes);
      progress[1].state = 'done';
    } catch (e) {
      notes.push(`Couldn’t find comparisons: ${(e as Error).message}`);
      progress[1].state = 'failed';
    }
  }
  update();

  const base = progress.length;
  targets.forEach((t) => progress.push({ label: t.actor.name, state: 'loading' }));
  update();

  const settled = await Promise.allSettled(
    targets.map((t, i) =>
      post<PlayerSnapshot>('/api/snapshot', { host: t.host, code: t.code, fight: t.fight, actor: t.actor }).then(
        (snapshot): Comparison => { progress[base + i].state = 'done'; update(); return { kind: t.kind, label: t.label, snapshot, sameClass: t.sameClass }; },
        (e) => { progress[base + i].state = 'failed'; update(); throw e; },
      ),
    ),
  );
  const comparisons: Comparison[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') comparisons.push(s.value);
    else notes.push(`Couldn’t load ${targets[i].actor.name}: ${(s.reason as Error).message}`);
  });

  const player = await mePromise;
  const compareKey = p.compare.kind === 'player' ? `p:${p.chosen?.name ?? ''}` : p.compare.kind;
  progress.push({ label: 'Building summary', state: 'loading' });
  update();
  const result = await post<AnalysisResult>('/api/finish', { player, comparisons, compareKey, notes });
  progress[progress.length - 1].state = 'done';
  update();
  return result;
}
