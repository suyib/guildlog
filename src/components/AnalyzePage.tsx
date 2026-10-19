import { useState } from 'react';
import type { AnalysisResult, CompareChoice, ReportSummary } from '../../server/types';
import { loadReport, runAnalysis } from '../api';
import { mmss } from '../format';
import { classEmoji } from './emoji';
import ResultView from './ResultView';

// Dropdown values: "auto", "top", "previous", or "p:<playerId>"
function toChoice(value: string): CompareChoice {
  if (value === 'top') return { kind: 'top' };
  if (value === 'previous') return { kind: 'previous' };
  if (value.startsWith('p:')) return { kind: 'player', playerId: Number(value.slice(2)) };
  return { kind: 'auto' };
}

export default function AnalyzePage() {
  const [url, setUrl] = useState('');
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [fightId, setFightId] = useState<number | ''>('');
  const [playerId, setPlayerId] = useState<number | ''>('');
  const [compareWith, setCompareWith] = useState('auto');
  const [busy, setBusy] = useState<'report' | 'analysis' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const me = report?.players.find((p) => p.id === playerId);
  const chosen = compareWith.startsWith('p:') ? report?.players.find((p) => p.id === Number(compareWith.slice(2))) : undefined;
  const crossClass = !!(me && chosen && me.className !== chosen.className);

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
      setCompareWith('auto');
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
      const res = await runAnalysis({ host: report.host, code: report.code, fightId, playerId, compare: toChoice(compareWith) });
      setResult(res);
      if (res.id) history.replaceState(null, '', `/a/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card">
        <h1>🔍 Analyse a fight</h1>
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
          <button type="submit" disabled={busy !== null}>{busy === 'report' ? 'Loading…' : '📜 Load report'}</button>
        </form>

        {report && (
          <div className="pickers">
            <div className="muted small">{report.title}</div>
            <label>
              🐉 Fight
              <select value={fightId} onChange={(e) => setFightId(Number(e.target.value))}>
                <option value="" disabled>Choose a boss</option>
                {report.fights.map((f) => (
                  <option key={f.id} value={f.id}>{f.kill ? '✅' : '💀'} {f.name} ({mmss(f.seconds)})</option>
                ))}
              </select>
            </label>
            <label>
              🙋 Player
              <select value={playerId} onChange={(e) => setPlayerId(Number(e.target.value))}>
                <option value="" disabled>Choose a player</option>
                {report.players.map((p) => (
                  <option key={p.id} value={p.id}>{classEmoji(p.className)} {p.name} ({p.className})</option>
                ))}
              </select>
            </label>
            <label>
              ⚖️ Compare with
              <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
                <option value="auto">✨ Auto: best of my class, a top parse and my last kill</option>
                <option value="top">🏆 Top-ranked parse of my spec</option>
                <option value="previous">🕰️ My previous kill of this boss</option>
                <optgroup label="Someone in this raid">
                  {report.players
                    .filter((p) => p.id !== playerId)
                    .sort((a, b) => Number(b.className === me?.className) - Number(a.className === me?.className) || a.name.localeCompare(b.name))
                    .map((p) => (
                      <option key={p.id} value={`p:${p.id}`}>{classEmoji(p.className)} {p.name} ({p.className})</option>
                    ))}
                </optgroup>
              </select>
            </label>
            <button onClick={onAnalyse} disabled={busy !== null || fightId === '' || playerId === ''}>
              {busy === 'analysis' ? '⏳ Analysing…' : '🚀 Analyse'}
            </button>
            {crossClass && (
              <p className="warning">
                ⚠️ {chosen!.name} is a {chosen!.className} and you picked a {me!.className}. Only general things will be compared: DPS, parse,
                active time, item level, downtime, deaths, damage taken and shared buffs like Bloodlust. Rotation and cooldown comparisons are skipped.
              </p>
            )}
          </div>
        )}
        {error && <p className="error">❌ {error}</p>}
      </section>

      {result && <ResultView result={result} />}
    </>
  );
}
