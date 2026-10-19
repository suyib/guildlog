import type { AnalysisResult, HistoryRow, ReportSummary } from '../server/types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401) {
    window.location.reload(); // session expired: middleware shows the password page
    throw new Error('Signed out');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 504) throw new Error('The analysis timed out. Try again; if it keeps happening, check the function logs in Vercel.');
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const loadReport = (url: string) => call<ReportSummary>('/api/report', { method: 'POST', body: JSON.stringify({ url }) });

export const runAnalysis = (p: { host: string; code: string; fightId: number; playerId: number }) =>
  call<AnalysisResult>('/api/analyze', { method: 'POST', body: JSON.stringify(p) });

export const loadHistory = () => call<HistoryRow[]>('/api/history');

export const loadSaved = (id: string) => call<AnalysisResult>(`/api/history?id=${encodeURIComponent(id)}`);
