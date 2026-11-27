// Wipe analysis: each boss that took wipes, pull by pull, with how far each got (boss health left
// and the phase reached, when Warcraft Logs says) and how long it lasted. Raid-wide, no names.
import type { RaidCard } from '../../server/types';
import { mmss } from '../format';
import { BossIcon } from './icons';

export default function WipePulls({ bosses, link }: { bosses: RaidCard['bosses']; link: (fightId: number) => string }) {
  const hard = bosses.filter((b) => (b.pulls ?? []).length > 0);
  if (!hard.length) return null;
  return (
    <details className="accordion wipe-pulls">
      <summary>Wipes, pull by pull <span className="muted">({hard.reduce((t, b) => t + b.pulls!.length, 0)})</span></summary>
      {hard.map((b) => {
        const pulls = b.pulls!;
        const known = pulls.filter((p) => p.pct !== null);
        const best = known.length ? known.reduce((a, x) => (x.pct! < a.pct! ? x : a)) : null;
        const longest = pulls.reduce((a, x) => (x.seconds > a.seconds ? x : a));
        return (
          <div key={b.encounterId} className="wipe-boss">
            <div className="with-icon wipe-boss-head">
              <BossIcon id={b.encounterId} size="small" />
              <strong>{b.name}</strong>
              <span className="muted small">
                {pulls.length} wipe{pulls.length > 1 ? 's' : ''}{b.kill ? ', then the kill' : ''}
                {best ? ` · best pull got it to ${best.pct}%` : ` · longest pull ${mmss(longest.seconds)}`}
              </span>
            </div>
            <ol className="pull-list">
              {pulls.map((p, i) => (
                <li key={p.fightId} className={p === best || (!best && p === longest) ? 'best' : ''}>
                  <span className="muted small">Pull {i + 1}</span>
                  <progress className="bar pull-bar" max={100} value={p.pct === null ? 0 : 100 - p.pct} aria-label={p.pct === null ? 'Boss health not known' : `Boss at ${p.pct}%`} />
                  <a href={link(p.fightId)} className="small">
                    {p.pct !== null ? `${p.pct}% left` : 'Open'}{p.phase ? ` · phase ${p.phase}` : ''} · {mmss(p.seconds)}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      <p className="muted small">The bar is how much of the boss&rsquo;s health was down. Click a pull for its breakdown: deaths and damage taken show what ended it.</p>
    </details>
  );
}
