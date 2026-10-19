import { useEffect, useMemo, useState } from 'react';
import type { HistoryRow } from '../../server/types';
import { loadHistory } from '../api';
import { n0 } from '../format';
import { ClassIcon, classCss, compareLabel, parseCss } from './icons';

export default function HistoryPage() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadHistory().then(setRows).catch((e) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (rows ?? []).filter((r) => !f || `${r.player_name} ${r.encounter_name} ${r.class_name} ${r.compare_key}`.toLowerCase().includes(f));
  }, [rows, filter]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Saved analyses</h1>
        <input className="filter" placeholder="Filter by player, boss, class or comparison" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" />
      </div>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && shown.length === 0 && <p className="muted">Nothing saved yet.</p>}
      {shown.length > 0 && (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr><th>Date</th><th>Player</th><th>Boss</th><th>Compared with</th><th className="r">DPS</th><th className="r">Parse</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => (window.location.href = `/a/${r.id}`)}>
                  <td className="muted">{r.created_at.slice(0, 10)}</td>
                  <td>
                    <a href={`/a/${r.id}`} className={`with-icon ${classCss(r.class_name)}`}><ClassIcon className={r.class_name} size={16} />{r.player_name}</a>
                  </td>
                  <td>{r.encounter_name}</td>
                  <td className="muted">{compareLabel(r.compare_key)}</td>
                  <td className="r">{n0(r.dps)}</td>
                  <td className={`r strong ${parseCss(r.parse_percent)}`}>{r.parse_percent === null ? '–' : Math.round(r.parse_percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
