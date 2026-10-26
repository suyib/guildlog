// Potions, boss debuffs, damage over time, death recaps, tank mitigation and "against the
// guild", from the stored fight (v0.25.0). Each panel says so when a fight was read before then.
import type { AnalysisResult, DeathRecap, Mitigation, PlayerSnapshot } from '../../server/types';
import { compact, mmss, n0, pct } from '../format';
import Glyph from './Glyph';
import { parseCss } from './icons';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Where this fight sits among the guild's own kills of the boss in the same spec. */
export function GuildPanel({ result, value }: { result: AnalysisResult; value: number }) {
  const g = result.guild;
  if (!g) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">Against the guild</h2>
      <p className="muted small">{g.spec}s on {g.encounter} in the guild&rsquo;s Past raids: {g.kills} kill{g.kills === 1 ? '' : 's'} by {g.players} player{g.players === 1 ? '' : 's'}.</p>
      <dl className="facts">
        <div><dt>This fight</dt><dd>{n0(value)} {g.unit}</dd></div>
        <div><dt>Guild best</dt><dd>{g.best ? `${n0(g.best.perSecond)} (${g.best.name}, ${day(g.best.date)})` : '–'}</dd></div>
        <div><dt>Typical</dt><dd>{g.median ? n0(g.median) : '–'}</dd></div>
        <div><dt>Your place</dt><dd>{g.place ? `${ordinal(g.place)} of ${g.players}` : 'Not ranked yet'}</dd></div>
      </dl>
      {g.mine.length > 1 && (
        <>
          <div className="comp-label">Your kills of {g.encounter}</div>
          <ul className="event-list">
            {g.mine.map((k) => (
              <li key={`${k.code}-${k.fightId}`}>
                <span className="ev-time">{day(k.date)}</span>
                <span>{n0(k.perSecond)} {g.unit}</span>
                <span className={parseCss(k.parse)}>{k.parse === null ? '' : `parse ${Math.round(k.parse)}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Potions used, and the debuffs the raid kept on the boss. */
export function PotionsAndDebuffs({ me }: { me: PlayerSnapshot }) {
  if (!me.potions && !me.raidDebuffs) return null;
  const p = me.potions;
  return (
    <section className="panel">
      <h2 className="panel-title">Potions and boss debuffs</h2>
      {p && (
        p.used.length || p.prePot ? (
          <ul className="event-list">
            {p.prePot && <li><span className="ev-time">pull</span>Potion running at the pull</li>}
            {p.used.map((u, i) => <li key={i}><span className="ev-time">{mmss(u.seconds)}</span>{u.name}</li>)}
          </ul>
        ) : (
          <p className="warn-text small">No potion used this fight.</p>
        )
      )}
      {me.raidDebuffs && me.raidDebuffs.length > 0 && (
        <>
          <div className="comp-label">On the boss (the whole raid&rsquo;s)</div>
          <table className="grid">
            <tbody>
              {me.raidDebuffs.map((d) => (
                <tr key={d.label} className={d.uptimePct < 80 ? 'warn' : ''}>
                  <td>{d.label}</td>
                  <td className="r"><Bar v={d.uptimePct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Your damage-over-time spells' uptime on their main target. */
export function DotsPanel({ me }: { me: PlayerSnapshot }) {
  if (!me.dots?.length) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">Damage over time</h2>
      <p className="muted small">How much of the fight each one was ticking on its main target. Aim for 90% or more on the ones that matter.</p>
      <table className="grid">
        <thead><tr><th>Spell</th><th className="r">Your damage</th><th className="r">Uptime</th></tr></thead>
        <tbody>
          {me.dots.map((d) => (
            <tr key={d.name} className={d.sharePct >= 5 && d.uptimePct < 80 ? 'warn' : ''}>
              <td>{d.name}</td>
              <td className="r muted">{d.sharePct}%</td>
              <td className="r"><Bar v={d.uptimePct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Each death, with the last hits and the healing received in the 10 seconds before it. */
export function DeathList({ deaths }: { deaths: DeathRecap[] }) {
  return (
    <ul className="death-list">
      {deaths.map((d, i) => (
        <li key={i} className={d.hits?.length ? 'with-recap' : ''}>
          <Glyph name="alert" size={16} />Died at {mmss(d.seconds)}{d.by ? ` to ${d.by}` : ''}
          {d.hits && d.hits.length > 0 && (
            <div className="recap">
              <div className="muted small">The last 10 seconds: {compact(d.healed ?? 0)} healing received</div>
              <ul className="event-list">
                {d.hits.map((h, j) => (
                  <li key={j}><span className="ev-time">{mmss(h.t)}</span>{h.name}<span className="muted">{compact(h.amount)}{h.from ? ` from ${h.from}` : ''}</span></li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The boss's melee swings at a tank. */
export function MitigationFacts({ m, critCap }: { m: Mitigation; critCap: boolean }) {
  return (
    <dl className="facts single">
      <div><dt>Boss melee swings</dt><dd>{n0(m.swings)}</dd></div>
      <div><dt>Avoided (dodge, parry, miss)</dt><dd>{pct(m.avoidPct, 1)}</dd></div>
      <div><dt>Blocked</dt><dd>{n0(m.blocked)}</dd></div>
      {critCap && <div><dt>Crits taken</dt><dd className={m.crits ? 'warn-text' : ''}>{m.crits}</dd></div>}
    </dl>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <span className="uptime">
      <progress className="bar uptime-bar" max={100} value={Math.min(100, v)} aria-hidden="true" />
      {pct(v)}
    </span>
  );
}
