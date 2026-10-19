import { useEffect, useState } from 'react';
import type { AnalysisResult, CompareChoice, ReportSummary } from '../../server/types';
import { type Progress, loadReport, runAnalysis } from '../api';
import { mmss } from '../format';
import ResultView from './ResultView';

// Dropdown values: "auto", "top", "previous", or "p:<playerId>"
function toChoice(value: string): CompareChoice {
  if (value === 'top') return { kind: 'top' };
  if (value === 'previous') return { kind: 'previous' };
  if (value.startsWith('p:')) return { kind: 'player', playerId: Number(value.slice(2)) };
  return { kind: 'auto' };
}

/** Turn a saved compare key back into a dropdown value, given the report's players. */
function keyToValue(key: string | undefined, report: ReportSummary): string {
  if (!key || key === 'auto') return 'auto';
  if (key === 'top' || key === 'previous') return key;
  if (key.startsWith('p:')) {
    const p = report.players.find((x) => x.name === key.slice(2));
    return p ? `p:${p.id}` : 'auto';
  }
  return 'auto';
}

/**
 * The analyze form. On a shared link (/a/<id>) it's given the saved result, so the person
 * opening the link sees the same report, fight and player selected and can change who to compare with.
 */
export default function AnalyzePage({ initial }: { initial?: AnalysisResult }) {
  const initialUrl = initial ? `https://${initial.player.host}/reports/${initial.player.reportCode}?fight=${initial.player.fightId}` : '';
  const [url, setUrl] = useState(initialUrl);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [fightId, setFightId] = useState<number | ''>('');
  const [playerId, setPlayerId] = useState<number | ''>('');
  const [compareWith, setCompareWith] = useState('auto');
  const [busy, setBusy] = useState<'report' | 'analysis' | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(initial ?? null);

  const me = report?.players.find((p) => p.id === playerId);
  const chosen = compareWith.startsWith('p:') ? report?.players.find((p) => p.id === Number(compareWith.slice(2))) : undefined;
  const crossClass = !!(me && chosen && me.className !== chosen.className);

  // Shared link: load the report behind it and pre-select the saved fight, player and comparison.
  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    setBusy('report');
    loadReport(initialUrl)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setFightId(initial.player.fightId);
        setPlayerId(r.players.find((p) => p.name === initial.player.name)?.id ?? '');
        setCompareWith(keyToValue(initial.compareKey, r));
      })
      .catch((err) => {
        // The saved analysis still shows even if Warcraft Logs has archived the report.
        if (!cancelled) setError(`Showing the saved analysis. The report couldn\u2019t be reloaded, so the choices can\u2019t be changed (${(err as Error).message}).`);
      })
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);

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

  async function onAnalyze() {
    const f = report?.fights.find((x) => x.id === fightId);
    if (!report || !f || !me) return;
    setError(null);
    setResult(null);
    setBusy('analysis');
    try {
      const res = await runAnalysis(
        {
          host: report.host,
          code: report.code,
          fight: { id: f.id, encounterID: f.encounterId, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: f.kill },
          actor: { id: me.id, name: me.name, className: me.className },
          compare: toChoice(compareWith),
          chosen: chosen ? { id: chosen.id, name: chosen.name, className: chosen.className } : undefined,
        },
        setProgress,
      );
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
      <section className="panel">
        <h1>{initial ? 'Shared analysis' : 'Analyze a fight'}</h1>
        <p className="muted">
          {initial
            ? 'Change the fight, player or who to compare with and click Analyze to make a new comparison. The shared one stays as it is.'
            : 'Paste a Warcraft Logs report link. Links that already include a fight and player (&fight=11&source=28) fill in the choices for you.'}
        </p>
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
                  <option key={f.id} value={f.id}>{f.name} – {f.kill ? 'Kill' : 'Wipe'} ({mmss(f.seconds)})</option>
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
            <label>
              Compare with
              <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
                <option value="auto">Auto: best of my class, a top parse and my last kill</option>
                <option value="top">Top-ranked parse of my spec</option>
                <option value="previous">My previous kill of this boss</option>
                <optgroup label="Someone in this raid">
                  {report.players
                    .filter((p) => p.id !== playerId)
                    .sort((a, b) => Number(b.className === me?.className) - Number(a.className === me?.className) || a.name.localeCompare(b.name))
                    .map((p) => (
                      <option key={p.id} value={`p:${p.id}`}>{p.name} ({p.className})</option>
                    ))}
                </optgroup>
              </select>
            </label>
            <button onClick={onAnalyze} disabled={busy !== null || fightId === '' || playerId === ''}>
              {busy === 'analysis' ? 'Analyzing…' : 'Analyze'}
            </button>
            {crossClass && (
              <p className="warning">
                <strong>Different class.</strong> {chosen!.name} is a {chosen!.className} and you picked a {me!.className}. Only general stats will be
                compared: DPS, parse, active time, item level, downtime, deaths, damage taken and shared buffs like Bloodlust. Rotation and cooldown
                comparisons are skipped.
              </p>
            )}
          </div>
        )}

        {busy === 'analysis' && progress.length > 0 && (
          <ul className="progress">
            {progress.map((p, i) => (
              <li key={i} className={`progress-${p.state}`}>
                <span className="progress-mark" aria-hidden="true" />
                {p.label}
                <span className="muted small">{p.state === 'loading' ? 'loading…' : `${p.state === 'done' ? 'done' : 'failed'}${p.seconds !== undefined ? ` in ${p.seconds}s` : ''}`}</span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {result && <ResultView result={result} />}
    </>
  );
}
