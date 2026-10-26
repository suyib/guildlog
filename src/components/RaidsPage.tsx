// Past raids: a calendar of raid nights, a card for each one (bosses, who was there, what went
// well), attendance over time and how kill times are improving. Saved raids still open when
// Warcraft Logs is down.
import { useEffect, useMemo, useState } from 'react';
import type { RaidCard, RaidCheck, SavedRaid } from '../../server/types';
import { type Me, addRaid, checkRaid, deleteRaid, loadMe, loadRaids, readRaidNow } from '../api';
import { mmss } from '../format';
import Glyph from './Glyph';
import { BossIcon, ClassIcon, SeverityDot, classCss } from './icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ROLE_LABEL = { tank: 'Tanks', healer: 'Healers', dps: 'Damage', unknown: 'Role not known' } as const;
const RANGES = [
  { id: '4w', label: 'Last 4 weeks', days: 28 },
  { id: '8w', label: 'Last 8 weeks', days: 56 },
  { id: '6m', label: 'Last 6 months', days: 183 },
  { id: 'all', label: 'All raids', days: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const longDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const logLink = (r: SavedRaid, fightId?: number | null) => `https://${r.host}/reports/${r.code}${fightId ? `?fight=${fightId}` : ''}`;
const siteLink = (r: SavedRaid, fightId?: number | null) => `/?log=${encodeURIComponent(logLink(r, fightId))}`;

/** How the raid went, for the calendar chip's color. */
function outcome(r: SavedRaid): 'full' | 'partial' | 'none' | 'pending' {
  const c = r.card;
  if (!c) return 'pending';
  if (c.kills === 0) return 'none';
  return c.bosses.every((b) => b.kill) ? 'full' : 'partial';
}

function statusText(r: SavedRaid, archiveDays: number): string {
  const old = r.startTime && Date.now() - new Date(r.startTime).getTime() > archiveDays * 86_400_000;
  switch (r.status) {
    case 'saved': return old ? `Summary stored (each fight is kept whole for ${archiveDays} days)` : 'Stored: opens even when Warcraft Logs is down';
    case 'saving': return `Reading the boss kills: ${Math.max(0, r.saved - 1)} of ${r.total ? r.total - 1 : '…'}`;
    case 'queued': return 'Waiting to be read (within a few minutes)';
    case 'partial': return 'Partly stored: some boss kills couldn’t be read from Warcraft Logs';
    default: return '';
  }
}

export default function RaidsPage() {
  const [raids, setRaids] = useState<SavedRaid[] | null>(null);
  const [archiveDays, setArchiveDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<RangeId>('8w');
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    loadMe().then(setMe);
  }, []);

  const refresh = () =>
    loadRaids()
      .then((r) => {
        setRaids(r.raids);
        setArchiveDays(r.archiveDays);
        return r.raids;
      })
      .catch((e) => {
        setError((e as Error).message);
        return [] as SavedRaid[];
      });

  useEffect(() => {
    refresh().then((list) => {
      const latest = list.find((r) => r.startTime);
      const at = latest?.startTime ? new Date(latest.startTime) : new Date();
      setMonth(new Date(at.getFullYear(), at.getMonth(), 1));
      if (latest) setSelected(latest.code);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Raids still being saved: check again every half minute while the page is open
  useEffect(() => {
    if (!raids?.some((r) => r.status === 'queued' || r.status === 'saving')) return;
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raids]);

  const dated = useMemo(() => (raids ?? []).filter((r) => r.startTime), [raids]);
  const waiting = useMemo(() => (raids ?? []).filter((r) => !r.startTime), [raids]);
  const current = (raids ?? []).find((r) => r.code === selected) ?? null;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h1>Past raids</h1>
            <p className="help">Every raid ended with /raidend, plus any you add here. Saved raids open on the site even when Warcraft Logs is down.</p>
          </div>
        </div>
        {me?.officer ? (
          <AddRaid onAdded={(r) => refresh().then(() => setSelected(r.code))} />
        ) : me && (
          <p className="muted small">Officers can add older raids here{me.kind === 'password' && me.discordLogin ? '; sign in with Discord to see if that includes you' : ''}.</p>
        )}
        {error && <p className="error">{error}</p>}
        {!raids && !error && <p className="muted">Loading…</p>}
        {waiting.length > 0 && (
          <div className="muted small">
            Being read from Warcraft Logs: {waiting.map((r) => r.title ?? r.code).join(', ')}
            {me?.officer && waiting.map((r) => <StoredData key={r.code} code={r.code} label={r.title ?? r.code} canRestart={me.rank === 'admin' || me.rank === 'guild_master'} onChanged={refresh} />)}
          </div>
        )}
      </section>

      {raids && raids.length === 0 && (
        <section className="panel">
          <p className="muted">No raids yet. Use <strong>/raidend</strong> after a raid, or add a log above.</p>
        </section>
      )}

      {dated.length > 0 && month && (
        <>
          <Overview raids={dated} />
          <div className="grid-raids">
            <Calendar raids={dated} month={month} onMonth={setMonth} selected={selected} onSelect={setSelected} />
            {current ? <RaidCardView raid={current} archiveDays={archiveDays} canDelete={me?.rank === 'admin' || me?.rank === 'guild_master'} officer={!!me?.officer} onDeleted={() => { setSelected(null); refresh(); }} onChanged={refresh} /> : <section className="panel"><p className="muted">Pick a raid on the calendar.</p></section>}
          </div>
          <Attendance raids={dated} range={range} onRange={setRange} onSelect={(code) => {
            setSelected(code);
            const r = dated.find((x) => x.code === code);
            if (r?.startTime) {
              const d = new Date(r.startTime);
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            }
          }} />
          <Progress raids={dated} />
        </>
      )}
    </>
  );
}

// ---------- Adding a raid ----------

function AddRaid({ onAdded }: { onAdded: (r: SavedRaid) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await addRaid(url);
      setUrl('');
      setMessage({ ok: true, text: r.status === 'saved' ? 'Already saved.' : 'Added. It’s read and saved over the next few minutes; this page updates on its own.' });
      onAdded(r);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form onSubmit={submit} className="row">
        <label className="input-icon">
          <Glyph name="link" size={18} />
          <input type="url" placeholder="Add a past raid: https://fresh.warcraftlogs.com/reports/…" value={url} onChange={(e) => setUrl(e.target.value)} required aria-label="Warcraft Logs link of a past raid" />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add raid'}</button>
      </form>
      {message && <p className={message.ok ? 'muted small' : 'error'}>{message.text}</p>}
    </>
  );
}

// ---------- Headline numbers ----------

function Overview({ raids }: { raids: SavedRaid[] }) {
  const recent = raids.filter((r) => Date.now() - new Date(r.startTime!).getTime() <= 56 * 86_400_000);
  const cards = recent.map((r) => r.card).filter((c): c is RaidCard => !!c);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
  const raidTime = avg(cards.map((c) => c.raidSeconds).filter((v) => v > 0));
  const size = avg(cards.map((c) => c.raiders.length).filter((v) => v > 0));
  const clears = cards.filter((c) => c.kills > 0 && c.bosses.every((b) => b.kill)).length;
  return (
    <div className="kpis">
      <Kpi glyph="calendar" label="Raids" value={String(recent.length)} sub="last 8 weeks" />
      <Kpi glyph="check" label="Full clears" value={cards.length ? `${clears} of ${cards.length}` : '–'} sub="every boss killed" />
      <Kpi glyph="timer" label="Raid time" value={raidTime !== null ? hm(raidTime) : '–'} sub="average, first pull to last kill" />
      <Kpi glyph="users" label="Raiders" value={size !== null ? size.toFixed(0) : '–'} sub="average per night" />
    </div>
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

// ---------- Calendar ----------

function Calendar({ raids, month, onMonth, selected, onSelect }: {
  raids: SavedRaid[]; month: Date; onMonth: (d: Date) => void; selected: string | null; onSelect: (code: string) => void;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, SavedRaid[]>();
    for (const r of raids) {
      const k = dayKey(new Date(r.startTime!));
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [raids]);
  // Six weeks starting on the Monday on or before the 1st
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const weeks = days[35].getMonth() !== month.getMonth() ? days.slice(0, 35) : days;
  const today = dayKey(new Date());
  const inMonth = raids.filter((r) => {
    const d = new Date(r.startTime!);
    return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
  }).sort((a, b) => a.startTime!.localeCompare(b.startTime!));
  const step = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <section className="panel cal">
      <div className="cal-head">
        <button type="button" className="ghost icon-only" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <h2 className="panel-title">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <button type="button" className="ghost icon-only" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid" role="grid" aria-label="Raid calendar">
        {WEEKDAYS.map((d) => <div key={d} className="cal-weekday" role="columnheader">{d}</div>)}
        {weeks.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          const out = d.getMonth() !== month.getMonth();
          return (
            <div key={d.toISOString()} className={`cal-day${out ? ' out' : ''}${dayKey(d) === today ? ' today' : ''}${list.length ? ' has-raid' : ''}`} role="gridcell">
              <span className="cal-num">{d.getDate()}</span>
              {list.map((r) => <RaidChip key={r.code} raid={r} on={r.code === selected} onClick={() => onSelect(r.code)} />)}
            </div>
          );
        })}
      </div>
      {/* Phones: the month as a list */}
      <ul className="cal-list">
        {inMonth.length === 0 && <li className="muted small">No raids this month.</li>}
        {inMonth.map((r) => (
          <li key={r.code}>
            <span className="cal-list-date">{shortDate(new Date(r.startTime!))}</span>
            <RaidChip raid={r} on={r.code === selected} onClick={() => onSelect(r.code)} wide />
          </li>
        ))}
      </ul>
      <p className="cal-legend muted small">
        <span className="raid-dot full" /> every boss killed <span className="raid-dot partial" /> some killed <span className="raid-dot none" /> no kills <span className="raid-dot pending" /> being read
      </p>
    </section>
  );
}

function RaidChip({ raid, on, onClick, wide = false }: { raid: SavedRaid; on: boolean; onClick: () => void; wide?: boolean }) {
  const c = raid.card;
  const label = c ? `${c.kills}/${c.bosses.length}` : '…';
  const title = `${raid.title ?? raid.code}${c ? `: ${c.kills} of ${c.bosses.length} bosses` : ''}`;
  return (
    <button type="button" className={`raid-chip ${outcome(raid)}${on ? ' on' : ''}`} onClick={onClick} title={title} aria-pressed={on}>
      <span className="raid-chip-count">{label}</span>
      <span className="raid-chip-name">{wide ? title : raid.title ?? raid.code}</span>
    </button>
  );
}

// ---------- The raid card ----------

function RaidCardView({ raid, archiveDays, canDelete, officer, onDeleted, onChanged }: { raid: SavedRaid; archiveDays: number; canDelete: boolean; officer: boolean; onDeleted: () => void; onChanged: () => void }) {
  const c = raid.card;
  // Deleting asks once more on the same button row before anything is removed
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    setConfirming(false);
    setDeleteError(null);
  }, [raid.code]);
  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRaid(raid.code);
      onDeleted();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }
  // Cards made before v0.21.0 have no count: they were only made once every kill was read
  const partial = !!c && (c.summarized ?? c.kills) < c.kills;
  const when = new Date(raid.startTime!);
  const roles = c
    ? (['tank', 'healer', 'dps', 'unknown'] as const)
        .map((role) => ({ role, list: c.raiders.filter((p) => (p.role ?? 'unknown') === role) }))
        .filter((g) => g.list.length)
    : [];
  return (
    <section className="panel raid-card">
      <div className="raid-card-head">
        <div>
          <div className="eyebrow">{longDate(when)} · {when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}{raid.loggerName ? ` · logged by ${raid.loggerName}` : ''}</div>
          <h2>{raid.title ?? raid.code}</h2>
          <p className={`muted small raid-status ${raid.status}`}>{statusText(raid, archiveDays)}</p>
        </div>
        <div className="raid-card-links">
          <a className="button ghost" href={siteLink(raid)}>Open on Guild Logs</a>
          <a className="button ghost" href={logLink(raid)} target="_blank" rel="noreferrer">Warcraft Logs</a>
          {canDelete && !confirming && <button type="button" className="ghost danger" onClick={() => setConfirming(true)}>Delete raid</button>}
          {canDelete && confirming && (
            <>
              <button type="button" className="ghost danger" disabled={deleting} onClick={remove}>{deleting ? 'Deleting…' : 'Yes, delete it'}</button>
              <button type="button" className="ghost" disabled={deleting} onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
        </div>
      </div>
      {officer && <StoredData code={raid.code} canRestart={canDelete} onChanged={onChanged} />}
      {confirming && <p className="warning">This removes the raid from Past raids along with everything stored for it, including saved analyses of this log. Adding it again reads it from Warcraft Logs as a new raid.</p>}
      {deleteError && <p className="error">{deleteError}</p>}

      {!c && <p className="muted">This raid&rsquo;s summary appears once its boss kills have been read.</p>}
      {c && (
        <>
          <dl className="facts">
            <div><dt>Bosses killed</dt><dd>{c.kills} of {c.bosses.length}</dd></div>
            <div><dt>Raid time</dt><dd>{c.raidSeconds ? hm(c.raidSeconds) : '–'}</dd></div>
            <div><dt>Wipes</dt><dd>{c.wipes}</dd></div>
            <div><dt>Deaths on kills</dt><dd>{partial ? `${c.deaths} so far` : c.deaths}</dd></div>
            <div><dt>Raiders</dt><dd>{c.raiders.length}</dd></div>
            <div><dt>Item level</dt><dd>{c.avgItemLevel ?? '–'}</dd></div>
          </dl>

          <div>
            <div className="comp-label">Bosses</div>
            <ul className="boss-pills">
              {c.bosses.map((b) => {
                const meta = `${b.seconds !== null ? mmss(b.seconds) : 'Not killed'}${b.wipes ? ` · ${b.wipes} wipe${b.wipes > 1 ? 's' : ''}` : ''}`;
                const body = (
                  <>
                    <BossIcon id={b.encounterId} />
                    <span className="boss-pill-text"><strong>{b.name}</strong><span className="muted small">{meta}</span></span>
                  </>
                );
                return (
                  <li key={b.encounterId}>
                    {b.fightId
                      ? <a href={siteLink(raid, b.fightId)} className={`boss-pill ${b.kill ? 'kill' : 'wipe'}`} title={`Open the ${b.name} breakdown`}>{body}</a>
                      : <span className={`boss-pill ${b.kill ? 'kill' : 'wipe'}`}>{body}</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {partial && (
            <p className="muted small">Still reading the boss kills: {c.summarized ?? 0} of {c.kills} done. Deaths, item level, roles and the summary below fill in as each one is read.</p>
          )}
          {!partial && <div className="raid-feedback">
            <details className="accordion">
              <summary>What went well <span className="muted">({c.feedback.good.length})</span></summary>
              {c.feedback.good.length === 0 ? <p className="muted small">Nothing to single out.</p> : (
                <ul className="findings wins">
                  {c.feedback.good.map((f, i) => (
                    <li key={i}>
                      <span className="win-mark"><Glyph name="check" size={14} label="Went well" /></span>
                      <div><strong>{f.title}</strong><p>{f.detail}</p>{f.who && f.who.length > 0 && <p className="muted small">{f.who.join(', ')}</p>}</div>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <details className="accordion">
              <summary>What to work on <span className="muted">({c.feedback.work.length})</span></summary>
              {c.feedback.work.length === 0 ? <p className="muted small">Nothing stood out. Nice work.</p> : (
                <ul className="findings">
                  {c.feedback.work.map((f, i) => (
                    <li key={i} className="sev-medium"><SeverityDot severity="medium" /><div><strong>{f.title}</strong><p>{f.detail}</p></div></li>
                  ))}
                </ul>
              )}
            </details>
          </div>}

          <div className="raid-attendance">
            <div className="comp-label">Who was there ({c.raiders.length})</div>
            {roles.map((g) => (
              <div key={g.role} className="comp-group">
                <div className="muted small">{ROLE_LABEL[g.role]} ({g.list.length})</div>
                <div className="comp-list">
                  {g.list.map((p) => (
                    <span key={p.name} className="comp-chip static" title={`${p.specName ? `${p.specName.replace(/([a-z])([A-Z])/g, '$1 $2')} ` : ''}${p.className}: in ${p.bosses} of ${c.kills} kills`}>
                      <ClassIcon className={p.className} size={16} />
                      <span className={classCss(p.className)}>{p.name}</span>
                      {c.kills > 0 && p.bosses < c.kills && <span className="muted small">{p.bosses}/{c.kills}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- Attendance ----------

function Attendance({ raids, range, onRange, onSelect }: { raids: SavedRaid[]; range: RangeId; onRange: (r: RangeId) => void; onSelect: (code: string) => void }) {
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
      {inRange.length === 0 ? <p className="muted">No raids in this period.</p> : (
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
                  <td><span className={`with-icon ${classCss(p.className)}`}><ClassIcon className={p.className} size={16} />{p.name}</span></td>
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

// ---------- Progress: kill times over the weeks ----------

function Progress({ raids }: { raids: SavedRaid[] }) {
  const nights = raids.filter((r) => r.card).sort((a, b) => a.startTime!.localeCompare(b.startTime!)).slice(-16);
  // Bosses killed at least once, in the order they're usually pulled
  const bosses = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of nights) for (const b of r.card!.bosses) if (b.kill && !m.has(b.encounterId)) m.set(b.encounterId, b.name);
    return [...m].slice(0, 7);
  }, [nights]);
  if (nights.length < 2 || bosses.length === 0) {
    return (
      <section className="panel">
        <h2 className="panel-title">Kill times</h2>
        <p className="muted">Kill times over the weeks show here after two or more raids.</p>
      </section>
    );
  }
  const series = bosses.map(([id, name], i) => ({
    id, name, slot: `slot-${i + 1}`,
    points: nights.map((r, x) => {
      const b = r.card!.bosses.find((y) => y.encounterId === id);
      return b?.kill && b.seconds ? { x, y: b.seconds, raid: r } : null;
    }),
  }));
  const ys = series.flatMap((s) => s.points.filter((p): p is NonNullable<typeof p> => !!p).map((p) => p.y));
  const top = Math.max(60, Math.ceil(Math.max(...ys) / 60) * 60);
  const W = 1000, H = 260, L = 48, R = 16, T = 12, B = 28;
  const px = (x: number) => L + (nights.length === 1 ? 0 : (x / (nights.length - 1)) * (W - L - R));
  const py = (y: number) => T + (1 - y / top) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((top / 4) * i));
  const fastest = (s: (typeof series)[number]) => Math.min(...s.points.filter((p): p is NonNullable<typeof p> => !!p).map((p) => p.y));
  const latest = (s: (typeof series)[number]) => s.points.filter((p): p is NonNullable<typeof p> => !!p).at(-1)?.y ?? null;

  return (
    <section className="panel">
      <h2 className="panel-title">Kill times</h2>
      <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kill time for each boss across recent raids">
        {ticks.map((t) => (
          <g key={t}>
            <line className="trend-grid" x1={L} x2={W - R} y1={py(t)} y2={py(t)} />
            <text className="trend-axis" x={L - 8} y={py(t) + 4} textAnchor="end">{mmss(t)}</text>
          </g>
        ))}
        {nights.map((r, x) => (x % Math.ceil(nights.length / 8) === 0 || x === nights.length - 1) && (
          <text key={r.code} className="trend-axis" x={px(x)} y={H - 8} textAnchor="middle">{shortDate(new Date(r.startTime!))}</text>
        ))}
        {series.map((s) => {
          const pts = s.points.filter((p): p is NonNullable<typeof p> => !!p);
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join('');
          return (
            <g key={s.id} className={`trend-series ${s.slot}`}>
              <path className="trend-line" d={d} />
              {pts.map((p) => (
                <circle key={p.x} className="trend-pt" cx={px(p.x)} cy={py(p.y)} r={3.5}>
                  <title>{`${s.name}: ${mmss(p.y)} on ${shortDate(new Date(p.raid.startTime!))}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <ul className="trend-legend">
        {series.map((s) => {
          const best = fastest(s);
          const last = latest(s);
          return (
            <li key={s.id}>
              <span className={`swatch ${s.slot}`} aria-hidden="true" />
              <strong>{s.name}</strong>
              <span className="muted small">latest {last !== null ? mmss(last) : '–'} · fastest {mmss(best)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Officers: what's stored for a raid, kill by kill, and why something might be missing, with
 * Read now (carry on straight away) and, for guild masters and admins, Read again from scratch.
 */
function StoredData({ code, label, canRestart, onChanged }: { code: string; label?: string; canRestart: boolean; onChanged: () => void }) {
  const [check, setCheck] = useState<RaidCheck | null>(null);
  const [busy, setBusy] = useState<'check' | 'read' | 'fresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  useEffect(() => {
    setCheck(null);
    setError(null);
    setConfirmFresh(false);
  }, [code]);
  async function run(kind: 'check' | 'read' | 'fresh') {
    setBusy(kind);
    setError(null);
    setConfirmFresh(false);
    try {
      setCheck(kind === 'check' ? await checkRaid(code) : await readRaidNow(code, kind === 'fresh'));
      if (kind !== 'check') onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stored-data">
      <div className="raid-card-links">
        <button type="button" className="ghost" disabled={busy !== null} onClick={() => run('check')}>{busy === 'check' ? 'Checking…' : `Check stored data${label ? `: ${label}` : ''}`}</button>
        <button type="button" className="ghost" disabled={busy !== null} onClick={() => run('read')}>{busy === 'read' ? 'Reading (up to a minute)…' : 'Read now'}</button>
        {canRestart && !confirmFresh && <button type="button" className="ghost" disabled={busy !== null} onClick={() => setConfirmFresh(true)}>Read again from scratch</button>}
        {canRestart && confirmFresh && (
          <>
            <button type="button" className="ghost danger" disabled={busy !== null} onClick={() => run('fresh')}>{busy === 'fresh' ? 'Reading…' : 'Yes, read it again'}</button>
            <button type="button" className="ghost" disabled={busy !== null} onClick={() => setConfirmFresh(false)}>Cancel</button>
          </>
        )}
      </div>
      {confirmFresh && <p className="warning">This forgets everything stored for the raid and reads it from Warcraft Logs again, like a new raid. Saved analyses stay.</p>}
      {error && <p className="error">{error}</p>}
      {check && (
        <div className="check">
          <dl className="facts">
            <div><dt>Past raids</dt><dd>{check.status ?? 'not added'}{check.total ? ` · ${check.saved} of ${check.total}` : ''}</dd></div>
            <div><dt>On the calendar</dt><dd>{check.onCalendar ? 'yes' : 'no'}</dd></div>
            <div><dt>Report</dt><dd>{check.report}</dd></div>
            <div><dt>Guild benchmarks</dt><dd>{check.benchmarkRows === null ? 'table missing' : `${check.benchmarkRows} rows`}</dd></div>
          </dl>
          {check.kills.length > 0 && (
            <div className="scroll">
              <table className="grid">
                <thead><tr><th>Kill</th><th>Read</th><th className="r">Players</th><th className="r">Tank swings</th><th className="r">DoTs</th></tr></thead>
                <tbody>
                  {check.kills.map((k) => (
                    <tr key={k.fightId} className={k.stage !== 'full' ? 'warn' : ''}>
                      <td>{k.boss}{k.problem && <div className="muted small">{k.problem}</div>}</td>
                      <td>{k.stage ?? 'not yet'}</td>
                      <td className="r">{k.players || '–'}</td>
                      <td className="r">{k.stage === 'full' ? k.tanksWithSwings : '–'}</td>
                      <td className="r">{k.stage === 'full' ? k.withDots : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {check.advice.length > 0 && <ul className="findings-plain">{check.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
