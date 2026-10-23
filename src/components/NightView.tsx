// "Whole night" in the boss list: the raid at a glance, like the /raidend summary in Discord,
// plus everyone's numbers across the night. Click a boss for its breakdown, or a player to
// analyze their best boss.
import type { RaidOverview } from '../../server/types';
import { compact, mmss, n0 } from '../format';
import Glyph from './Glyph';
import { ClassIcon, SeverityDot, classCss, parseCss } from './icons';

const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

export default function NightView({ data, onBoss, onPlayer, onRefresh, refreshing }: {
  data: RaidOverview;
  onBoss: (fightId: number) => void;
  onPlayer: (fightId: number, playerId: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const c = data.card;
  const read = c.summarized ?? c.kills;
  const partial = read < c.kills;
  const healers = data.players.filter((p) => p.healer);
  const others = data.players.filter((p) => !p.healer);
  const topDps = Math.max(...others.map((p) => p.perSecond), 1);
  const topHps = Math.max(...healers.map((p) => p.perSecond), 1);

  return (
    <div className="result">
      <header className="fight-head">
        <div className="fight-id">
          <span className="kpi-icon big"><Glyph name="calendar" size={22} /></span>
          <div>
            <div className="eyebrow">
              {new Date(data.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {c.kills} of {c.bosses.length} bosses killed · {c.raiders.length} raiders
            </div>
            <h1>{data.title}</h1>
          </div>
        </div>
        <span className="muted small">Click a boss for its breakdown, or anyone to analyze their best boss.</span>
      </header>

      {partial && (
        <p className="warning">
          Read {read} of {c.kills} boss kills so far; the rest are still being read from Warcraft Logs.{' '}
          <button type="button" className="link-button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Reading…' : 'Read more now'}</button>
        </p>
      )}

      <div className="kpis">
        <Kpi glyph="check" label="Bosses killed" value={`${c.kills} of ${c.bosses.length}`} sub={c.wipes ? `${c.wipes} wipe${c.wipes === 1 ? '' : 's'} along the way` : 'no wipes'} />
        <Kpi glyph="timer" label="Raid time" value={c.raidSeconds ? hm(c.raidSeconds) : '–'} sub="first pull to last kill" />
        <Kpi glyph="alert" label="Deaths on kills" value={partial ? `${c.deaths}+` : String(c.deaths)} sub={partial ? 'so far' : 'across every kill'} />
        <Kpi glyph="shield" label="Item level" value={c.avgItemLevel ? String(c.avgItemLevel) : '–'} sub="raid average" />
      </div>

      <div className="grid-2-1">
        <section className="panel">
          <h2 className="panel-title">Bosses</h2>
          <ul className="boss-list">
            {c.bosses.map((b) => (
              <li key={b.encounterId}>
                <span className={b.kill ? 'kill' : 'wipe'}>{b.kill ? 'Kill' : 'Not killed'}</span>
                <strong>{b.name}</strong>
                <span className="muted">{b.seconds !== null ? mmss(b.seconds) : ''}{b.wipes ? `${b.seconds !== null ? ' · ' : ''}${b.wipes} wipe${b.wipes > 1 ? 's' : ''}` : ''}</span>
                {b.fightId ? <button type="button" className="link-button boss-open" onClick={() => onBoss(b.fightId!)}>Breakdown</button> : <span />}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2 className="panel-title">Who was there ({c.raiders.length})</h2>
          {(['tank', 'healer', 'dps'] as const).map((role) => {
            const list = c.raiders.filter((p) => p.role === role);
            if (!list.length) return null;
            return (
              <div key={role} className="comp-group">
                <div className="comp-label">{role === 'tank' ? 'Tanks' : role === 'healer' ? 'Healers' : 'Damage'} ({list.length})</div>
                <div className="comp-list">
                  {list.map((p) => (
                    <span key={p.name} className="comp-chip static"><ClassIcon className={p.className} size={16} /><span className={classCss(p.className)}>{p.name}</span>{c.kills > 0 && p.bosses < c.kills && <span className="muted small">{p.bosses}/{c.kills}</span>}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {!partial && (
        <div className="grid-2 feedback">
          <section className="panel">
            <h2 className="panel-title">What went well</h2>
            {c.feedback.good.length === 0 ? <p className="muted">Nothing to single out.</p> : (
              <ul className="findings wins">
                {c.feedback.good.map((f, i) => (
                  <li key={i}>
                    <span className="win-mark"><Glyph name="check" size={14} label="Went well" /></span>
                    <div><strong>{f.title}</strong><p>{f.detail}</p>{f.who && f.who.length > 0 && <p className="muted small">{f.who.join(', ')}</p>}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <h2 className="panel-title">What to work on</h2>
            {c.feedback.work.length === 0 ? <p className="muted">Nothing stood out. Nice work.</p> : (
              <ul className="findings">
                {c.feedback.work.map((f, i) => (
                  <li key={i} className="sev-medium"><SeverityDot severity="medium" /><div><strong>{f.title}</strong><p>{f.detail}</p></div></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <div className="grid-2">
        <PlayerTable title="Damage across the night" unit="DPS" players={others} top={topDps} onPlayer={onPlayer} />
        <PlayerTable title="Healing across the night" unit="HPS" players={healers} top={topHps} onPlayer={onPlayer} />
      </div>
    </div>
  );
}

function PlayerTable({ title, unit, players, top, onPlayer }: {
  title: string; unit: string; players: RaidOverview['players']; top: number; onPlayer: (fightId: number, playerId: number) => void;
}) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      {players.length === 0 ? <p className="muted small">Nobody yet.</p> : (
        <ol className="meter">
          {players.map((p, i) => (
            <li key={p.name}>
              <button type="button" className="meter-row" onClick={() => onPlayer(p.best.fightId, p.best.playerId)} aria-label={`Analyze ${p.name} on ${p.best.boss}`} title={`Best: ${p.best.boss}${p.best.parse !== null ? ` (${Math.round(p.best.parse)})` : ''}`}>
                <span className="meter-rank">{i + 1}</span>
                <ClassIcon className={p.className} size={18} />
                <span className="meter-name">
                  <span className={classCss(p.className)}>{p.name}</span>
                  <span className="muted small">{spaced(p.specName)} · {p.bosses} boss{p.bosses === 1 ? '' : 'es'}{p.deaths ? ` · died ${p.deaths}×` : ''}</span>
                </span>
                <progress className={`bar ${classCss(p.className)}-bar`} max={1} value={p.perSecond / top} aria-hidden="true" />
                <span className="meter-value">{p.perSecond >= 10_000 ? compact(p.perSecond) : n0(p.perSecond)} <span className="muted small">{unit}</span></span>
                <span className={`meter-parse ${parseCss(p.avgParse)}`}>{p.avgParse ?? ''}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">The number on the right is the average parse across the night{unit === 'HPS' ? ' (healing parse)' : ''}.</p>
    </section>
  );
}

function Kpi({ glyph, label, value, sub }: { glyph: 'check' | 'timer' | 'alert' | 'shield'; label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><span className="kpi-icon"><Glyph name={glyph} size={18} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
