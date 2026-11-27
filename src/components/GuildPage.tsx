// The guild at a glance: who it is, its numbers, the raid team by role (like Warcraft Logs'
// Composition), a small calendar of recent raids, the usual raid nights and attendance.
import { useEffect, useMemo, useState } from 'react';
import type { GuildRankings, HomeData, SavedRaid } from '../../server/types';
import { type Me, loadHome, loadMe, loadRaids } from '../api';
import { n0 } from '../format';
import Glyph from './Glyph';
import { Schedule, mainZone } from './Home';
import PlayerTip from './PlayerTip';
import { outcome } from './RaidsPage';
import { classCss, ClassIcon, EmptyNote, parseCss, RoleIcon, TileIcon } from './icons';

const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);

/** The shortest period with at least one raid in it, so the page isn't empty after a break. */
function firstRangeWithRaids(raids: SavedRaid[]): RangeId {
  const ages = raids.filter((r) => r.startTime).map((r) => (Date.now() - new Date(r.startTime!).getTime()) / 86_400_000);
  return RANGES.find((x) => ages.some((a) => a <= x.days))?.id ?? '8w';
}

export default function GuildPage() {
  const [raids, setRaids] = useState<SavedRaid[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [range, setRange] = useState<RangeId | null>(null);
  /** undefined while loading, null if it failed. */
  const [d, setD] = useState<HomeData | null | undefined>(undefined);
  useEffect(() => {
    loadRaids().then((r) => { setRaids(r.raids); setRange(firstRangeWithRaids(r.raids)); }).catch(() => { setRaids([]); setRange('8w'); });
    loadMe().then(setMe);
  }, []);
  useEffect(() => {
    if (!range) return;
    let live = true;
    const days = RANGES.find((x) => x.id === range)!.days;
    setD(undefined);
    loadHome(Number.isFinite(days) ? days : 36_500).then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [range]);

  if (!raids || !range || (d === undefined && !raids.length)) return <section className="panel home-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="muted">Loading the guild&hellip;</span></section>;
  const dated = raids.filter((r) => r.startTime);
  const name = d?.guild?.name || d?.wcl?.name || 'The guild';
  const where = [d?.wcl?.server && `${d.wcl.server}${d.wcl.region ? ` (${d.wcl.region})` : ''}`, d?.wcl?.faction, d?.guild?.members ? `${n0(d.guild.members)} members on Discord` : null].filter(Boolean).join(' · ');
  const s = d?.stats;
  const period = RANGES.find((x) => x.id === range)!.label.toLowerCase();

  return (
    <>
      <section className="panel home-hero guild-hero">
        <select className="guild-range" value={range} onChange={(e) => setRange(e.target.value as RangeId)} aria-label="Period for the numbers on this page">
          {RANGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <div className="home-guild">
          {d?.guild?.icon ? <img src={d.guild.icon} width={56} height={56} alt="" /> : <span className="kpi-icon big"><Glyph name="users" size={24} /></span>}
          <div>
            <h1>{name}</h1>
            {where && <p className="muted small">{where}</p>}
            {d?.guild?.about && <p className="home-about">{d.guild.about}</p>}
            {d && d.zones.length > 0 && (
              <p className="home-progress">
                {d.zones.map((z) => <a key={z.id} href={`/#/rankings?zone=${z.id}`} className={`zone-chip${z.killed === z.total ? ' full' : ''}`}>{z.name} <strong>{z.killed}/{z.total}</strong></a>)}
              </p>
            )}
          </div>
        </div>
      </section>

      {d === undefined && <section className="panel home-loading" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="muted">Loading {period}&hellip;</span></section>}
      {s && dated.length > 0 && (
        <div className="kpis">
          <Kpi glyph="calendar" label="Raids" value={String(s.raids8w)} sub={period} />
          <Kpi glyph="check" label="Full clears" value={s.raids8w ? `${s.fullClears8w} of ${s.raids8w}` : '–'} sub="every boss killed" />
          <Kpi glyph="timer" label="Raid time" value={s.avgRaidSeconds ? hm(s.avgRaidSeconds) : '–'} sub="average, first pull to last kill" />
          <Kpi glyph="users" label="Raiders" value={String(s.activeRaiders4w)} sub={range === '8w' ? 'in a raid in the last 4 weeks' : `in a raid, ${period}`} />
        </div>
      )}

      <div className="grid-2-1">
        <GuildComposition roster={d?.roster ?? []} rankings={d?.rankings ?? []} period={period} />
        <aside className="home-col">
          <MiniCalendar raids={dated} />
          {d && d.schedule.length > 0 && <Schedule raids={d.schedule} />}
        </aside>
      </div>

      {dated.length > 0 ? (
        <Attendance raids={dated} range={range} onRange={setRange} onSelect={(code) => (window.location.hash = `#/raids?raid=${encodeURIComponent(code)}`)} officer={!!me?.officer} />
      ) : (
        <section className="panel">
          <h2 className="panel-title">Attendance</h2>
          <EmptyNote icon="inv_misc_book_11">Who came to each raid, worked out from the logs, shows here once raids are on <a href="/#/raids">Past raids</a>.</EmptyNote>
        </section>
      )}
    </>
  );
}

function Kpi({ glyph, label, value, sub }: { glyph: 'calendar' | 'check' | 'timer' | 'users'; label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="kpi-head"><TileIcon glyph={glyph} />{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

const ROLES = [['tank', 'Tanks'], ['healer', 'Healers'], ['dps', 'Damage']] as const;

/** The raid team by role, like Warcraft Logs' Composition: everyone in a raid in the period, with item level. */
function GuildComposition({ roster, rankings, period }: { roster: HomeData['roster']; rankings: GuildRankings[]; period: string }) {
  const main = rankings.length ? mainZone(rankings, (r) => r.bosses.length) : null;
  const avgOf = (name: string) => main?.players.find((x) => x.name === name)?.avg ?? null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Composition</h2>
        <span className="muted small">Everyone in a raid, {period}</span>
      </div>
      {roster.length === 0 ? (
        <EmptyNote icon="inv_misc_groupneedmore">Nobody raided {period}. Pick a longer period at the top, or the team shows here once raids are on <a href="/#/raids">Past raids</a>.</EmptyNote>
      ) : (
        <div className="guild-comp">
          {ROLES.map(([role, label]) => {
            const list = roster.filter((p) => (p.role ?? 'dps') === role).sort((a, b) => (b.itemLevel ?? 0) - (a.itemLevel ?? 0) || a.name.localeCompare(b.name));
            return (
              <div key={role} className={`guild-comp-col ${role}`}>
                <h3 className="guild-comp-head"><RoleIcon role={role} size={20} />{label} <span className="count-badge">{list.length}</span></h3>
                {list.length === 0 ? <p className="muted small">None yet</p> : (
                  <ul className="guild-comp-list">
                    {list.map((p) => (
                      <li key={p.name}>
                        <ClassIcon className={p.className} spec={p.specName} size={18} />
                        <PlayerTip
                          name={p.name}
                          className={p.className}
                          specName={p.specName}
                          role={p.role}
                          lines={[
                            ...(main ? [{ label: `Average parse, ${main.zone}`, value: avgOf(p.name) === null ? '–' : String(avgOf(p.name)), cls: parseCss(avgOf(p.name)) }] : []),
                            { label: 'Item level', value: p.itemLevel ? String(Math.round(p.itemLevel)) : '–' },
                            { label: 'Raids', value: `${p.raids} of ${p.of}` },
                          ]}
                        >
                          <span className={classCss(p.className)}>{p.name}</span>
                        </PlayerTip>
                        {p.itemLevel ? <span className="ilvl-badge">{Math.round(p.itemLevel)}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** A small month calendar: each raid night as a colored day that opens it on Past raids. */
function MiniCalendar({ raids }: { raids: SavedRaid[] }) {
  const latest = raids.reduce<string | null>((m, r) => (!m || r.startTime! > m ? r.startTime! : m), null);
  const [month, setMonth] = useState(() => {
    const d = latest ? new Date(latest) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const byDay = new Map<string, SavedRaid[]>();
  for (const r of raids) byDay.set(dayKey(new Date(r.startTime!)), [...(byDay.get(dayKey(new Date(r.startTime!))) ?? []), r]);
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const weeks = days[35].getMonth() !== month.getMonth() ? days.slice(0, 35) : days;
  const today = dayKey(new Date());
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <section className="panel mini-cal">
      <div className="cal-head">
        <button type="button" className="ghost icon-only" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <h2 className="panel-title">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <button type="button" className="ghost icon-only" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>
      <div className="mini-cal-grid">
        {WEEKDAYS.map((w, i) => <span key={i} className="mini-cal-wd" aria-hidden="true">{w}</span>)}
        {weeks.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          const r = list[0];
          const cls = `mini-cal-day${d.getMonth() !== month.getMonth() ? ' out' : ''}${dayKey(d) === today ? ' today' : ''}${r ? ` raid ${outcome(r)}` : ''}`;
          return r ? (
            <a key={d.toISOString()} className={cls} href={`/#/raids?raid=${encodeURIComponent(r.code)}`} title={list.map((x) => `${x.title ?? x.code}${x.card ? `: ${x.card.kills} of ${x.card.bosses.length} bosses` : ''}`).join('\n')}>{d.getDate()}</a>
          ) : (
            <span key={d.toISOString()} className={cls}>{d.getDate()}</span>
          );
        })}
      </div>
      <p className="cal-legend muted small">
        <span className="raid-dot full" /> full clear <span className="raid-dot partial" /> some killed <span className="raid-dot none" /> no kills
      </p>
    </section>
  );
}

const RANGES = [
  { id: '4w', label: 'Last 4 weeks', days: 28 },
  { id: '8w', label: 'Last 8 weeks', days: 56 },
  { id: '6m', label: 'Last 6 months', days: 183 },
  { id: 'all', label: 'All raids', days: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

// ---------- Attendance ----------

function Attendance({ raids, range, onRange, onSelect, officer }: { raids: SavedRaid[]; range: RangeId; onRange: (r: RangeId) => void; onSelect: (code: string) => void; officer: boolean }) {
  const days = RANGES.find((r) => r.id === range)!.days;
  const inRange = raids
    .filter((r) => r.card && Date.now() - new Date(r.startTime!).getTime() <= days * 86_400_000)
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!));
  const people = useMemo(() => {
    const m = new Map<string, { name: string; className: string; nights: Set<string>; last: string }>();
    for (const r of inRange) for (const p of r.card!.raiders) {
      const x = m.get(p.name) ?? { name: p.name, className: p.className, nights: new Set<string>(), last: r.startTime! };
      x.nights.add(r.code);
      if (r.startTime! > x.last) x.last = r.startTime!;
      m.set(p.name, x);
    }
    return [...m.values()].sort((a, b) => b.nights.size - a.nights.size || b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
  }, [inRange]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Attendance</h2>
        <select value={range} onChange={(e) => onRange(e.target.value as RangeId)} aria-label="Period">
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      {officer && inRange.length >= 3 && <BenchHelper people={people} raids={inRange.length} />}
      {inRange.length === 0 ? <p className="muted">No raids in this period. Pick a longer one above.</p> : (
        <div className="scroll">
          <table className="grid attendance">
            <thead>
              <tr>
                <th>Player</th>
                <th className="r">Raids</th>
                <th className="att-bar-col">Attended</th>
                <th>Last raid</th>
                <th className="att-nights-col">Each raid (oldest to newest)</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.name}>
                  <td>
                    <span className={`with-icon ${classCss(p.className)}`}><ClassIcon className={p.className} size={16} />{p.name}</span>
                    {inRange.length >= 3 && p.nights.size === inRange.length && <span className="perfect-att" title="Perfect attendance in this period">Perfect attendance</span>}
                  </td>
                  <td className="r">{p.nights.size} / {inRange.length}</td>
                  <td className="att-bar-col"><progress className={`bar ${classCss(p.className)}-bar`} max={inRange.length} value={p.nights.size} aria-label={`${p.name} attended ${p.nights.size} of ${inRange.length}`} /></td>
                  <td className="muted">{shortDate(new Date(p.last))}</td>
                  <td className="att-nights-col">
                    <span className="att-nights">
                      {inRange.map((r) => (
                        <button
                          key={r.code}
                          type="button"
                          className={`att-dot${p.nights.has(r.code) ? ' on' : ''}`}
                          title={`${shortDate(new Date(r.startTime!))}: ${r.title ?? r.code}${p.nights.has(r.code) ? '' : ' (not there)'}`}
                          aria-label={`${shortDate(new Date(r.startTime!))} ${p.nights.has(r.code) ? 'attended' : 'not there'}`}
                          onClick={() => onSelect(r.code)}
                        />
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Officers only: who it's fairest to sit next, when the raid's full. Regulars (in at least half the
 * raids) who've missed the fewest, so the bench goes round instead of landing on the same people.
 */
function BenchHelper({ people, raids }: { people: { name: string; className: string; nights: Set<string> }[]; raids: number }) {
  const regulars = people.filter((p) => p.nights.size * 2 >= raids);
  if (regulars.length < 3) return null;
  const next = [...regulars].sort((a, b) => b.nights.size - a.nights.size || a.name.localeCompare(b.name)).slice(0, 5);
  const due = [...regulars].sort((a, b) => a.nights.size - b.nights.size || a.name.localeCompare(b.name)).filter((p) => p.nights.size < raids).slice(0, 5);
  return (
    <details className="accordion bench-helper">
      <summary>Bench rotation <span className="muted small">(officers)</span></summary>
      <div className="grid-2">
        <div>
          <div className="comp-label">Fairest to sit next</div>
          <p className="muted small">Regulars who haven&rsquo;t missed a raid (or missed the fewest).</p>
          <ul className="bench-list">{next.map((p) => <li key={p.name}><span className={classCss(p.className)}>{p.name}</span> <span className="muted small">{raids - p.nights.size} missed</span></li>)}</ul>
        </div>
        <div>
          <div className="comp-label">Due a spot</div>
          <p className="muted small">Regulars who&rsquo;ve sat out or missed the most.</p>
          {due.length ? <ul className="bench-list">{due.map((p) => <li key={p.name}><span className={classCss(p.className)}>{p.name}</span> <span className="muted small">{raids - p.nights.size} missed</span></li>)}</ul> : <p className="muted small">Nobody: every regular has been in every raid.</p>}
        </div>
      </div>
      <p className="muted small">From the logs only: it can&rsquo;t tell sitting out from being away, so use it as a starting point.</p>
    </details>
  );
}
