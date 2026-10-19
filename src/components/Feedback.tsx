// "What to work on" and "What worked well", side by side.
import { buildStrengths } from '../../server/analysis';
import type { AnalysisResult } from '../../server/types';
import Glyph from './Glyph';
import { SeverityDot } from './icons';

export default function Feedback({ result }: { result: AnalysisResult }) {
  const { findings, notes } = result;
  // Analyses saved before "What worked well" existed get it worked out from the saved numbers.
  const strengths = result.strengths ?? buildStrengths(result.player, result.comparisons, result.dashboard?.gear);

  return (
    <div className="grid-2 feedback">
      <section className="panel">
        <h2 className="panel-title">What to work on</h2>
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
        <h2 className="panel-title">What worked well</h2>
        {strengths.length === 0 ? (
          <p className="muted">Nothing to single out on this pull yet. Keep logging and this fills in as your numbers improve.</p>
        ) : (
          <ul className="findings wins">
            {strengths.map((s, i) => (
              <li key={i}>
                <span className="win-mark"><Glyph name="check" size={14} label="Went well" /></span>
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
