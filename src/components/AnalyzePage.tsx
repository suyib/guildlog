import { useEffect, useState } from 'react';
import type { AnalysisResult, CompareChoice, FightBreakdown, ReportSummary } from '../../server/types';
import { type Progress, loadBreakdown, loadReport, runAnalysis } from '../api';
import { mmss } from '../format';
import { useNav } from '../nav';
import Glyph from './Glyph';
import Breakdown from './Breakdown';
import ResultView from './ResultView';

// Compare dropdown values: "none", "p:<playerId>" (someone in this fight) or "log" (someone in another log).
type ReportPlayer = ReportSummary['players'][number];

/** People who were in the chosen fight (everyone in the report when Warcraft Logs doesn't say). */
function playersIn(report: ReportSummary | null, fightId: number | ''): ReportPlayer[] {
  if (!report) return [];
  const ids = report.fights.find((f) => f.id === fightId)?.playerIds ?? [];
  return ids.length ? report.players.filter((p) => ids.includes(p.id)) : report.players;
}

/** "DeathKnight" -> "Death Knight" */
const cls = (c: string) => c.replace(/([a-z])([A-Z])/g, '$1 $2');

const fightRef = (f: ReportSummary['fights'][number]) => ({ id: f.id, encounterID: f.encounterId, name: f.name, startTime: f.startTime, endTime: f.endTime, kill: f.kill });
const dateOf = (r: ReportSummary) => (r.startTime ? new Date(r.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : r.title);

/** Same class first, then by name. */
const byClassThenName = (className?: string) => (a: ReportPlayer, b: ReportPlayer) =>
  Number(b.className === className) - Number(a.className === className) || a.name.localeCompare(b.name);

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
  const [compareWith, setCompareWith] = useState('none');
  // A second log to compare against
  const [otherUrl, setOtherUrl] = useState('');
  const [other, setOther] = useState<ReportSummary | null>(null);
  const [otherFightId, setOtherFightId] = useState<number | ''>('');
  const [otherPlayerId, setOtherPlayerId] = useState<number | ''>('');
  const [otherBusy, setOtherBusy] = useState(false);
  const [otherError, setOtherError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'report' | 'analysis' | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(initial ?? null);
  const [breakdown, setBreakdown] = useState<FightBreakdown | null>(null);
  // Clicking a player in the breakdown picks them and analyzes their fight
  const [pendingPick, setPendingPick] = useState(false);
  const [autoBreakdown, setAutoBreakdown] = useState(false);
  const nav = useNav();
  // Tell the sidebar which analysis is on screen, so it can list its sections.
  useEffect(() => {
    nav.setResult(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  useEffect(() => () => nav.setResult(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const fightPlayers = playersIn(report, fightId);
  const me = fightPlayers.find((p) => p.id === playerId);
  const chosen = compareWith.startsWith('p:') ? fightPlayers.find((p) => p.id === Number(compareWith.slice(2))) : undefined;
  const otherPlayers = playersIn(other, otherFightId);
  const otherMe = compareWith === 'log' ? otherPlayers.find((p) => p.id === otherPlayerId) : undefined;
  const target = chosen ?? otherMe;
  const crossClass = !!(me && target && me.className !== target.className);

  // Keep the picks valid when the fight changes: they must have been in it.
  useEffect(() => {
    if (!report) return;
    if (playerId !== '' && !fightPlayers.some((p) => p.id === playerId)) setPlayerId('');
    if (compareWith.startsWith('p:') && !fightPlayers.some((p) => `p:${p.id}` === compareWith)) setCompareWith('none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fightId, report]);
  useEffect(() => {
    if (other && otherPlayerId !== '' && !otherPlayers.some((p) => p.id === otherPlayerId)) setOtherPlayerId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherFightId, other]);

  /** Load the second log and pre-pick the same boss and, where possible, someone of your class. */
  async function loadOther(link: string, pick?: { fightId?: number; name?: string }) {
    setOtherError(null);
    setOtherBusy(true);
    try {
      const r = await loadReport(link);
      setOther(r);
      const mine = report?.fights.find((f) => f.id === fightId);
      const fid = pick?.fightId ?? r.suggestedFight ?? r.fights.find((f) => f.encounterId === mine?.encounterId)?.id ?? r.fights.at(-1)?.id ?? '';
      setOtherFightId(fid);
      const inFight = playersIn(r, fid);
      const byName = pick?.name ? inFight.find((p) => p.name === pick.name) : undefined;
      const suggested = inFight.find((p) => p.id === r.suggestedPlayer);
      const sameClass = [...inFight].sort(byClassThenName(me?.className)).find((p) => p.className === me?.className);
      setOtherPlayerId((byName ?? suggested ?? sameClass)?.id ?? '');
    } catch (err) {
      setOtherError((err as Error).message);
      setOther(null);
    } finally {
      setOtherBusy(false);
    }
  }

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
        const key = initial.compareKey ?? '';
        if (key.startsWith('p:')) {
          const p = r.players.find((x) => x.name === key.slice(2));
          setCompareWith(p ? `p:${p.id}` : 'none');
        } else if (key.startsWith('l:')) {
          const [, host, code, fid, ...name] = key.split(':');
          const link = `https://${host}/reports/${code}?fight=${fid}`;
          setCompareWith('log');
          setOtherUrl(link);
          loadOther(link, { fightId: Number(fid), name: name.join(':') });
        } else {
          setCompareWith('none');
        }
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
    await loadMain(url);
  }

  // Links from the Discord bot open the site with ?log=<Warcraft Logs link> and load it straight away
  useEffect(() => {
    if (initial) return;
    const log = new URLSearchParams(window.location.search).get('log');
    if (!log) return;
    setUrl(log);
    history.replaceState(null, '', '/');
    loadMain(log);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMain(link: string) {
    setError(null);
    setResult(null);
    setBreakdown(null);
    setBusy('report');
    try {
      const r = await loadReport(link);
      setReport(r);
      setFightId(r.suggestedFight ?? r.fights.at(-1)?.id ?? '');
      setPlayerId(r.suggestedPlayer ?? '');
      setCompareWith('none');
      setOther(null);
      setOtherUrl('');
      // No player in the link: show the whole raid's breakdown straight away
      if (!r.suggestedPlayer && r.fights.length) setAutoBreakdown(true);
    } catch (err) {
      setError((err as Error).message);
      setReport(null);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!pendingPick || playerId === '') return;
    setPendingPick(false);
    onAnalyze();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPick, playerId]);

  useEffect(() => {
    if (!autoBreakdown || !report || fightId === '' || busy) return;
    setAutoBreakdown(false);
    runBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBreakdown, report, fightId, busy]);

  /** No player chosen: the whole-raid breakdown of the fight. */
  async function runBreakdown() {
    const f = report?.fights.find((x) => x.id === fightId);
    if (!report || !f) return;
    setError(null);
    setResult(null);
    setBreakdown(null);
    setProgress([{ label: 'Reading the whole raid', state: 'loading' }]);
    setBusy('analysis');
    const started = performance.now();
    try {
      setBreakdown(await loadBreakdown({ host: report.host, code: report.code, fight: fightRef(f) }));
      setProgress([]);
    } catch (err) {
      setProgress([{ label: 'Reading the whole raid', state: 'failed', seconds: Math.round((performance.now() - started) / 100) / 10 }]);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onAnalyze() {
    if (playerId === '') return runBreakdown();
    const f = report?.fights.find((x) => x.id === fightId);
    if (!report || !f || !me) return;
    const of = other?.fights.find((x) => x.id === otherFightId);
    if (compareWith === 'log' && (!other || !of || !otherMe)) return;
    const compare: CompareChoice =
      compareWith === 'log' && other && of && otherMe
        ? { kind: 'log', host: other.host, code: other.code, fight: fightRef(of), actor: { id: otherMe.id, name: otherMe.name, className: otherMe.className } }
        : chosen ? { kind: 'player', playerId: chosen.id } : { kind: 'none' };
    setError(null);
    setResult(null);
    setBreakdown(null);
    setProgress([]);
    setBusy('analysis');
    try {
      const res = await runAnalysis(
        {
          host: report.host,
          code: report.code,
          fight: fightRef(f),
          actor: { id: me.id, name: me.name, className: me.className },
          compare,
          chosen: chosen ? { id: chosen.id, name: chosen.name, className: chosen.className } : undefined,
          otherLabel: other && of && otherMe ? `${otherMe.name} (${of.name}, ${dateOf(other)})` : undefined,
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
      <section className="panel analyze-card">
        <h2 className="panel-title">{initial ? 'Shared analysis' : 'Analyze a log'}</h2>
        {!report && <p className="help">
          {initial
            ? 'Change the fight, player or who to compare with and click Analyze to make a new comparison. The shared one stays as it is.'
            : 'Paste a Warcraft Logs report link. Links that already include a fight and player (&fight=11&source=28) fill in the choices for you.'}
        </p>}
        <form onSubmit={onLoad} className="row">
          <label className="input-icon">
            <Glyph name="search" size={18} />
            <input
            type="url"
            placeholder="https://fresh.warcraftlogs.com/reports/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            aria-label="Warcraft Logs report link"
            />
          </label>
          <button type="submit" disabled={busy !== null}>{busy === 'report' ? 'Loading…' : 'Load Report'}</button>
        </form>

        {report && (
          <div className="pickers">
            <div className="report-title">
              {report.title}
              {report.startTime ? <> • {new Date(report.startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</> : null}
            </div>
            <label>
              Encounter
              <select value={fightId} onChange={(e) => setFightId(Number(e.target.value))}>
                <option value="" disabled>Choose a boss</option>
                {report.fights.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} – {f.kill ? 'Kill' : 'Wipe'} ({mmss(f.seconds)})</option>
                ))}
              </select>
            </label>
            <label>
              Player
              <select value={playerId} onChange={(e) => setPlayerId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Whole raid (fight breakdown)</option>
                {fightPlayers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({cls(p.className)})</option>
                ))}
              </select>
            </label>
            <label>
              Compare
              <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)} disabled={playerId === ''}>
                <option value="none">No comparison: just my stats</option>
                <optgroup label="Someone in this fight">
                  {fightPlayers
                    .filter((p) => p.id !== playerId)
                    .sort(byClassThenName(me?.className))
                    .map((p) => (
                      <option key={p.id} value={`p:${p.id}`}>{p.name} ({cls(p.className)})</option>
                    ))}
                </optgroup>
                <option value="log">Someone in another log…</option>
              </select>
            </label>
            <button onClick={onAnalyze} disabled={busy !== null || fightId === '' || (playerId !== '' && compareWith === 'log' && !otherMe)}>
              {busy === 'analysis' ? 'Analyzing…' : 'Analyze'}
            </button>

            {compareWith === 'log' && (
              <div className="other-log">
                <div className="other-log-title">Compare with someone in another log</div>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadOther(otherUrl);
                  }}
                >
                  <label className="input-icon">
                    <Glyph name="search" size={18} />
                    <input
                      type="url"
                      placeholder="Paste the other Warcraft Logs report link"
                      value={otherUrl}
                      onChange={(e) => setOtherUrl(e.target.value)}
                      required
                      aria-label="Other Warcraft Logs report link"
                    />
                  </label>
                  <button type="submit" className="secondary" disabled={otherBusy}>{otherBusy ? 'Loading…' : 'Load log'}</button>
                </form>
                {otherError && <p className="error">{otherError}</p>}
                {other && (
                  <div className="other-pickers">
                    <div className="report-title small-title">{other.title} • {dateOf(other)}</div>
                    <label>
                      Encounter
                      <select value={otherFightId} onChange={(e) => setOtherFightId(Number(e.target.value))}>
                        <option value="" disabled>Choose a boss</option>
                        {other.fights.map((f) => (
                          <option key={f.id} value={f.id}>{f.name} – {f.kill ? 'Kill' : 'Wipe'} ({mmss(f.seconds)})</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Player
                      <select value={otherPlayerId} onChange={(e) => setOtherPlayerId(Number(e.target.value))}>
                        <option value="" disabled>Choose a player</option>
                        {[...otherPlayers].sort(byClassThenName(me?.className)).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({cls(p.className)})</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            )}

            {crossClass && (
              <p className="warning">
                <strong>Different class.</strong> {target!.name} is a {target!.className} and you picked a {me!.className}. Only general stats will be
                compared: DPS, parse, active time, item level, downtime, deaths, damage taken and shared buffs like Bloodlust. Rotation and cooldown
                comparisons are skipped. The same applies to a different spec of the same class, which is checked once the fight is read.
              </p>
            )}
          </div>
        )}

        {(busy === 'analysis' || (error && !result)) && progress.length > 0 && (
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

      {breakdown && !result && (
        <Breakdown
          data={breakdown}
          onPick={(id) => {
            setPlayerId(id);
            setCompareWith('none');
            setPendingPick(true);
          }}
        />
      )}
      {result && <ResultView result={result} />}
    </>
  );
}
