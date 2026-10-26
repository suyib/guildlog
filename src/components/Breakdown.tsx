// Whole-raid breakdown of one fight, shown when no player is chosen. Click a player to analyze them.
import type { FightBreakdown } from '../../server/types';
import { compact, mmss, n0, pct } from '../format';
import { DpsChart } from './charts';
import BossRankLine from './BossRankLine';
import Glyph from './Glyph';
import { BossIcon, ClassIcon, GameIcon, SeverityDot, classCss, parseCss } from './icons';
import { recapLine } from '../../server/insights';

type Player = FightBreakdown['players'][number];
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const ROLE_LABEL = { tank: 'Tanks', healer: 'Healers', dps: 'Damage' } as const;

export default function Breakdown({ data, host, onPick }: { data: FightBreakdown; host: string; onPick: (playerId: number) => void }) {
  const { fight, totals, players } = data;
  const healers = [...players].filter((p) => p.healing > 0).sort((a, b) => b.hps - a.hps).slice(0, 12);
  const topDps = Math.max(...players.map((p) => p.dps), 1);
  const topHps = Math.max(...healers.map((p) => p.hps), 1);
  const interrupts = players.filter((p) => p.interrupts > 0).sort((a, b) => b.interrupts - a.interrupts);
  const dispels = players.filter((p) => p.dispels > 0).sort((a, b) => b.dispels - a.dispels);
  const avoidable = players.filter((p) => p.role !== 'tank' && p.avoidable > 0).sort((a, b) => b.avoidable - a.avoidable).slice(0, 6);
  const firstDeath = data.deaths[0];
  const counts = { tank: 0, healer: 0, dps: 0 };
  for (const p of players) counts[p.role]++;

  return (
    <div className="result">
      <header className="fight-head">
        <div className="fight-id">
          <a href={`/#/rankings?boss=${fight.encounterID}`} className="boss-head-link" title={`${fight.name} rankings`}><BossIcon id={fight.encounterID} size="big" /></a>
          <div>
            <div className="eyebrow">
              {fight.name} · <span className={fight.kill ? 'kill' : 'wipe'}>{fight.kill ? 'Kill' : 'Wipe'}</span> · {mmss(fight.seconds)} · {players.length} players
              ({counts.tank} tank{counts.tank === 1 ? '' : 's'}, {counts.healer} healer{counts.healer === 1 ? '' : 's'}, {counts.dps} damage)
            </div>
            <h1>Whole raid</h1>
            <BossRankLine host={host} encounterId={fight.encounterID} name={fight.name} />
          </div>
        </div>
        <span className="muted small">Click anyone to analyze their fight.</span>
      </header>

      <div className="kpis">
        <Kpi glyph="bolt" label="Raid DPS" value={n0(totals.dps)} sub={`${compact(totals.damage)} damage`} />
        <Kpi glyph="pulse" label="Raid HPS" value={n0(totals.hps)} sub={`${compact(totals.healing)} healing`} />
        <Kpi glyph="alert" label="Deaths" value={String(totals.deaths)} sub={firstDeath ? `First: ${firstDeath.name} at ${mmss(firstDeath.seconds)}` : 'Nobody died'} />
        <Kpi glyph="shield" label="Item level" value={totals.avgItemLevel ? totals.avgItemLevel.toFixed(1) : '–'} sub="Raid average" />
      </div>

      {data.feedback && (
        <div className="grid-2 feedback">
          <section className="panel">
            <h2 className="panel-title">What went well</h2>
            {data.feedback.good.length === 0 ? (
              <p className="muted">Nothing to single out on this pull yet.</p>
            ) : (
              <ul className="findings wins">
                {data.feedback.good.map((f, i) => (
                  <li key={i}>
                    <span className="win-mark"><Glyph name="check" size={14} label="Went well" /></span>
                    <div>
                      <strong>{f.title}</strong>
                      <p>{f.detail}</p>
                      {f.who && f.who.length > 0 && <p className="muted small">{f.who.join(', ')}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <h2 className="panel-title">What to work on</h2>
            {data.feedback.work.length === 0 ? (
              <p className="muted">Nothing stood out. Nice work.</p>
            ) : (
              <ul className="findings">
                {data.feedback.work.map((f, i) => (
                  <li key={i} className="sev-medium">
                    <SeverityDot severity="medium" />
                    <div>
                      <strong>{f.title}</strong>
                      <p>{f.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <section className="panel">
        <h2 className="panel-title">Raid DPS over the fight</h2>
        {data.dpsSeries?.length > 1 ? (
          <DpsChart
            series={data.dpsSeries}
            average={totals.dps}
            marks={data.bloodlust.map((b) => ({ t: b.seconds, name: `${b.name} (${b.by})` }))}
            markLabel="Bloodlust"
          />
        ) : (
          <p className="muted small">Warcraft Logs didn&rsquo;t return a damage graph for this fight.</p>
        )}
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">Damage done</h2>
          <ol className="meter">
            {players.map((p, i) => (
              <MeterRow key={p.id} rank={i + 1} p={p} value={p.dps} top={topDps} label={`${n0(p.dps)}`} onPick={onPick} />
            ))}
          </ol>
        </section>
        <section className="panel">
          <h2 className="panel-title">Healing done</h2>
          {healers.length === 0 ? (
            <p className="muted small">No healing recorded.</p>
          ) : (
            <ol className="meter">
              {healers.map((p, i) => (
                <MeterRow
                  key={p.id}
                  rank={i + 1}
                  p={p}
                  value={p.hps}
                  top={topHps}
                  label={n0(p.hps)}
                  extra={p.overhealPct !== null ? `${Math.round(p.overhealPct)}% overheal` : undefined}
                  onPick={onPick}
                  healing
                />
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="grid-2-1">
        <section className="panel">
          <h2 className="panel-title">Damage taken by ability</h2>
          <p className="muted small">&ldquo;Likely avoidable&rdquo; means it hit fewer than half of the non-tanks. Check the boss&rsquo;s mechanics before treating it as a mistake.</p>
          <div className="scroll">
            <table className="grid">
              <thead><tr><th>Ability</th><th className="r">Damage</th><th className="r">Players hit</th><th></th></tr></thead>
              <tbody>
                {data.takenByAbility.map((a) => (
                  <tr key={a.name}>
                    <td><span className="with-icon"><GameIcon file={a.icon} />{a.name}</span></td>
                    <td className="r">{compact(a.total)}</td>
                    <td className="r muted">{a.playersHit} / {totals.raidSize}</td>
                    <td>{a.avoidable && <span className="badge badge-warn">Likely avoidable</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Deaths</h2>
          {data.deaths.length === 0 ? (
            <p className="good-note"><Glyph name="check" size={16} />Nobody died</p>
          ) : (
            <ul className="event-list">
              {data.deaths.map((d, i) => (
                <li key={i}>
                  <span className="ev-time">{mmss(d.seconds)}</span>
                  <span className={classCss(d.className)}>{d.name}</span>
                  <span className="muted">{d.by}</span>
                  {d.hits && d.hits.length > 0 && <span className="muted small recap-line">{recapLine(d, compact)}</span>}
                </li>
              ))}
            </ul>
          )}
          <h2 className="panel-title">Bloodlust</h2>
          {data.bloodlust.length === 0 ? (
            <p className="muted small">Not used, or not found in this log.</p>
          ) : (
            <ul className="event-list">
              {data.bloodlust.map((b, i) => (
                <li key={i}><span className="ev-time">{mmss(b.seconds)}</span>{b.name}<span className="muted">by {b.by}</span></li>
              ))}
            </ul>
          )}
          {data.debuffs && data.debuffs.length > 0 && (
            <>
              <h2 className="panel-title">Debuffs on the boss</h2>
              <ul className="event-list">
                {data.debuffs.map((d) => (
                  <li key={d.label}><span className={`ev-time${d.uptimePct < 80 ? ' warn-text' : ''}`}>{d.uptimePct}%</span>{d.label}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2 className="panel-title">Raid composition</h2>
          {(['tank', 'healer', 'dps'] as const).map((role) => {
            const group = players.filter((p) => p.role === role).sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
            if (!group.length) return null;
            return (
              <div key={role} className="comp-group">
                <div className="comp-label">{ROLE_LABEL[role]} ({group.length})</div>
                <div className="comp-list">
                  {group.map((p) => (
                    <button key={p.id} type="button" className="comp-chip" onClick={() => onPick(p.id)} title={`${spaced(p.specName)} ${p.className}${p.itemLevel ? `, item level ${p.itemLevel}` : ''}`}>
                      <ClassIcon className={p.className} size={16} />
                      <span className={classCss(p.className)}>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section className="panel">
          <h2 className="panel-title">Utility and avoidable damage</h2>
          <dl className="facts single">
            <div><dt>Interrupts</dt><dd>{interrupts.length ? interrupts.slice(0, 4).map((p) => `${p.name} ${p.interrupts}`).join(', ') : 'None recorded'}</dd></div>
            <div><dt>Dispels</dt><dd>{dispels.length ? dispels.slice(0, 4).map((p) => `${p.name} ${p.dispels}`).join(', ') : 'None recorded'}</dd></div>
          </dl>
          {avoidable.length > 0 && (
            <>
              <div className="comp-label">Most likely-avoidable damage taken (non-tanks)</div>
              <ul className="event-list">
                {avoidable.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="link-button" onClick={() => onPick(p.id)}><span className={classCss(p.className)}>{p.name}</span></button>
                    <span>{compact(p.avoidable)}</span>
                    <span className="muted">{p.taken ? pct((p.avoidable / p.taken) * 100) : ''} of their damage taken</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ glyph, label, value, sub }: { glyph: 'bolt' | 'pulse' | 'alert' | 'shield'; label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><span className="kpi-icon"><Glyph name={glyph} size={18} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function MeterRow({ rank, p, value, top, label, extra, onPick, healing = false }: {
  rank: number; p: Player; value: number; top: number; label: string; extra?: string; onPick: (id: number) => void; healing?: boolean;
}) {
  const showParse = healing ? p.role === 'healer' : p.role !== 'healer';
  return (
    <li>
      <button type="button" className="meter-row" onClick={() => onPick(p.id)} aria-label={`Analyze ${p.name}`}>
        <span className="meter-rank">{rank}</span>
        <ClassIcon className={p.className} size={18} />
        <span className="meter-name">
          <span className={classCss(p.className)}>{p.name}</span>
          <span className="muted small">{extra ?? `${spaced(p.specName)}${p.deaths ? ` · died` : ''}`}</span>
        </span>
        <progress className={`bar ${classCss(p.className)}-bar`} max={1} value={value / top} aria-hidden="true" />
        <span className="meter-value">{label}</span>
        <span className={`meter-parse ${parseCss(showParse ? p.parse : null)}`}>{showParse && p.parse !== null ? Math.round(p.parse) : ''}</span>
      </button>
    </li>
  );
}
