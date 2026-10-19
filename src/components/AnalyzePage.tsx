import { useState } from 'react';
import type { AnalysisResult, ReportSummary } from '../../server/types';
import { loadReport, runAnalysis } from '../api';
import { mmss } from '../format';
import ResultView from './ResultView';

export default function AnalyzePage() {
  const [url, setUrl] = useState('');
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [fightId, setFightId] = useState<number | ''>('');
  const [playerId, setPlayerId] = useState<number | ''>('');
  const [busy, setBusy] = useState<'report' | 'analysis' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  async function onLoad(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy('report');
    try {
      const r = await loadReport(url);
      setReport(r);
      setFightId(r.suggestedFight ?? r.fights.at(-1)?.id ?? '');
      setPlayerId(r.suggestedPlayer ?? '');
    } catch (err) {
      setError((err as Error).message);
      setReport(null);
    } finally {
      setBusy(null);
    }
  }

  async function onAnalyse() {
    if (!report || fightId === '' || playerId === '') return;
    setError(null);
    setBusy('analysis');
    try {
      const res = await runAnalysis({ host: report.host, code: report.code, fightId, playerId });
      setResult(res);
      if (res.id) history.replaceState(null, '', `#/a/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card">
        <h1>Analyse a fight</h1>
        <p className="muted">Paste a Warcraft Logs report link. Links that already include a fight and player (&amp;fight=11&amp;source=28) fill in the choices for you.</p>
        <form onSubmit={onLoad} className="row">
          <input
            type="url"
            placeholder="https://fresh.warcraftlogs.com/reports/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            aria-label="Warcraft Logs report link"
          />
          <button type="submit" disabled={busy !== null}>{busy === 'report' ? 'Loading…' : 'Load report'}</button>
        </form>

        {report && (
          <div className="pickers">
            <div className="muted small">{report.title}</div>
            <label>
              Fight
              <select value={fightId} onChange={(e) => setFightId(Number(e.target.value))}>
                <option value="" disabled>Choose a boss</option>
                {report.fights.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} – {f.kill ? 'kill' : 'wipe'} ({mmss(f.seconds)})</option>
                ))}
              </select>
            </label>
            <label>
              Player
              <select value={playerId} onChange={(e) => setPlayerId(Number(e.target.value))}>
                <option value="" disabled>Choose a player</option>
                {report.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.className})</option>
                ))}
              </select>
            </label>
            <button onClick={onAnalyse} disabled={busy !== null || fightId === '' || playerId === ''}>
              {busy === 'analysis' ? 'Analysing… (up to a minute)' : 'Analyse'}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {result && <ResultView result={result} />}
    </>
  );
}
