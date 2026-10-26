// The home page around "Analyze a log", as a guild page like Warcraft Logs': who the guild is,
// progress and ranks, best parses, the roster by role, the raid schedule and recent reports.
import { Fragment, useEffect, useState } from 'react';
import type { BossRanks, GuildRankings, HomeData, SavedRaid, WclRank, ZoneProgress } from '../../server/types';
import { loadBossRanks, loadHome } from '../api';
import { mmss, n0 } from '../format';
import Glyph from './Glyph';
import { ClassIcon, classCss, parseCss } from './icons';

let homePromise: Promise<HomeData | null> | null = null;
/** Read once per page load and shared by both parts of the home page. undefined while loading, null if it failed. */
function useHome() {
  const [data, setData] = useState<HomeData | null | undefined>(undefined);
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

/** Above "Analyze a log": the guild, its progress, who's signed in, and the next raid. */
export function HomeHero() {
  const d = useHome();
  // One loader until everything's in, so the page doesn't fill in piece by piece
  if (d === undefined) {
    return (
      <section className="panel home-loading" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <span className="muted">Loading the guild&hellip;</span>
      </section>
    );
  }
  if (!d || (!d.guild && !d.wcl && !d.nextRaid)) return null;
  const where = [d.wcl?.server && `${d.wcl.server}${d.wcl.region ? ` (${d.wcl.region})` : ''}`, d.wcl?.faction].filter(Boolean).join(' · ');
  return (
    <section className="panel home-hero">
      <div className="home-guild">
        {d.guild?.icon ? <img src={d.guild.icon} width={56} height={56} alt="" /> : <span className="kpi-icon big"><Glyph name="users" size={24} /></span>}
        <div>
          <h1>{d.guild?.name || d.wcl?.name || 'Guild Logs'}</h1>
          <p className="muted small">
            {[where, d.guild?.members ? `${n0(d.guild.members)} members on Discord${d.guild.online ? `, ${n0(d.guild.online)} online` : ''}` : ''].filter(Boolean).join(' · ')}
          </p>
          {d.guild?.about && <p className="home-about">{d.guild.about}</p>}
          {d.zones.length > 0 && (
            <p className="home-progress">
              {d.zones.map((z) => <span key={z.id} className={`zone-chip${z.killed === z.total ? ' full' : ''}`}>{z.name} <strong>{z.killed}/{z.total}</strong></span>)}
              {d.wcl && <a href={d.wcl.url} target="_blank" rel="noreferrer" className="small">On Warcraft Logs</a>}
            </p>
          )}
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

/** Below "Analyze a log", laid out like a Warcraft Logs guild page: the main column has progress,
 * best parses and the roster by role; the side column has ranks, the schedule and recent reports. */
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
        <div className="home-col">
          {d.zones.length > 0 && <Progress zones={d.zones} wcl={d.wcl} />}
          {d.rankings.length > 0 && <Rankings list={d.rankings} />}
          {d.roster.length > 0 && <Composition roster={d.roster} />}
          {d.recentAnalyses.length > 0 && <RecentAnalyses list={d.recentAnalyses} />}
        </div>

        <aside className="home-col">
          {d.zones.some((z) => z.ranks) && <RankCard zones={d.zones.filter((z) => z.ranks)} url={d.wcl?.url ?? null} />}
          {d.schedule.length > 0 && <Schedule raids={d.schedule} />}

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Recent reports</h2>
              <a href="/#/raids" className="small">All past raids</a>
            </div>
            {d.latestRaids.length === 0 ? (
              <p className="muted small">No raids yet. They appear here after <strong>/raidend</strong> in Discord, or when an officer adds one on Past raids.</p>
            ) : (
              <ul className="home-raids">
                {d.latestRaids.map((r) => {
                  const c = r.card;
                  const full = !!c && c.kills > 0 && c.bosses.every((b) => b.kill);
                  return (
                    <li key={r.code}>
                      <span className={`raid-chip-count ${!c ? '' : full ? 'full' : c.kills ? 'partial' : 'none'}`}>{c ? `${c.kills}/${c.bosses.length}` : '…'}</span>
                      <span className="home-raid-main">
                        <a href={logLink(r)}><strong>{r.title ?? r.code}</strong></a>
                        <span className="muted small">
                          {shortDate(r.startTime!)}{c ? ` · ${c.raidSeconds ? hm(c.raidSeconds) : '–'} · ${c.raiders.length} raiders` : ' · being read'}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {d.highlights.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">Last raid&rsquo;s highlights</h2>
              <ul className="findings wins">
                {d.highlights.map((f, i) => (
                  <li key={i}>
                    <span className="win-mark"><Glyph name="check" size={14} label="Went well" /></span>
                    <div><strong>{f.title}</strong><p>{f.detail}</p>{f.who && f.who.length > 0 && <p className="muted small">{f.who.slice(0, 8).join(', ')}{f.who.length > 8 ? ` and ${f.who.length - 8} more` : ''}</p>}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function RecentAnalyses({ list }: { list: HomeData['recentAnalyses'] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Recently analyzed</h2>
        <a href="/#/history" className="small">All analyses</a>
      </div>
      <div className="scroll">
        <table className="grid">
          <thead><tr><th>Player</th><th>Boss</th><th className="r">Parse</th><th>When</th></tr></thead>
          <tbody>
            {list.map((a) => (
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

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** Warcraft Logs' rank colors, in the site's parse colors. */
const RANK_CSS: Record<string, string> = { common: 'parse-gray', uncommon: 'parse-green', rare: 'parse-blue', epic: 'parse-purple', legendary: 'parse-orange', astounding: 'parse-pink', artifact: 'parse-pink' };

/** Progress in each raid: every boss with its first kill, kills and fastest kill (ranks are on the rank card). */
function Progress({ zones, wcl }: { zones: ZoneProgress[]; wcl: HomeData['wcl'] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Progress</h2>
        {wcl && <a href={wcl.url} target="_blank" rel="noreferrer" className="small">Rankings on Warcraft Logs</a>}
      </div>
      <p className="muted small">Click a boss for its guild rankings: first kills and fastest kills.</p>
      <div className="zones">
        {zones.map((z) => (
          <div key={z.id} className="zone">
            <div className="zone-head">
              <strong>{z.name}</strong>
              <span className={`zone-count${z.killed === z.total ? ' full' : ''}`}>{z.killed}/{z.total}</span>
            </div>
            <table className="grid">
              <thead><tr><th>Boss</th><th>First kill</th><th className="r">Kills</th><th className="r">Fastest</th></tr></thead>
              <tbody>
                {z.bosses.map((b) => {
                  const key = `${z.id}-${b.encounterId}`;
                  const isOpen = open === key;
                  return (
                    <Fragment key={b.encounterId}>
                      <tr>
                        <td>
                          <button type="button" className={`link-button boss-toggle${b.kills ? '' : ' muted'}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                            {b.name}
                          </button>
                        </td>
                        <td className="muted">{b.firstKill ? day(b.firstKill) : 'Not yet'}</td>
                        <td className="r">{b.kills || '–'}</td>
                        <td className="r">
                          {b.best ? <a href={`/?log=${encodeURIComponent(`https://${b.best.host}/reports/${b.best.code}?fight=${b.best.fightId}`)}`}>{mmss(b.best.seconds)}</a> : '–'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="boss-ranks-row">
                          <td colSpan={4}><BossRankings host={z.host} zoneId={z.id} encounterId={b.encounterId} wcl={wcl} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

const SCOPE_LABEL: Record<BossRanks['scope'], string> = { world: 'World', region: 'Region', realm: 'Realm' };
const killedAt = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A boss's guild rankings from Warcraft Logs, like Raider.IO's: by first kill or fastest kill, world, region or realm. */
function BossRankings({ host, zoneId, encounterId, wcl }: { host: string; zoneId: number; encounterId: number; wcl: HomeData['wcl'] }) {
  const [metric, setMetric] = useState<BossRanks['metric']>('progress');
  const [scope, setScope] = useState<BossRanks['scope']>('world');
  const [data, setData] = useState<BossRanks | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    loadBossRanks(host, encounterId, metric, scope).then((d) => live && setData(d)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [host, encounterId, metric, scope]);
  const scopes: BossRanks['scope'][] = wcl?.region ? (wcl.serverSlug ? ['world', 'region', 'realm'] : ['world', 'region']) : ['world'];
  const where = (r: BossRanks['top'][number]) => [r.server, r.region].filter(Boolean).join(' · ');
  return (
    <div className="boss-ranks">
      <div className="row wrap-center">
        <div className="seg" role="group" aria-label="Ranked by">
          <button type="button" className={metric === 'progress' ? 'on' : ''} aria-pressed={metric === 'progress'} onClick={() => setMetric('progress')}>First kill</button>
          <button type="button" className={metric === 'speed' ? 'on' : ''} aria-pressed={metric === 'speed'} onClick={() => setMetric('speed')}>Fastest</button>
        </div>
        {scopes.length > 1 && (
          <div className="seg" role="group" aria-label="Where">
            {scopes.map((x) => <button key={x} type="button" className={scope === x ? 'on' : ''} aria-pressed={scope === x} onClick={() => setScope(x)}>{x === 'region' && wcl?.region ? wcl.region : x === 'realm' && wcl?.server ? wcl.server : SCOPE_LABEL[x]}</button>)}
          </div>
        )}
        <a href={`https://${host}/zone/rankings/${zoneId}#boss=${encounterId}&metric=${metric}`} target="_blank" rel="noreferrer" className="small">On Warcraft Logs</a>
      </div>
      {error && <p className="error small">{error}</p>}
      {!data && !error && <p className="muted small"><span className="spinner small" aria-hidden="true" /> Loading rankings&hellip;</p>}
      {data && (
        <>
          <p className="small">
            {data.mine
              ? <>Your guild: <strong>#{n0(data.mine.rank)}</strong> {SCOPE_LABEL[data.scope].toLowerCase()}{data.metric === 'speed' && data.mine.seconds !== null ? ` (${mmss(data.mine.seconds)})` : ''}</>
              : <span className="muted">{data.checked ? `Your guild isn\u2019t in the top ${n0(data.checked)} yet.` : 'No kills ranked yet.'}</span>}
          </p>
          {data.top.length > 0 && (
            <table className="grid">
              <thead><tr><th className="r">#</th><th>Guild</th><th className="r">{data.metric === 'progress' ? 'Killed' : 'Time'}</th></tr></thead>
              <tbody>
                {data.top.map((r) => (
                  <tr key={`${r.rank}-${r.guild}`} className={r.mine ? 'mine' : ''}>
                    <td className="r">{r.rank}</td>
                    <td><strong>{r.guild}</strong> <span className="muted small">{where(r)}</span></td>
                    <td className="r muted">{data.metric === 'progress' ? (r.at ? killedAt(r.at) : '–') : r.seconds !== null ? mmss(r.seconds) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

const ROLES = [['tank', 'Tanks'], ['healer', 'Healers'], ['dps', 'Damage']] as const;

/** Who's been raiding in the last 8 weeks, by role, with item level and raids attended. */
function Composition({ roster }: { roster: HomeData['roster'] }) {
  const of = roster[0]?.of ?? 0;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Composition ({roster.length})</h2>
        <span className="muted small">Item level · raids attended in the last 8 weeks ({of})</span>
      </div>
      <div className="composition">
        {ROLES.map(([role, label]) => {
          const list = roster.filter((p) => (p.role ?? 'dps') === role);
          return (
            <div key={role}>
              <div className="comp-label">{label} ({list.length})</div>
              <ul className="roster">
                {list.map((p) => (
                  <li key={p.name}>
                    <ClassIcon className={p.className} size={18} />
                    <span className={`roster-name ${classCss(p.className)}`}>{p.name}</span>
                    <span className="muted small r">{p.itemLevel ? Math.round(p.itemLevel) : ''}</span>
                    <span className="muted small r" title={`${p.raids} of ${p.of} raids`}>{p.raids}/{p.of}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Which raid to show first: the one with the most bosses (the most recent one on a tie). */
const mainZone = <T,>(list: T[], bosses: (x: T) => number) => list.reduce((best, x) => (bosses(x) > bosses(best) ? x : best), list[0]);

/** A raid picker, when there's more than one raid. */
function ZonePicker({ zones, value, onChange }: { zones: { id: number; name: string }[]; value: number; onChange: (id: number) => void }) {
  if (zones.length < 2) return null;
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Raid">
      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
    </select>
  );
}

/** Everyone's best parse on each boss of a raid, by role, like Warcraft Logs' Rankings tab. */
function Rankings({ list }: { list: GuildRankings[] }) {
  const [zoneId, setZoneId] = useState(() => mainZone(list, (r) => r.bosses.length).zoneId);
  const [role, setRole] = useState<'dps' | 'healer' | 'tank'>('dps');
  const r = list.find((x) => x.zoneId === zoneId) ?? list[0];
  const rows = r.players.filter((p) => p.role === role);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Best parses{list.length < 2 ? `: ${r.zone}` : ''}</h2>
        <div className="row wrap-center">
          <ZonePicker zones={list.map((x) => ({ id: x.zoneId, name: x.zone }))} value={r.zoneId} onChange={setZoneId} />
          <div className="seg" role="group" aria-label="Role">
            {(['dps', 'healer', 'tank'] as const).map((x) => (
              <button key={x} type="button" className={x === role ? 'on' : ''} aria-pressed={x === role} onClick={() => setRole(x)}>{x === 'dps' ? 'Damage' : x === 'healer' ? 'Healers' : 'Tanks'}</button>
            ))}
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No parses for this role in the last 8 weeks.</p>
      ) : (
        <div className="scroll">
          <table className="grid rank-grid">
            <thead>
              <tr><th>Name</th><th className="r">Avg</th>{r.bosses.map((b) => <th key={b.id} className="r" title={b.name}>{b.name.replace(/^The /, '').split(/[ ,]/)[0]}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.name}>
                  <td><span className={`with-icon ${classCss(p.className)}`}><ClassIcon className={p.className} size={16} />{p.name}</span></td>
                  <td className={`r strong ${parseCss(p.avg)}`}>{p.avg === null ? '–' : Math.round(p.avg)}</td>
                  {p.best.map((v, i) => <td key={i} className={`r ${parseCss(v)}`}>{v === null ? '–' : Math.round(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Best parse on each boss in the last 8 weeks, from Past raids (healers by healing).</p>
    </section>
  );
}

/** A raid's ranks, world rank big, with Progress and Speed tabs (links to Warcraft Logs). */
function RankCard({ zones, url }: { zones: ZoneProgress[]; url: string | null }) {
  const [zoneId, setZoneId] = useState(() => mainZone(zones, (z) => z.total).id);
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0];
  const [pick, setKind] = useState<'progress' | 'speed'>('progress');
  const kind = zone.ranks?.[pick] ? pick : pick === 'progress' ? 'speed' : 'progress';
  const set = zone.ranks?.[kind];
  const num = (r: WclRank | null | undefined) => (r ? <strong className={RANK_CSS[r.color ?? ''] ?? ''}>{n0(r.number)}</strong> : <strong className="muted">–</strong>);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{zones.length < 2 ? <>{zone.name} </> : 'Ranks '}<span className="muted">{zone.killed}/{zone.total}</span></h2>
        <ZonePicker zones={zones} value={zone.id} onChange={setZoneId} />
      </div>
      <div className="seg rank-kind" role="group" aria-label="Rank">
        <button type="button" className={kind === 'progress' ? 'on' : ''} aria-pressed={kind === 'progress'} onClick={() => setKind('progress')}>Progress</button>
        <button type="button" className={kind === 'speed' ? 'on' : ''} aria-pressed={kind === 'speed'} onClick={() => setKind('speed')}>Speed</button>
      </div>
      <a href={url ?? undefined} target="_blank" rel="noreferrer" className="rank-card">
        <span className="rank-world"><span className="muted small">World</span>{num(set?.world)}</span>
        <span className="rank-sub"><span className="muted small">Region</span>{num(set?.region)}</span>
        <span className="rank-sub"><span className="muted small">Realm</span>{num(set?.server)}</span>
      </a>
    </section>
  );
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The usual raid nights, worked out from when raids started in the last 8 weeks (in your time). */
function Schedule({ raids }: { raids: HomeData['schedule'] }) {
  const byDay = new Map<number, { mins: number[]; secs: number[] }>();
  for (const r of raids) {
    const t = new Date(r.start);
    const x = byDay.get(t.getDay()) ?? { mins: [], secs: [] };
    x.mins.push(t.getHours() * 60 + t.getMinutes());
    x.secs.push(r.seconds);
    byDay.set(t.getDay(), x);
  }
  // A night counts once it's been raided at least twice (or there are only a few raids so far)
  const nights = [...byDay].filter(([, x]) => x.mins.length >= 2 || raids.length < 4).sort((a, b) => a[0] - b[0]);
  if (!nights.length) return null;
  const clock = (m: number) => {
    const q = Math.round(m / 15) * 15;
    return new Date(2000, 0, 1, Math.floor(q / 60), q % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };
  return (
    <section className="panel">
      <h2 className="panel-title">Schedule</h2>
      <table className="grid">
        <thead><tr><th>Day</th><th>First pull</th><th className="r">Length</th></tr></thead>
        <tbody>
          {nights.map(([day, x]) => (
            <tr key={day}><td>{DAYS[day]}</td><td>{clock(median(x.mins))}</td><td className="r">{hm(median(x.secs))}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Usual times in your time zone, from the last 8 weeks.</p>
    </section>
  );
}
