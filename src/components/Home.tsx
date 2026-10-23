// The home page around "Analyze a log": the guild at a glance, the next raid, the latest raids
// and what went well, your characters and the guild's recent analyses.
import { useEffect, useState } from 'react';
import type { HomeData, SavedRaid } from '../../server/types';
import { loadHome } from '../api';
import { mmss, n0 } from '../format';
import Glyph from './Glyph';
import { ClassIcon, classCss, parseCss } from './icons';

let homePromise: Promise<HomeData | null> | null = null;
/** Read once per page load and shared by both parts of the home page. */
function useHome() {
  const [data, setData] = useState<HomeData | null>(null);
  useEffect(() => {
    homePromise ??= loadHome().catch(() => null);
    homePromise.then(setData);
  }, []);
  return data;
}

const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const logLink = (r: SavedRaid, fightId?: number | null) => `/?log=${encodeURIComponent(`https://${r.host}/reports/${r.code}${fightId ? `?fight=${fightId}` : ''}`)}`;

function untilText(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `in ${Math.round(h / 24)} days`;
  if (h >= 1) return `in ${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return `in ${Math.max(1, Math.round(ms / 60_000))} minutes`;
}

/** Above "Analyze a log": the guild, who's signed in, and the next raid. */
export function HomeHero() {
  const d = useHome();
  if (!d || (!d.guild && !d.nextRaid)) return null;
  return (
    <section className="panel home-hero">
      <div className="home-guild">
        {d.guild?.icon ? <img src={d.guild.icon} width={56} height={56} alt="" /> : <span className="kpi-icon big"><Glyph name="users" size={24} /></span>}
        <div>
          <h1>{d.guild?.name ?? 'Guild Logs'}</h1>
          {d.guild?.members ? (
            <p className="muted small">{n0(d.guild.members)} members on Discord{d.guild.online ? ` · ${n0(d.guild.online)} online` : ''}</p>
          ) : null}
          {d.myCharacters.length > 0 && (
            <p className="home-mine">
              <a href="/#/me">Your characters:</a> {d.myCharacters.map((c) => <span key={c.name} className={`admin-char ${c.status}`}>{c.name}</span>)}
            </p>
          )}
        </div>
      </div>
      {d.nextRaid && (
        <div className="home-next">
          <div className="comp-label">Next raid</div>
          <strong>{d.nextRaid.message}</strong>
          <span>
            {new Date(d.nextRaid.gatherAt).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
            <span className="muted"> · {untilText(d.nextRaid.gatherAt)}</span>
          </span>
          {d.nextRaid.place && <span className="muted small">{d.nextRaid.place}</span>}
        </div>
      )}
    </section>
  );
}

/** Below "Analyze a log": the guild's numbers, latest raids, highlights and recent analyses. */
export function HomeExtras() {
  const d = useHome();
  if (!d) return null;
  const s = d.stats;
  return (
    <>
      {d.latestRaids.length > 0 && (
        <div className="kpis">
          <Kpi glyph="calendar" label="Raids" value={String(s.raids8w)} sub="last 8 weeks" />
          <Kpi glyph="check" label="Full clears" value={s.raids8w ? `${s.fullClears8w} of ${s.raids8w}` : '–'} sub="every boss killed" />
          <Kpi glyph="timer" label="Raid time" value={s.avgRaidSeconds ? hm(s.avgRaidSeconds) : '–'} sub="average, first pull to last kill" />
          <Kpi glyph="users" label="Active raiders" value={String(s.activeRaiders4w)} sub="in a raid in the last 4 weeks" />
        </div>
      )}

      <div className="grid-2-1">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Latest raids</h2>
            <a href="/#/raids" className="small">All past raids</a>
          </div>
          {d.latestRaids.length === 0 ? (
            <p className="muted">No raids yet. They appear here after <strong>/raidend</strong> in Discord, or when an officer adds one on Past raids.</p>
          ) : (
            <ul className="home-raids">
              {d.latestRaids.map((r) => {
                const c = r.card;
                if (!c) {
                  return (
                    <li key={r.code}>
                      <span className="raid-chip-count">…</span>
                      <span className="home-raid-main">
                        <a href={logLink(r)}><strong>{r.title ?? r.code}</strong></a>
                        <span className="muted small">{shortDate(r.startTime!)} · being read from Warcraft Logs</span>
                      </span>
                    </li>
                  );
                }
                const full = c.kills > 0 && c.bosses.every((b) => b.kill);
                return (
                  <li key={r.code}>
                    <span className={`raid-chip-count ${full ? 'full' : c.kills ? 'partial' : 'none'}`}>{c.kills}/{c.bosses.length}</span>
                    <span className="home-raid-main">
                      <a href={logLink(r)}><strong>{r.title ?? r.code}</strong></a>
                      <span className="muted small">
                        {shortDate(r.startTime!)} · {c.raidSeconds ? hm(c.raidSeconds) : '–'} · {c.raiders.length} raiders · {(c.summarized ?? c.kills) < c.kills ? `still reading (${c.summarized ?? 0} of ${c.kills} kills)` : `${c.deaths} death${c.deaths === 1 ? '' : 's'}`}
                      </span>
                      <span className="home-bosses">
                        {c.bosses.map((b) => (
                          <a key={b.encounterId} href={b.fightId ? logLink(r, b.fightId) : undefined} className={b.kill ? 'kill' : 'wipe'} title={b.kill ? `Killed in ${mmss(b.seconds ?? 0)}` : 'Not killed'}>
                            {b.name}{b.kill && b.seconds ? ` ${mmss(b.seconds)}` : ''}
                          </a>
                        ))}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Last raid&rsquo;s highlights</h2>
          {d.highlights.length === 0 ? (
            <p className="muted small">Highlights from the latest raid show here.</p>
          ) : (
            <ul className="findings wins">
              {d.highlights.map((f, i) => (
                <li key={i}>
                  <span className="win-mark"><Glyph name="check" size={14} label="Went well" /></span>
                  <div><strong>{f.title}</strong><p>{f.detail}</p>{f.who && f.who.length > 0 && <p className="muted small">{f.who.slice(0, 8).join(', ')}{f.who.length > 8 ? ` and ${f.who.length - 8} more` : ''}</p>}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {d.recentAnalyses.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Recently analyzed</h2>
            <a href="/#/history" className="small">All analyses</a>
          </div>
          <div className="scroll">
            <table className="grid">
              <thead><tr><th>Player</th><th>Boss</th><th className="r">Parse</th><th>When</th></tr></thead>
              <tbody>
                {d.recentAnalyses.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => (window.location.href = `/a/${a.id}`)}>
                    <td><a href={`/a/${a.id}`} className={`with-icon ${classCss(a.class_name)}`}><ClassIcon className={a.class_name} size={16} />{a.player_name}</a></td>
                    <td>{a.encounter_name}</td>
                    <td className={`r strong ${parseCss(a.parse_percent)}`}>{a.parse_percent === null ? '–' : Math.round(a.parse_percent)}</td>
                    <td className="muted">{shortDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Kpi({ glyph, label, value, sub }: { glyph: 'calendar' | 'check' | 'timer' | 'users'; label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><span className="kpi-icon"><Glyph name={glyph} size={18} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
