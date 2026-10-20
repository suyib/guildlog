import { CHANGELOG } from '../changelog';

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function ChangelogPage() {
  return (
    <section className="panel">
      <h1>Changelog</h1>
      <ol className="changelog">
        {CHANGELOG.map((r) => (
          <li key={r.version}>
            <div className="release-head">
              <span className="release-version">v{r.version}</span>
              <time dateTime={r.date}>{longDate(r.date)}</time>
            </div>
            <ul>
              {r.changes.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
