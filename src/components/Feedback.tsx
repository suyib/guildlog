// "What to work on" and "What worked well", side by side.
import { buildStrengths } from '../../server/analysis';
import type { AnalysisResult } from '../../server/types';
import { SeverityDot } from './icons';

export default function Feedback({ result }: { result: AnalysisResult }) {
  const { findings, notes } = result;
  // Analyses saved before "What worked well" existed get it worked out from the saved numbers.
  const strengths = result.strengths ?? buildStrengths(result.player, result.comparisons, result.dashboard?.gear);

  return (
    <div className="dash-grid feedback">
      <section className="panel">
        <h3 className="panel-title">What to work on</h3>
        {findings.length === 0 ? (
          <p className="muted">Nothing stood out. Nice work.</p>
        ) : (
          <ul className="findings">
            {findings.map((f, i) => (
              <li key={i} className={`sev-${f.severity}`}>
                <SeverityDot severity={f.severity} />
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {findings.length > 0 && (
          <p className="muted small legend">
            <SeverityDot severity="high" /> biggest gain <SeverityDot severity="medium" /> worth fixing <SeverityDot severity="low" /> minor
          </p>
        )}
        {notes.length > 0 && <p className="muted small">Notes: {notes.join(' · ')}</p>}
      </section>

      <section className="panel">
        <h3 className="panel-title">What worked well</h3>
        {strengths.length === 0 ? (
          <p className="muted">Nothing to single out on this pull yet. Keep logging and this fills in as your numbers improve.</p>
        ) : (
          <ul className="findings wins">
            {strengths.map((s, i) => (
              <li key={i}>
                <svg className="check" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Went well">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
                <div>
                  <strong>{s.title}</strong>
                  <p>{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
